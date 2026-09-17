import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeClaudeCode } from "@atlante/claude-code";
import type { ClaudeRunnerOptions } from "../../src/host/claude.js";
import {
  checkClaudeAuth,
  createClaudeRunner,
  normalizeClaudeUsage,
  parseClaudeVersion,
} from "../../src/host/claude.js";

const fixtureProject = join(import.meta.dir, "..", "fixtures", "project");

let projectRoot: string;
const cleanups: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

/** Writes an executable stub `claude` driven by argv. */
function writeStub(dir: string, script: string): string {
  const path = join(dir, "claude");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

function setupProject(): string {
  const root = tempDir("eval-claude-project-");
  cpSync(fixtureProject, root, { recursive: true });
  materializeClaudeCode(root, {
    agents: [
      {
        hostAgentId: "build",
        description: "Build agent",
        prompt: "You are a build agent.",
      },
    ],
    skills: [],
  });
  return root;
}

projectRoot = setupProject();

afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function sandboxFor(sandboxProject: string, state: string) {
  return {
    root: sandboxProject,
    stateDir: state,
    snapshot: [],
    baseline: "",
    keep: false,
  };
}

const NO_AUTH_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? "",
};

function makeRunner(options: Partial<ClaudeRunnerOptions> = {}) {
  return createClaudeRunner({
    projectRoot,
    baseEnv: { ...NO_AUTH_ENV },
    authStatusProbe: () => ({ loggedIn: false }),
    versionProbe: () => "2.1.218 (Claude Code)",
    ...options,
  });
}

describe("parseClaudeVersion", () => {
  test("parses the pinned CLI version output", () => {
    expect(parseClaudeVersion("2.1.218 (Claude Code)")).toMatchObject({
      major: 2,
      minor: 1,
      patch: 218,
    });
  });

  test("rejects unparseable output without inventing a version", () => {
    expect(() => parseClaudeVersion("claude: unknown")).toThrow(
      /could not determine a stable Claude Code version/,
    );
  });

  test("rejects versions outside the supported 2.x line", () => {
    expect(() =>
      createClaudeRunner({
        projectRoot,
        baseEnv: { ...NO_AUTH_ENV },
        versionProbe: () => "3.0.0 (Claude Code)",
      }),
    ).toThrow(/unsupported Claude Code version/);
  });

  test("fails closed when the binary is unavailable", () => {
    expect(() =>
      createClaudeRunner({
        projectRoot,
        baseEnv: { ...NO_AUTH_ENV },
        binaryPath: join(tempDir("eval-claude-missing-"), "claude"),
        versionProbe: () => {
          throw new Error("spawn ENOENT");
        },
      }),
    ).toThrow(/could not run .* --version/);
  });
});

describe("checkClaudeAuth", () => {
  test("recognizes an API key without spawning a probe", () => {
    let probed = false;
    const status = checkClaudeAuth(
      { ANTHROPIC_API_KEY: "test-key", PATH: process.env.PATH ?? "" },
      {
        authStatusProbe: () => {
          probed = true;
          return { loggedIn: false };
        },
      },
    );
    expect(status.authenticated).toBe(true);
    expect(status.method).toBe("api-key");
    expect(probed).toBe(false);
  });

  test("recognizes provider flags as a credential mode", () => {
    for (const [env, method] of [
      [{ CLAUDE_CODE_USE_BEDROCK: "1" }, "bedrock"],
      [{ CLAUDE_CODE_USE_VERTEX: "1" }, "vertex"],
      [{ CLAUDE_CODE_USE_FOUNDRY: "1" }, "foundry"],
      [{ CLAUDE_CODE_OAUTH_TOKEN: "test-token" }, "oauth"],
      [{ ANTHROPIC_AUTH_TOKEN: "bearer" }, "api-key"],
    ] as const) {
      const status = checkClaudeAuth(
        { ...env, PATH: process.env.PATH ?? "" },
        { authStatusProbe: () => ({ loggedIn: false }) },
      );
      expect(status.authenticated).toBe(true);
      expect(status.method).toBe(method);
    }
  });

  test("falls back to the auth-status probe for subscription logins", () => {
    const status = checkClaudeAuth(
      { ...NO_AUTH_ENV },
      { authStatusProbe: () => ({ loggedIn: true }) },
    );
    expect(status.authenticated).toBe(true);
    expect(status.method).toBe("auth-status");
  });

  test("reports unauthenticated without leaking secret values", () => {
    const status = checkClaudeAuth(
      { ...NO_AUTH_ENV },
      { authStatusProbe: () => ({ loggedIn: false }) },
    );
    expect(status.authenticated).toBe(false);
    expect(JSON.stringify(status)).not.toContain("test-key");
  });
});

