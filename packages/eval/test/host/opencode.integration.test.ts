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
import { materializeOpenCode } from "@atlante/opencode";
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
  materializeOpenCode(projectRoot, {
    agents: [
      {
        hostAgentId: "build",
        description: "Build agent",
        prompt: "You are a build agent.",
      },
    ],
    skills: [],
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
    baseline: "",
    keep: false,
  };
}

describe("prepareHostIntegration", () => {
  test("merges native agents and the permission baseline", () => {
    writeFileSync(
      join(projectRoot, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
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
    expect(written.plugin).toBeUndefined();
    // The agent's own policy survives unless it is a forced containment key.
    expect(written.agent.build.permission.edit).toBe("deny");
    // Forced denials are always present.
    expect(written.agent.build.permission.webfetch).toBe("deny");
    expect(written.agent.build.permission.external_directory).toBe("deny");
    expect(written.agent.build.permission.bash["rm -rf *"]).toBe("deny");
    expect(written.agent.build.permission.bash["*"]).toBe("allow");
    expect(
      Object.keys(written.agent.build.permission.bash).slice(0, 3),
    ).toEqual(["rm -rf *", "rm -fr *", "sudo *"]);
    // The native agent and the default agent both get blocks.
    expect(written.agent.build).toBeDefined();
    // Auth injected into the redirected data dir.
    expect(existsSync(join(state, "data", "opencode", "auth.json"))).toBe(true);
  });

  test.each(["opencode.jsonc", "opencode.json"] as const)(
    "uses the nested project OpenCode configuration (%s) as the sandbox target",
    (filename) => {
      const nestedDirectory = join(projectRoot, ".opencode");
      const nestedConfig = join(nestedDirectory, filename);
      const rootConfig = join(projectRoot, "opencode.json");
      mkdirSync(nestedDirectory, { recursive: true });
      writeFileSync(
        nestedConfig,
        JSON.stringify({
          model: "nested-model",
          agent: { nested: { description: "Nested agent" } },
        }),
      );
      writeFileSync(
        rootConfig,
        JSON.stringify({
          small_model: "root-small-model",
          agent: { root: { description: "Root agent" } },
        }),
      );
      try {
        const runner = createOpenCodeRunner({
          projectRoot,
          authPath: authFile,
        });
        const project = tempDir(`eval-sandbox-nested-${filename}-`);
        runner.prepareHostIntegration(
          sandboxFor(project, tempDir(`eval-state-nested-${filename}-`)),
          {},
        );

        const written = JSON.parse(
          readFileSync(join(project, ".opencode", filename), "utf8"),
        );
        expect(written.model).toBe("nested-model");
        expect(written.small_model).toBe("root-small-model");
        expect(written.agent.nested.description).toBe("Nested agent");
        expect(written.agent.root.description).toBe("Root agent");
        expect(existsSync(join(project, "opencode.json"))).toBe(false);
      } finally {
        rmSync(nestedConfig, { force: true });
        rmSync(rootConfig, { force: true });
      }
    },
  );

  test("does not inherit project MCP servers into the eval sandbox", () => {
    const nestedDirectory = join(projectRoot, ".opencode");
    const config = join(nestedDirectory, "opencode.jsonc");
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(
      config,
      JSON.stringify({
        mcp: {
          projectTool: {
            type: "local",
            command: ["node", "-e", "process.exit(0)"],
          },
        },
      }),
    );
    try {
      const runner = createOpenCodeRunner({
        projectRoot,
        authPath: authFile,
      });
      const project = tempDir("eval-sandbox-no-mcp-");
      runner.prepareHostIntegration(
        sandboxFor(project, tempDir("eval-state-no-mcp-")),
        {},
      );
      const written = JSON.parse(
        readFileSync(join(project, ".opencode", "opencode.jsonc"), "utf8"),
      );
      expect(written.mcp).toBeUndefined();
    } finally {
      rmSync(config, { force: true });
    }
  });

  test("serializes a __proto__ agent id as an own agent entry", () => {
    const config = join(projectRoot, "opencode.json");
    writeFileSync(config, JSON.stringify({}));
    try {
      const runner = createOpenCodeRunner({
        projectRoot,
        authPath: authFile,
      });
      const project = tempDir("eval-sandbox-proto-agent-");
      runner.prepareHostIntegration(
        sandboxFor(project, tempDir("eval-state-proto-agent-")),
        {
          agent: "__proto__",
        },
      );

      const written = JSON.parse(
        readFileSync(join(project, "opencode.json"), "utf8"),
      );
      expect(Object.hasOwn(written.agent, "__proto__")).toBe(true);
      expect(
        Object.getOwnPropertyDescriptor(written.agent, "__proto__")?.value,
      ).toMatchObject({ permission: { webfetch: "deny" } });
    } finally {
      rmSync(config, { force: true });
    }
  });

  test("fails closed when native outputs are unavailable", () => {
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
    ).toThrow(/ownership manifest is missing/);
  });

  test("rejects a fixture-provided opencode.jsonc that would shadow the generated config", () => {
    const config = join(projectRoot, "opencode.json");
    writeFileSync(config, JSON.stringify({}));
    try {
      const runner = createOpenCodeRunner({
        projectRoot,
        authPath: authFile,
      });
      const project = tempDir("eval-sandbox-jsonc-");
      writeFileSync(join(project, "opencode.jsonc"), "{}\n");
      expect(() =>
        runner.prepareHostIntegration(
          sandboxFor(project, tempDir("eval-state-jsonc-")),
          {},
        ),
      ).toThrow(/opencode\.jsonc/);
    } finally {
      rmSync(config, { force: true });
    }
  });

  test.each(["opencode.jsonc", "opencode.json"] as const)(
    "rejects a fixture-provided nested .opencode/%s",
    (filename) => {
      const config = join(projectRoot, "opencode.json");
      writeFileSync(config, JSON.stringify({}));
      try {
        const runner = createOpenCodeRunner({
          projectRoot,
          authPath: authFile,
        });
        const project = tempDir(`eval-sandbox-nested-config-${filename}-`);
        const nestedDirectory = join(project, ".opencode");
        mkdirSync(nestedDirectory, { recursive: true });
        writeFileSync(join(nestedDirectory, filename), "{}\n");
        expect(() =>
          runner.prepareHostIntegration(
            sandboxFor(
              project,
              tempDir(`eval-state-nested-config-${filename}-`),
            ),
            {},
          ),
        ).toThrow(new RegExp(`fixture provides .*\\.opencode/${filename}`));
      } finally {
        rmSync(config, { force: true });
      }
    },
  );

  test("fails closed when host auth is missing", () => {
    // Own config: this test must not depend on config left behind by an
    // earlier test in the file.
    const config = join(projectRoot, "opencode.json");
    writeFileSync(config, JSON.stringify({}));
    try {
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
    } finally {
      rmSync(config, { force: true });
    }
  });

  test("fails closed when the host configuration is malformed", () => {
    const config = join(projectRoot, "opencode.jsonc");
    writeFileSync(config, '{"agent":\n');
    try {
      const runner = createOpenCodeRunner({
        projectRoot,
        authPath: authFile,
      });
      expect(() =>
        runner.prepareHostIntegration(
          sandboxFor(
            tempDir("eval-sandbox-malformed-"),
            tempDir("eval-state-malformed-"),
          ),
          {},
        ),
      ).toThrow(/malformed/);
    } finally {
      rmSync(config, { force: true });
    }
  });

  test("accepts JSONC comments in an existing opencode.json", () => {
    const config = join(projectRoot, "opencode.json");
    writeFileSync(
      config,
      `{
  // Existing OpenCode configurations may use JSONC syntax.
  "agent": {
    "jsonc": { "permission": "deny" },
  },
}
`,
    );
    try {
      const runner = createOpenCodeRunner({
        projectRoot,
        authPath: authFile,
      });
      const project = tempDir("eval-sandbox-jsonc-host-");
      runner.prepareHostIntegration(
        sandboxFor(project, tempDir("eval-state-jsonc-host-")),
        {},
      );
      const written = JSON.parse(
        readFileSync(join(project, "opencode.json"), "utf8"),
      );
      expect(written.agent.jsonc.permission.edit).toBe("deny");
    } finally {
      rmSync(config, { force: true });
    }
  });

  test("merges the configured default agent into the baseline", () => {
    const config = join(projectRoot, "opencode.json");
    writeFileSync(
      config,
      JSON.stringify({
        default_agent: "custom",
        agent: { custom: { permission: "deny" } },
      }),
    );
    try {
      const runner = createOpenCodeRunner({
        projectRoot,
        authPath: authFile,
      });
      const project = tempDir("eval-sandbox-default-agent-");
      const state = tempDir("eval-state-default-agent-");
      runner.prepareHostIntegration(sandboxFor(project, state), {});
      const written = JSON.parse(
        readFileSync(join(project, "opencode.json"), "utf8"),
      );
      expect(written.agent.custom.permission.read).toBe("deny");
      expect(written.agent.custom.permission.webfetch).toBe("deny");
    } finally {
      rmSync(config, { force: true });
    }
  });
});

describe("runTrial", () => {
  test("parses the event stream for usage and model identifiers", async () => {
    // First two events mirror the real 1.18.x stream (usage nested in `part`
    // with a precomputed total); the third keeps the top-level shape as the
    // defensive fallback for other host versions.
    const stub = writeStub(
      tempDir("eval-stub-happy-"),
      `printf '%s\\n' '{"type":"session","info":{"providerID":"acme","modelID":"model-x"}}' '{"type":"session","info":{"providerID":"other","modelID":"model-y"}}' '{"type":"step_finish","part":{"type":"step-finish","tokens":{"total":350,"input":300,"output":40,"reasoning":10,"cache":{"read":0,"write":0}},"cost":0.01}}' '{"type":"step_finish","tokens":440,"cost":0.02}'`,
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
    expect(trial.tokens).toBe(440);
    expect(trial.cost).toBe(0.02);
    expect(trial.model).toBe("acme/model-x");
    expect(trial.modelVersion).toBe("model-x");
    // Usage events were seen, so the budget was monitored.
    expect(trial.budgetUnmonitored).toBeUndefined();
  });

  // Both abort tests spawn real processes whose kill path includes a 5s
  // grace escalation; bun's default 5s per-test timeout is too tight under
  // parallel full:check load, so give them explicit headroom.
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
    // Generous bound: the escalation adds a 5s grace plus kill time, and
    // parallel CI load can stretch both. The assertion only guards against
    // the 30s sleep completing, i.e. the kill never happening.
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 30_000);

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
  }, 30_000);

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
      `printenv XDG_CONFIG_HOME > '${capture}'
printenv XDG_DATA_HOME >> '${capture}'
printenv XDG_CACHE_HOME >> '${capture}'
printenv PATH >> '${capture}'
printenv EVAL_SECRET_MARKER >> '${capture}' || true
printenv HTTPS_PROXY >> '${capture}' || true
printenv NO_PROXY >> '${capture}' || true
printenv HTTP_PROXY >> '${capture}' || true
for arg do printf '%s\\n' "$arg" >> '${capture}'; done
test -f "$XDG_DATA_HOME/opencode/auth.json" || exit 9
exit 0`,
    );
    const runner = createOpenCodeRunner({
      projectRoot,
      binaryPath: stub,
      authPath: authFile,
      // PATH and NO_PROXY are on the allowlist verbatim; other host
      // variables must stay with the host or arrive sanitized only.
      baseEnv: {
        EVAL_SECRET_MARKER: "host-secret-exfiltrated",
        HTTPS_PROXY: "https://proxy-user:proxy-secret@example.test:8443",
        // Scheme-less form: credentials cannot be located reliably, so the
        // whole value must be dropped rather than passed through.
        HTTP_PROXY: "proxy-user:proxy-secret@proxy.example.test:8080",
        NO_PROXY: "localhost,127.0.0.1,.internal.example.com",
        PATH: process.env.PATH ?? "",
      },
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
    // Allowlisted vars reach the child; everything else stays with the host.
    const firstPathDir = (process.env.PATH ?? "").split(":")[0] ?? "";
    expect(firstPathDir).not.toBe("");
    expect(captured).toContain(firstPathDir);
    expect(captured).not.toContain("host-secret-exfiltrated");
    expect(captured).not.toContain("proxy-user");
    expect(captured).not.toContain("proxy-secret");
    expect(captured).toContain("https://example.test:8443/");
    // No-proxy lists are host names, not URLs: they must survive verbatim.
    expect(captured).toContain("localhost,127.0.0.1,.internal.example.com");
    // The scheme-less proxy value is dropped entirely, credentials included.
    expect(captured).not.toContain("proxy.example.test");
    // The host is pointed at the sandbox via --dir and receives the prompt.
    expect(captured).toContain("--dir");
    expect(captured).toContain(project);
    expect(captured).toContain("the prompt");
  });

  test("flags budget-unmonitored when the host emits no usage events", async () => {
    const stub = writeStub(tempDir("eval-stub-silent-"), `echo done`);
    const runner = createOpenCodeRunner({
      projectRoot,
      binaryPath: stub,
      authPath: authFile,
    });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(
        tempDir("eval-sandbox-silent-"),
        tempDir("eval-state-silent-"),
      ),
      prompt: "p",
      timeoutMs: 10_000,
      maxTokens: 400_000,
    });
    expect(trial.outcome).toBe("completed");
    expect(trial.budgetUnmonitored).toBe(true);
  });
});

