import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifacts, publishArtifacts } from "@atlante/artifacts";
import {
  createOpenCodeRunner,
  extractModelIdentifiers,
  mergePermissionBaseline,
  normalizeTokens,
} from "../../src/index.js";

const fixtureProject = join(import.meta.dir, "..", "fixtures", "project");

let projectRoot: string;
let authFile: string;
const cleanups: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

/** Writes an executable stub `opencode` whose behavior is driven by argv[0]'s marker file. */
function writeStub(dir: string, script: string): string {
  const path = join(dir, "opencode");
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
  return path;
}

beforeAll(() => {
  projectRoot = tempDir("eval-host-project-");
  cpSync(fixtureProject, projectRoot, { recursive: true });
  publishArtifacts(
    projectRoot,
    createArtifacts({
      agents: [
        {
          hostAgentId: "build",
          description: "Build agent",
          prompt: "You are a build agent.",
        },
      ],
      skills: [],
    }),
  );
  // Make @atlante/opencode resolvable from the temp project by linking the
  // repo's adapter package into the project's node_modules.
  const linkDir = join(projectRoot, "node_modules", "@atlante", "opencode");
  mkdirSync(join(linkDir, ".."), { recursive: true });
  cpSync(join(import.meta.dir, "..", "..", "..", "opencode"), linkDir, {
    recursive: true,
  });

  authFile = join(tempDir("eval-host-auth-"), "auth.json");
  writeFileSync(authFile, '{"github":{"type":"token"}}');
});

afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true });
});

function sandboxFor(sandboxProject: string, state: string) {
  return {
    root: sandboxProject,
    stateDir: state,
    snapshot: [],
    keep: false,
  };
}

describe("prepareHostIntegration", () => {
  test("rewrites the plugin to an absolute path and merges the baseline", () => {
    writeFileSync(
      join(projectRoot, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        plugin: ["@atlante/opencode"],
        agent: {
          build: { permission: { edit: "deny" } },
        },
      }),
    );
    const runner = createOpenCodeRunner({ projectRoot, authPath: authFile });
    const project = tempDir("eval-sandbox-pi-");
    const state = tempDir("eval-sandbox-state-");
    for (const sub of ["config", "data", "cache"])
      mkdirSync(join(state, sub), { recursive: true });
    const sandbox = sandboxFor(project, state);
    runner.prepareHostIntegration(sandbox, { agent: "build" });

    const written = JSON.parse(
      readFileSync(join(project, "opencode.json"), "utf8"),
    );
    expect(written.$schema).toBe("https://opencode.ai/config.json");
    expect(written.plugin[0]).not.toBe("@atlante/opencode");
    expect(existsSync(join(String(written.plugin[0]), "package.json"))).toBe(
      true,
    );
    // The agent's own policy survives unless it is a forced containment key.
    expect(written.agent.build.permission.edit).toBe("deny");
    // Forced denials are always present.
    expect(written.agent.build.permission.webfetch).toBe("deny");
    expect(written.agent.build.permission.external_directory).toBe("deny");
    expect(written.agent.build.permission.bash["rm -rf *"]).toBe("deny");
    expect(written.agent.build.permission.bash["*"]).toBe("allow");
    // The artifact agent and the default agent both get blocks.
    expect(written.agent.build).toBeDefined();
    // Auth injected into the redirected data dir.
    expect(existsSync(join(state, "data", "opencode", "auth.json"))).toBe(true);
  });

  test("fails with install guidance when the plugin cannot resolve", () => {
    const emptyRoot = tempDir("eval-host-empty-");
    const runner = createOpenCodeRunner({
      projectRoot: emptyRoot,
      authPath: authFile,
    });
    const project = tempDir("eval-sandbox-nopi-");
    expect(() =>
      runner.prepareHostIntegration(
        sandboxFor(project, tempDir("eval-sandbox-nost-")),
        {},
      ),
    ).toThrow(/@atlante\/opencode/);
  });

  test("fails closed when host auth is missing", () => {
    const runner = createOpenCodeRunner({
      projectRoot,
      authPath: join(tempDir("eval-host-noauth-"), "auth.json"),
    });
    const project = tempDir("eval-sandbox-noauth-");
    expect(() =>
      runner.prepareHostIntegration(
        sandboxFor(project, tempDir("eval-sandbox-noauth-state-")),
        {},
      ),
    ).toThrow(/auth/);
  });
});