describe("prepareHostIntegration", () => {
  test("writes fresh settings instead of inheriting project settings", () => {
    const host = makeRunner({
      authStatusProbe: () => ({ loggedIn: true }),
    });
    const project = tempDir("eval-claude-sandbox-settings-");
    const state = tempDir("eval-claude-state-settings-");
    host.prepareHostIntegration(sandboxFor(project, state), {});

    const written = JSON.parse(
      readFileSync(join(project, ".claude", "settings.json"), "utf8"),
    ) as { permissions?: { allow?: unknown; deny?: unknown } };
    expect(written.permissions?.deny).toEqual(
      expect.arrayContaining([
        "Bash(rm -rf *)",
        "Bash(rm -fr *)",
        "Bash(sudo *)",
        "WebFetch",
        "WebSearch",
        "AskUserQuestion",
      ]),
    );
    // The sandbox keeps no project MCP merge: no servers are configured.
    expect(JSON.stringify(written)).not.toContain("mcpServers");
  });

  test("rejects a fixture-provided .mcp.json that Claude would load", () => {
    const host = makeRunner({
      authStatusProbe: () => ({ loggedIn: true }),
    });
    const project = tempDir("eval-claude-sandbox-mcp-");
    writeFileSync(join(project, ".mcp.json"), '{ "mcpServers": {} }\n');
    expect(() =>
      host.prepareHostIntegration(
        sandboxFor(project, tempDir("eval-claude-state-mcp-")),
        {},
      ),
    ).toThrow(/\.mcp\.json/);
  });

  test("rejects fixture-provided Claude settings that would merge", () => {
    const host = makeRunner({
      authStatusProbe: () => ({ loggedIn: true }),
    });
    for (const file of ["settings.json", "settings.local.json"]) {
      const project = tempDir("eval-claude-sandbox-conf-");
      mkdirSync(join(project, ".claude"), { recursive: true });
      writeFileSync(join(project, ".claude", file), "{}\n");
      expect(() =>
        host.prepareHostIntegration(
          sandboxFor(project, tempDir("eval-claude-state-conf-")),
          {},
        ),
      ).toThrow(/\.claude/);
    }
  });

  test("fails closed when native outputs are unavailable", () => {
    const emptyRoot = tempDir("eval-claude-empty-");
    const host = createClaudeRunner({
      projectRoot: emptyRoot,
      baseEnv: { ...NO_AUTH_ENV },
      authStatusProbe: () => ({ loggedIn: true }),
      versionProbe: () => "2.1.218 (Claude Code)",
    });
    expect(() =>
      host.prepareHostIntegration(
        sandboxFor(
          tempDir("eval-claude-sandbox-nopi-"),
          tempDir("eval-claude-state-nopi-"),
        ),
        {},
      ),
    ).toThrow(/ownership manifest is missing/);
  });

  test("fails closed when host auth is missing", () => {
    const host = makeRunner();
    const project = tempDir("eval-claude-sandbox-noauth-");
    const state = tempDir("eval-claude-state-noauth-");
    expect(() =>
      host.prepareHostIntegration(sandboxFor(project, state), {}),
    ).toThrow(/authentication not found/);
    // The auth gate precedes all writes: no trust acceptance is authored
    // for a run that will never start.
    expect(existsSync(join(state, "claude-config", ".claude.json"))).toBe(
      false,
    );
  });

  test("pre-accepts workspace trust scoped to the sandbox root", () => {
    const host = makeRunner({
      authStatusProbe: () => ({ loggedIn: true }),
    });
    const project = tempDir("eval-claude-sandbox-trust-");
    const state = tempDir("eval-claude-state-trust-");
    host.prepareHostIntegration(sandboxFor(project, state), {});

    // Without this the host ignores the generated allow policy and exits 1:
    // "this workspace has not been trusted". The acceptance lives in the
    // redirected config dir and trusts only the ephemeral sandbox.
    const trust = JSON.parse(
      readFileSync(join(state, "claude-config", ".claude.json"), "utf8"),
    ) as { projects?: Record<string, { hasTrustDialogAccepted?: unknown }> };
    expect(trust.projects?.[realpathSync(project)]).toEqual({
      hasTrustDialogAccepted: true,
    });
    expect(Object.keys(trust.projects ?? {})).toHaveLength(1);
  });

  test("copies file-based credentials without session history", () => {
    const home = tempDir("eval-claude-home-");
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(
      join(home, ".claude", ".credentials.json"),
      '{"claudeAiOauth":{"accessToken":"test-token"}}\n',
    );
    // Session history must never follow credentials into the sandbox.
    writeFileSync(join(home, ".claude", "history.jsonl"), "must-not-leak\n");
    const host = makeRunner({
      baseEnv: { PATH: process.env.PATH ?? "", HOME: home },
      authStatusProbe: () => ({ loggedIn: true }),
    });
    const state = tempDir("eval-claude-state-credcopy-");
    const project = tempDir("eval-claude-sandbox-credcopy-");
    host.prepareHostIntegration(sandboxFor(project, state), {});

    expect(existsSync(join(state, "claude-config", ".credentials.json"))).toBe(
      true,
    );
    expect(existsSync(join(state, "claude-config", "history.jsonl"))).toBe(
      false,
    );
  });
});