describe("event helpers", () => {
  test("normalizeTokens handles numeric, total, and component shapes", () => {
    expect(normalizeTokens(1234)).toBe(1234);
    expect(normalizeTokens({ total: 8880, input: 8849, output: 3 })).toBe(8880);
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
    for (const permission of [
      "read",
      "glob",
      "grep",
      "list",
      "task",
      "skill",
      "lsp",
      "question",
      "todowrite",
      "doom_loop",
    ]) {
      expect(merged[permission]).toBe("allow");
    }
    expect(merged.bash).toEqual({
      "*": "allow",
      "git push *": "deny",
      "rm -rf *": "deny",
      "rm -fr *": "deny",
      "sudo *": "deny",
    });
  });

  test("preserves scalar Bash policies while adding forced denials", () => {
    expect(mergePermissionBaseline({ bash: "deny" }).bash).toEqual({
      "*": "deny",
      "rm -rf *": "deny",
      "rm -fr *": "deny",
      "sudo *": "deny",
    });
  });

  test("preserves restrictive scalar permissions while adding denials", () => {
    const merged = mergePermissionBaseline("deny");
    expect(merged.read).toBe("deny");
    expect(merged.edit).toBe("deny");
    expect(Object.keys(merged).filter((key) => /^\d+$/.test(key))).toEqual([]);
    expect(merged.bash).toEqual({
      "rm -rf *": "deny",
      "rm -fr *": "deny",
      "sudo *": "deny",
      "*": "deny",
    });
  });
});