describe("runTrial", () => {
  test("parses the event stream for usage and model identifiers", async () => {
    const stub = writeStub(
      tempDir("eval-stub-happy-"),
      `printf '%s\\n' '{"type":"session","info":{"providerID":"acme","modelID":"model-x"}}' '{"type":"step_finish","tokens":{"input":100,"output":50,"reasoning":10},"cost":0.01}' '{"type":"step_finish","tokens":{"input":200,"output":90,"reasoning":10},"cost":0.02}'`,
    );
    const runner = createOpenCodeRunner({
      projectRoot,
      binaryPath: stub,
      authPath: authFile,
    });
    const project = tempDir("eval-sandbox-happy-");
    const trial = await runner.runTrial({
      sandbox: sandboxFor(project, tempDir("eval-state-happy-")),
      prompt: "Say hi.",
      timeoutMs: 10_000,
      maxTokens: 100_000,
    });
    expect(trial.outcome).toBe("completed");
    expect(trial.tokens).toBe(300);
    expect(trial.cost).toBe(0.02);
    expect(trial.model).toBe("acme/model-x");
    expect(trial.modelVersion).toBe("model-x");
  });

  test("aborts in-flight past maxTokens with a budget-exceeded verdict", async () => {
    const stub = writeStub(
      tempDir("eval-stub-budget-"),
      `printf '%s\\n' '{"type":"step_finish","tokens":900000,"cost":1.5}' >&1
sleep 30`,
    );
    const runner = createOpenCodeRunner({
      projectRoot,
      binaryPath: stub,
      authPath: authFile,
    });
    const started = Date.now();
    const trial = await runner.runTrial({
      sandbox: sandboxFor(
        tempDir("eval-sandbox-budget-"),
        tempDir("eval-state-budget-"),
      ),
      prompt: "p",
      timeoutMs: 60_000,
      maxTokens: 400_000,
    });
    expect(trial.outcome).toBe("budget-exceeded");
    expect(trial.tokens).toBe(900_000);
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  test("aborts past the timeout", async () => {
    const stub = writeStub(tempDir("eval-stub-slow-"), `sleep 30`);
    const runner = createOpenCodeRunner({
      projectRoot,
      binaryPath: stub,
      authPath: authFile,
    });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(
        tempDir("eval-sandbox-slow-"),
        tempDir("eval-state-slow-"),
      ),
      prompt: "p",
      timeoutMs: 400,
      maxTokens: 400_000,
    });
    expect(trial.outcome).toBe("timeout");
  });

  test("non-zero exit is an infra error with stderr evidence", async () => {
    const stub = writeStub(tempDir("eval-stub-fail-"), `echo boom >&2; exit 3`);
    const runner = createOpenCodeRunner({
      projectRoot,
      binaryPath: stub,
      authPath: authFile,
    });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(
        tempDir("eval-sandbox-fail-"),
        tempDir("eval-state-fail-"),
      ),
      prompt: "p",
      timeoutMs: 10_000,
      maxTokens: 400_000,
    });
    expect(trial.outcome).toBe("infra-error");
    expect(trial.error).toContain("boom");
  });

  test("isolates XDG dirs, injects auth, and targets the sandbox via --dir", async () => {
    const state = tempDir("eval-state-env-");
    mkdirSync(join(state, "data", "opencode"), { recursive: true });
    writeFileSync(join(state, "data", "opencode", "auth.json"), "{}");
    const project = tempDir("eval-sandbox-env-");
    const capture = join(project, "captured-env.txt");
    const stub = writeStub(
      tempDir("eval-stub-env-"),
      `printenv XDG_CONFIG_HOME > "$CAPTURE_FILE"
printenv XDG_DATA_HOME >> "$CAPTURE_FILE"
printenv XDG_CACHE_HOME >> "$CAPTURE_FILE"
for arg do printf '%s\\n' "$arg" >> "$CAPTURE_FILE"; done
test -f "$XDG_DATA_HOME/opencode/auth.json" || exit 9
exit 0`,
    );
    const runner = createOpenCodeRunner({
      projectRoot,
      binaryPath: stub,
      authPath: authFile,
      baseEnv: { CAPTURE_FILE: capture, PATH: process.env.PATH },
    });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(project, state),
      prompt: "the prompt",
      agent: "build",
      timeoutMs: 10_000,
      maxTokens: 100_000,
    });
    expect(trial.outcome).toBe("completed");
    const captured = readFileSync(capture, "utf8");
    expect(captured).toContain(join(state, "config"));
    expect(captured).toContain(join(state, "data"));
    expect(captured).toContain(join(state, "cache"));
    // The host is pointed at the sandbox via --dir and receives the prompt.
    expect(captured).toContain("--dir");
    expect(captured).toContain(project);
    expect(captured).toContain("the prompt");
  });
});

describe("event helpers", () => {
  test("normalizeTokens handles numeric and component shapes", () => {
    expect(normalizeTokens(1234)).toBe(1234);
    expect(normalizeTokens({ input: 10, output: 20, reasoning: 5 })).toBe(35);
    expect(
      normalizeTokens({ input: 1, output: 2, cache: { read: 3, write: 4 } }),
    ).toBe(10);
    expect(normalizeTokens({})).toBeUndefined();
    expect(normalizeTokens(undefined)).toBeUndefined();
  });

  test("extractModelIdentifiers reads nested message events", () => {
    expect(extractModelIdentifiers({ providerID: "p", modelID: "m" })).toEqual({
      provider: "p",
      model: "m",
    });
    expect(
      extractModelIdentifiers({ message: { providerID: "p", modelID: "m" } }),
    ).toEqual({ provider: "p", model: "m" });
    expect(extractModelIdentifiers({ type: "step_finish" })).toBeUndefined();
  });
});

describe("mergePermissionBaseline", () => {
  test("keeps agent policy except forced containment denials", () => {
    const merged = mergePermissionBaseline({
      edit: "ask",
      bash: { "git push *": "deny" },
    });
    expect(merged.edit).toBe("ask");
    expect(merged.webfetch).toBe("deny");
    expect(merged.websearch).toBe("deny");
    expect(merged.external_directory).toBe("deny");
    expect(merged.bash).toEqual({
      "*": "allow",
      "git push *": "deny",
      "rm -rf *": "deny",
      "rm -fr *": "deny",
      "sudo *": "deny",
    });
  });
});