describe("runTrial", () => {
  test("parses the stream-json result for usage, cost, and model", async () => {
    const stub = writeStub(
      tempDir("eval-claude-stub-happy-"),
      `printf '%s\\n' '{"type":"system","subtype":"init","model":"claude-fable-5"}' '{"type":"assistant","message":{"model":"claude-fable-5","usage":{"input_tokens":300,"output_tokens":40,"cache_creation_input_tokens":10,"cache_read_input_tokens":0}}}' '{"type":"result","subtype":"success","total_cost_usd":0.03,"usage":{"input_tokens":300,"output_tokens":40},"model":"claude-fable-5"}'`,
    );
    const runner = makeRunner({ binaryPath: stub });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(
        tempDir("eval-claude-sandbox-happy-"),
        tempDir("eval-claude-state-happy-"),
      ),
      prompt: "Say hi.",
      timeoutMs: 10_000,
      maxTokens: 100_000,
    });
    expect(trial.outcome).toBe("completed");
    // The trailing `result` event carries run totals and wins over
    // per-message usage; streams are never double-counted.
    expect(trial.tokens).toBe(340);
    expect(trial.cost).toBeCloseTo(0.03, 5);
    expect(trial.model).toContain("fable");
    expect(trial.budgetUnmonitored).toBeUndefined();
  });

  test("passes model, agent, and stream-json argv without a shell", async () => {
    const project = tempDir("eval-claude-sandbox-argv-");
    const state = tempDir("eval-claude-state-argv-");
    const capture = join(project, "captured-argv.txt");
    const stub = writeStub(
      tempDir("eval-claude-stub-argv-"),
      `for arg do printf '%s\\n' "$arg" >> '${capture}'; done
printf '%s\\n' '{"type":"result","subtype":"success","total_cost_usd":0.01,"usage":{"input_tokens":10,"output_tokens":20}}'`,
    );
    const runner = makeRunner({ binaryPath: stub });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(project, state),
      prompt: "Say hi.",
      agent: "reviewer",
      model: "sonnet",
      timeoutMs: 10_000,
      maxTokens: 100_000,
    });
    expect(trial.outcome).toBe("completed");
    const captured = readFileSync(capture, "utf8");
    expect(captured).toContain("-p");
    expect(captured).toContain("--output-format");
    expect(captured).toContain("stream-json");
    expect(captured).toContain("--verbose");
    expect(captured).toContain("--model");
    expect(captured).toContain("sonnet");
    expect(captured).toContain("--agent");
    expect(captured).toContain("reviewer");
    expect(captured).toContain("--setting-sources");
    expect(captured).toContain("Say hi.");
  });

  test("aborts in-flight past maxTokens with a budget-exceeded verdict", async () => {
    const stub = writeStub(
      tempDir("eval-claude-stub-budget-"),
      `printf '%s\\n' '{"type":"assistant","message":{"usage":{"input_tokens":800000,"output_tokens":100000}}}' >&1
sleep 30`,
    );
    const runner = makeRunner({ binaryPath: stub });
    const started = Date.now();
    const trial = await runner.runTrial({
      sandbox: sandboxFor(
        tempDir("eval-claude-sandbox-budget-"),
        tempDir("eval-claude-state-budget-"),
      ),
      prompt: "p",
      timeoutMs: 60_000,
      maxTokens: 400_000,
    });
    expect(trial.outcome).toBe("budget-exceeded");
    expect(trial.tokens).toBe(900_000);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

  test("aborts past the timeout", async () => {
    const stub = writeStub(tempDir("eval-claude-stub-slow-"), `sleep 30`);
    const runner = makeRunner({ binaryPath: stub });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(
        tempDir("eval-claude-sandbox-slow-"),
        tempDir("eval-claude-state-slow-"),
      ),
      prompt: "p",
      timeoutMs: 400,
      maxTokens: 400_000,
    });
    expect(trial.outcome).toBe("timeout");
  }, 30_000);

  test("non-zero exit is an infra error with bounded evidence", async () => {
    const stub = writeStub(
      tempDir("eval-claude-stub-fail-"),
      `echo boom >&2; exit 3`,
    );
    const runner = makeRunner({ binaryPath: stub });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(
        tempDir("eval-claude-sandbox-fail-"),
        tempDir("eval-claude-state-fail-"),
      ),
      prompt: "p",
      timeoutMs: 10_000,
      maxTokens: 400_000,
    });
    expect(trial.outcome).toBe("infra-error");
    expect(trial.error).toContain("boom");
  });

  test("isolates the child env and runs from the sandbox cwd", async () => {
    const state = tempDir("eval-claude-state-env-");
    const project = tempDir("eval-claude-sandbox-env-");
    const capture = join(project, "captured-env.txt");
    const stub = writeStub(
      tempDir("eval-claude-stub-env-"),
      `printenv HOME > '${capture}'
printenv CLAUDE_CONFIG_DIR >> '${capture}' || true
printenv EVAL_SECRET_MARKER >> '${capture}' || true
printenv ANTHROPIC_API_KEY >> '${capture}' || true
pwd >> '${capture}'
for arg do printf '%s\\n' "$arg" >> '${capture}'; done
exit 0`,
    );
    const runner = makeRunner({
      binaryPath: stub,
      baseEnv: {
        EVAL_SECRET_MARKER: "host-secret-exfiltrated",
        ANTHROPIC_API_KEY: "test-key",
        PATH: process.env.PATH ?? "",
      },
    });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(project, state),
      prompt: "the prompt",
      timeoutMs: 10_000,
      maxTokens: 100_000,
    });
    expect(trial.outcome).toBe("completed");
    const captured = readFileSync(capture, "utf8");
    expect(captured).toContain(join(state, "home"));
    expect(captured).toContain(join(state, "claude-config"));
    expect(captured).not.toContain("host-secret-exfiltrated");
    // The auth credential reaches the child; unrelated secrets do not.
    expect(captured).toContain("test-key");
    expect(captured).toContain("the prompt");
  });

  test("flags budget-unmonitored when the host emits no usage events", async () => {
    const stub = writeStub(tempDir("eval-claude-stub-silent-"), `echo done`);
    const runner = makeRunner({ binaryPath: stub });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(
        tempDir("eval-claude-sandbox-silent-"),
        tempDir("eval-claude-state-silent-"),
      ),
      prompt: "p",
      timeoutMs: 10_000,
      maxTokens: 400_000,
    });
    expect(trial.outcome).toBe("completed");
    expect(trial.budgetUnmonitored).toBe(true);
  });
});

describe("usage helpers", () => {
  test("normalizeClaudeUsage handles token and underscore shapes", () => {
    expect(normalizeClaudeUsage(1234)).toBe(1234);
    expect(normalizeClaudeUsage({ input_tokens: 300, output_tokens: 40 })).toBe(
      340,
    );
    expect(
      normalizeClaudeUsage({
        input_tokens: 300,
        output_tokens: 40,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 5,
      }),
    ).toBe(355);
    expect(normalizeClaudeUsage({ input: 10, output: 20 })).toBe(30);
    expect(normalizeClaudeUsage({})).toBeUndefined();
    expect(normalizeClaudeUsage(undefined)).toBeUndefined();
  });
});
