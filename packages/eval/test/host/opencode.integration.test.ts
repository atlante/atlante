import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
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
import { dirname, join } from "node:path";
import { materializeOpenCode } from "@atlante/opencode";
import type { OpenCodeRunnerOptions } from "../../src/index.js";
import {
  checkOpenCodeAuth,
  createEvalPermissionPolicy,
  createOpenCodeRunner,
  extractModelIdentifiers,
  normalizeTokens,
  sqliteRuntimeArguments,
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

function makeRunner(options: Partial<OpenCodeRunnerOptions> = {}) {
  return createOpenCodeRunner({
    projectRoot,
    authPath: authFile,
    versionProbe: () => "opencode v1.18.29\n",
    ...options,
  });
}

const WRITE_V2_AUTH_DATABASE = `
import { DatabaseSync } from "node:sqlite";

const [path] = process.argv.slice(1);
if (!path) throw new Error("missing database path");
const database = new DatabaseSync(path);
database.exec(
  "CREATE TABLE history (id TEXT PRIMARY KEY, secret TEXT NOT NULL);" +
    "CREATE TABLE credential (" +
    "id TEXT PRIMARY KEY, integration_id TEXT, label TEXT NOT NULL, " +
    "value TEXT NOT NULL, connector_id TEXT, method_id TEXT, active INTEGER, " +
    "time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);" +
    'CREATE TABLE migration (id TEXT PRIMARY KEY, hash TEXT NOT NULL, applied INTEGER NOT NULL);' +
    'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER NOT NULL);',
);
database
  .prepare("INSERT INTO history (id, secret) VALUES (?, ?)")
  .run("history-1", "must-not-leak");
database
  .prepare(
    "INSERT INTO credential (id, integration_id, label, value, active, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
  .run(
    "credential-1",
    "openai",
    "default",
    JSON.stringify({ type: "key", key: "test-key" }),
    1,
    1,
    1,
  );
database
  .prepare("INSERT INTO migration (id, hash, applied) VALUES (?, ?, ?)")
  .run("0001", "migration-hash-0001", 1);
database
  .prepare(
    "INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES (?, ?, ?)",
  )
  .run(1, "drizzle-hash-0001", 1700000000000);
database.close();
`;

const WRITE_LEGACY_V2_AUTH_DATABASE = `
import { DatabaseSync } from "node:sqlite";

const [path] = process.argv.slice(1);
if (!path) throw new Error("missing database path");
const database = new DatabaseSync(path);
// A pre-migration V2 database: credential state plus only the legacy named
// drizzle journal, which the host replays into its new migration table.
database.exec(
  "CREATE TABLE credential (" +
    "id TEXT PRIMARY KEY, integration_id TEXT, label TEXT NOT NULL, " +
    "value TEXT NOT NULL, connector_id TEXT, method_id TEXT, active INTEGER, " +
    "time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL);" +
    'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, tag TEXT NOT NULL, "when" INTEGER NOT NULL);',
);
database
  .prepare(
    "INSERT INTO credential (id, integration_id, label, value, active, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
  .run(
    "credential-1",
    "openai",
    "default",
    JSON.stringify({ type: "key", key: "test-key" }),
    1,
    1,
    1,
  );
database
  .prepare('INSERT INTO __drizzle_migrations (id, tag, "when") VALUES (?, ?, ?)')
  .run(1, "0001_legacy_migration", 1700000000);
database.close();
`;

const READ_SQLITE_ROWS = `
import { DatabaseSync } from "node:sqlite";

const [path, query] = process.argv.slice(1);
if (!path || !query) throw new Error("missing database query");
const database = new DatabaseSync(path, { readOnly: true });
console.log(JSON.stringify(database.prepare(query).all()));
database.close();
`;

function writeV2AuthDatabase(path: string): void {
  execFileSync(
    "node",
    ["--input-type=module", "-e", WRITE_V2_AUTH_DATABASE, path],
    { stdio: "ignore" },
  );
}

function writeLegacyV2AuthDatabase(path: string): void {
  execFileSync(
    "node",
    ["--input-type=module", "-e", WRITE_LEGACY_V2_AUTH_DATABASE, path],
    { stdio: "ignore" },
  );
}

function readSqliteRows(path: string, query: string): unknown[] {
  return JSON.parse(
    execFileSync(
      "node",
      ["--input-type=module", "-e", READ_SQLITE_ROWS, path, query],
      { encoding: "utf8" },
    ),
  ) as unknown[];
}

describe("prepareHostIntegration", () => {
  test("recognizes a V2 database as an authentication source", () => {
    const dataHome = tempDir("eval-host-v2-auth-data-");
    mkdirSync(join(dataHome, "opencode"), { recursive: true });
    writeFileSync(join(dataHome, "opencode", "opencode.db"), "SQLite format 3");
    const previous = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = dataHome;
    try {
      expect(checkOpenCodeAuth().authenticated).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
    }
  });

  test("copies V2 credentials without copying unrelated database data", () => {
    const source = join(tempDir("eval-host-v2-auth-source-"), "opencode.db");
    writeV2AuthDatabase(source);
    const config = join(projectRoot, "opencode.json");
    writeFileSync(config, "{}\n");
    const previousPath = process.env.PATH;
    delete process.env.PATH;
    try {
      const host = createOpenCodeRunner({
        projectRoot,
        authPath: join(tempDir("eval-host-v2-no-legacy-auth-"), "auth.json"),
        authDatabasePath: source,
        versionProbe: () => "opencode v2.0.3\n",
      });
      const state = tempDir("eval-state-v2-auth-copy-");
      const project = tempDir("eval-sandbox-v2-auth-copy-");
      host.prepareHostIntegration(sandboxFor(project, state), {});
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;

      const target = join(state, "data", "opencode", "opencode.db");
      expect(
        readSqliteRows(target, "SELECT integration_id, value FROM credential"),
      ).toEqual([
        { integration_id: "openai", value: '{"type":"key","key":"test-key"}' },
      ]);
      expect(readSqliteRows(target, "SELECT secret FROM history")).toEqual([]);
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(config, { force: true });
    }
  });

  test("preserves the migration journal the V2 host reads", () => {
    const source = join(tempDir("eval-host-v2-journal-"), "opencode.db");
    writeV2AuthDatabase(source);
    const host = createOpenCodeRunner({
      projectRoot,
      authPath: join(tempDir("eval-host-v2-no-legacy-auth-"), "auth.json"),
      authDatabasePath: source,
      versionProbe: () => "opencode v2.0.3\n",
    });
    const state = tempDir("eval-state-v2-journal-");
    const project = tempDir("eval-sandbox-v2-journal-");
    host.prepareHostIntegration(sandboxFor(project, state), {});

    const target = join(state, "data", "opencode", "opencode.db");
    expect(readSqliteRows(target, "SELECT hash FROM migration")).toEqual([
      { hash: "migration-hash-0001" },
    ]);
    expect(
      readSqliteRows(target, "SELECT hash FROM __drizzle_migrations"),
    ).toEqual([{ hash: "drizzle-hash-0001" }]);
  });

  test("preserves a legacy named journal when no migration table exists", () => {
    const source = join(tempDir("eval-host-v2-legacy-journal-"), "opencode.db");
    writeLegacyV2AuthDatabase(source);
    const host = createOpenCodeRunner({
      projectRoot,
      authPath: join(tempDir("eval-host-v2-no-legacy-auth-"), "auth.json"),
      authDatabasePath: source,
      versionProbe: () => "opencode v2.0.3\n",
    });
    const state = tempDir("eval-state-v2-legacy-journal-");
    const project = tempDir("eval-sandbox-v2-legacy-journal-");
    host.prepareHostIntegration(sandboxFor(project, state), {});

    const target = join(state, "data", "opencode", "opencode.db");
    expect(
      readSqliteRows(target, "SELECT tag FROM __drizzle_migrations"),
    ).toEqual([{ tag: "0001_legacy_migration" }]);
    expect(
      readSqliteRows(target, "SELECT integration_id FROM credential"),
    ).toEqual([{ integration_id: "openai" }]);
  });

  test("resolves a relative OPENCODE_DB override for V2 auth", () => {
    const dataHome = tempDir("eval-host-v2-auth-override-");
    const source = join(dataHome, "opencode", "profiles", "custom.db");
    mkdirSync(dirname(source), { recursive: true });
    writeV2AuthDatabase(source);

    const host = createOpenCodeRunner({
      projectRoot,
      authPath: join(tempDir("eval-host-v2-no-legacy-auth-"), "auth.json"),
      baseEnv: {
        PATH: process.env.PATH,
        XDG_DATA_HOME: dataHome,
        OPENCODE_DB: "profiles/custom.db",
      },
      versionProbe: () => "opencode v2.0.3\n",
    });
    const state = tempDir("eval-state-v2-auth-override-");
    const project = tempDir("eval-sandbox-v2-auth-override-");
    host.prepareHostIntegration(sandboxFor(project, state), {});

    expect(
      readSqliteRows(
        join(state, "data", "opencode", "opencode.db"),
        "SELECT integration_id FROM credential",
      ),
    ).toEqual([{ integration_id: "openai" }]);
  });

  test("resolves the channel-specific V2 database path from the host", () => {
    const source = join(
      tempDir("eval-host-v2-channel-auth-"),
      "opencode-preview.db",
    );
    writeV2AuthDatabase(source);
    const stub = writeStub(
      tempDir("eval-stub-v2-channel-path-"),
      `if [ "$1" = "debug" ] && [ "$2" = "paths" ] && [ "$3" = "db" ]; then printf '%s\\n' '${source}'; exit 0; fi
exit 1`,
    );

    const host = createOpenCodeRunner({
      projectRoot,
      binaryPath: stub,
      authPath: join(tempDir("eval-host-v2-no-legacy-auth-"), "auth.json"),
      baseEnv: { PATH: process.env.PATH },
      versionProbe: () => "opencode v2.0.3\n",
    });
    const state = tempDir("eval-state-v2-channel-auth-");
    const project = tempDir("eval-sandbox-v2-channel-auth-");
    host.prepareHostIntegration(sandboxFor(project, state), {});

    expect(
      readSqliteRows(
        join(state, "data", "opencode", "opencode.db"),
        "SELECT integration_id FROM credential",
      ),
    ).toEqual([{ integration_id: "openai" }]);
  });

  test("writes an autonomous V2 config instead of inheriting project settings", () => {
    const config = join(projectRoot, "opencode.json");
    writeFileSync(
      config,
      JSON.stringify({
        model: "project-model",
        plugin: ["project-plugin"],
        providers: { project: { package: "project-provider" } },
        mcp: { projectTool: { type: "local", command: ["bad-tool"] } },
        permissions: [{ action: "edit", resource: "*", effect: "deny" }],
      }),
    );
    try {
      const host = createOpenCodeRunner({
        projectRoot,
        authPath: authFile,
        versionProbe: () => "opencode v2.0.3\n",
      });
      const project = tempDir("eval-sandbox-v2-config-");
      const state = tempDir("eval-state-v2-config-");
      host.prepareHostIntegration(sandboxFor(project, state), {
        agent: "reviewer",
      });

      const written = JSON.parse(
        readFileSync(join(project, "opencode.json"), "utf8"),
      );
      expect(written).toMatchObject({
        $schema: "https://opencode.ai/config.json",
        default_agent: "build",
      });
      expect(written.model).toBeUndefined();
      expect(written.plugin).toBeUndefined();
      expect(written.providers).toBeUndefined();
      expect(written.mcp).toBeUndefined();
      expect(written.permissions).toEqual(
        expect.arrayContaining([
          { action: "edit", resource: "*", effect: "allow" },
          { action: "webfetch", resource: "*", effect: "deny" },
          { action: "shell", resource: "rm -rf *", effect: "deny" },
        ]),
      );
      expect(written.agents.build.permissions).toEqual(written.permissions);
      expect(written.agents.reviewer.permissions).toEqual(written.permissions);
    } finally {
      rmSync(config, { force: true });
    }
  });

  test("writes native agents and an isolated V1 permission policy", () => {
    writeFileSync(
      join(projectRoot, "opencode.json"),
      JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        agent: {
          build: { permission: { edit: "deny" } },
        },
      }),
    );
    const host = makeRunner();
    const project = tempDir("eval-sandbox-pi-");
    const state = tempDir("eval-sandbox-state-");
    for (const sub of ["config", "data", "cache"])
      mkdirSync(join(state, sub), { recursive: true });
    const sandbox = sandboxFor(project, state);
    host.prepareHostIntegration(sandbox, { agent: "build" });

    const written = JSON.parse(
      readFileSync(join(project, "opencode.json"), "utf8"),
    );
    expect(written.$schema).toBe("https://opencode.ai/config.json");
    expect(written.plugin).toBeUndefined();
    // Project permission settings are not inherited by eval.
    expect(written.agent.build.permission.edit).toBe("allow");
    // Forced denials are always present.
    expect(written.agent.build.permission.webfetch).toBe("deny");
    expect(written.agent.build.permission.external_directory).toBe("deny");
    expect(written.agent.build.permission.bash["rm -rf *"]).toBe("deny");
    expect(written.agent.build.permission.bash["*"]).toBe("allow");
    expect(written.agent.build.permission.read["*.env"]).toBe("deny");
    expect(
      Object.keys(written.agent.build.permission.bash).slice(0, 3),
    ).toEqual(["*", "rm -rf *", "rm -fr *"]);
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
        const host = makeRunner();
        const project = tempDir(`eval-sandbox-nested-${filename}-`);
        host.prepareHostIntegration(
          sandboxFor(project, tempDir(`eval-state-nested-${filename}-`)),
          {},
        );

        const written = JSON.parse(
          readFileSync(join(project, ".opencode", filename), "utf8"),
        );
        expect(written.model).toBeUndefined();
        expect(written.small_model).toBeUndefined();
        expect(written.agent.nested).toBeUndefined();
        expect(written.agent.root).toBeUndefined();
        expect(written.agent.build).toBeDefined();
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
      const host = makeRunner();
      const project = tempDir("eval-sandbox-no-mcp-");
      host.prepareHostIntegration(
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
      const host = makeRunner();
      const project = tempDir("eval-sandbox-proto-agent-");
      host.prepareHostIntegration(
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
    const host = createOpenCodeRunner({
      projectRoot: emptyRoot,
      authPath: authFile,
      versionProbe: () => "opencode v1.18.29\n",
    });
    const project = tempDir("eval-sandbox-nopi-");
    expect(() =>
      host.prepareHostIntegration(
        sandboxFor(project, tempDir("eval-sandbox-nost-")),
        {},
      ),
    ).toThrow(/ownership manifest is missing/);
  });

  test("fails closed when the host version is unsupported", () => {
    expect(() =>
      createOpenCodeRunner({
        projectRoot,
        authPath: authFile,
        versionProbe: () => "opencode v3.0.0\n",
      }),
    ).toThrow(/unsupported OpenCode version/);
  });

  test("rejects a fixture-provided opencode.jsonc that would shadow the generated config", () => {
    const config = join(projectRoot, "opencode.json");
    writeFileSync(config, JSON.stringify({}));
    try {
      const host = makeRunner();
      const project = tempDir("eval-sandbox-jsonc-");
      writeFileSync(join(project, "opencode.jsonc"), "{}\n");
      expect(() =>
        host.prepareHostIntegration(
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
        const host = makeRunner();
        const project = tempDir(`eval-sandbox-nested-config-${filename}-`);
        const nestedDirectory = join(project, ".opencode");
        mkdirSync(nestedDirectory, { recursive: true });
        writeFileSync(join(nestedDirectory, filename), "{}\n");
        expect(() =>
          host.prepareHostIntegration(
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

  test("rejects a lower-precedence fixture config when the project target is nested", () => {
    const nestedDirectory = join(projectRoot, ".opencode");
    const nestedConfig = join(nestedDirectory, "opencode.jsonc");
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(nestedConfig, '{ "model": "nested-model" }');
    try {
      const host = makeRunner();
      const project = tempDir("eval-sandbox-shadowing-root-config-");
      writeFileSync(
        join(project, "opencode.json"),
        JSON.stringify({
          mcp: {
            fixtureTool: {
              type: "local",
              command: ["node", "-e", "process.exit(0)"],
            },
          },
        }),
      );
      expect(() =>
        host.prepareHostIntegration(
          sandboxFor(project, tempDir("eval-state-shadowing-root-config-")),
          {},
        ),
      ).toThrow(/opencode\.json/);
    } finally {
      rmSync(nestedConfig, { force: true });
    }
  });

  test("fails closed when host auth is missing", () => {
    // Own config: this test must not depend on config left behind by an
    // earlier test in the file.
    const config = join(projectRoot, "opencode.json");
    writeFileSync(config, JSON.stringify({}));
    try {
      const host = makeRunner({
        authPath: join(tempDir("eval-host-noauth-"), "auth.json"),
      });
      const project = tempDir("eval-sandbox-noauth-");
      expect(() =>
        host.prepareHostIntegration(
          sandboxFor(project, tempDir("eval-sandbox-noauth-state-")),
          {},
        ),
      ).toThrow(/auth/);
    } finally {
      rmSync(config, { force: true });
    }
  });

  test("ignores malformed project OpenCode configuration", () => {
    const config = join(projectRoot, "opencode.jsonc");
    writeFileSync(config, '{"agent":\n');
    try {
      const host = makeRunner();
      const project = tempDir("eval-sandbox-malformed-");
      host.prepareHostIntegration(
        sandboxFor(project, tempDir("eval-state-malformed-")),
        {},
      );
      const written = JSON.parse(
        readFileSync(join(project, "opencode.jsonc"), "utf8"),
      );
      expect(written.default_agent).toBe("build");
      expect(written.agent.build).toBeDefined();
    } finally {
      rmSync(config, { force: true });
    }
  });

  test("does not inherit JSONC project settings", () => {
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
      const host = makeRunner();
      const project = tempDir("eval-sandbox-jsonc-host-");
      host.prepareHostIntegration(
        sandboxFor(project, tempDir("eval-state-jsonc-host-")),
        {},
      );
      const written = JSON.parse(
        readFileSync(join(project, "opencode.json"), "utf8"),
      );
      expect(written.agent.jsonc).toBeUndefined();
      expect(written.agent.build).toBeDefined();
    } finally {
      rmSync(config, { force: true });
    }
  });

  test("uses the explicit build default instead of a project default agent", () => {
    const config = join(projectRoot, "opencode.json");
    writeFileSync(
      config,
      JSON.stringify({
        default_agent: "custom",
        agent: { custom: { permission: "deny" } },
      }),
    );
    try {
      const host = makeRunner();
      const project = tempDir("eval-sandbox-default-agent-");
      const state = tempDir("eval-state-default-agent-");
      host.prepareHostIntegration(sandboxFor(project, state), {});
      const written = JSON.parse(
        readFileSync(join(project, "opencode.json"), "utf8"),
      );
      expect(written.default_agent).toBe("build");
      expect(written.agent.custom).toBeUndefined();
      expect(written.agent.build.permission.edit).toBe("allow");
    } finally {
      rmSync(config, { force: true });
    }
  });
});

describe("runTrial", () => {
  test("parses the event stream for usage and model identifiers", async () => {
    // The stream reports one usage object for each processing step. The
    // runner must aggregate both steps rather than retain only the last one.
    const stub = writeStub(
      tempDir("eval-stub-happy-"),
      `printf '%s\\n' '{"type":"session","info":{"providerID":"acme","modelID":"model-x"}}' '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":300,"output":40,"reasoning":10,"cache":{"read":0,"write":0}},"cost":0.01}}' '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":90,"output":30,"reasoning":10,"cache":{"read":0,"write":0}},"cost":0.02}}'`,
    );
    const runner = makeRunner({ binaryPath: stub });
    const project = tempDir("eval-sandbox-happy-");
    const trial = await runner.runTrial({
      sandbox: sandboxFor(project, tempDir("eval-state-happy-")),
      prompt: "Say hi.",
      timeoutMs: 10_000,
      maxTokens: 100_000,
    });
    expect(trial.outcome).toBe("completed");
    expect(trial.tokens).toBe(480);
    expect(trial.cost).toBe(0.03);
    expect(trial.model).toBe("acme/model-x");
    expect(trial.modelVersion).toBe("model-x");
    // Usage events were seen, so the budget was monitored.
    expect(trial.budgetUnmonitored).toBeUndefined();
  });

  test("uses the V2 standalone invocation and probes the host once", async () => {
    const project = tempDir("eval-sandbox-v2-run-");
    const state = tempDir("eval-state-v2-run-");
    const capture = join(project, "captured-argv.txt");
    const databaseCapture = join(project, "captured-database-path.txt");
    const stub = writeStub(
      tempDir("eval-stub-v2-run-"),
      `printenv OPENCODE_DB > '${databaseCapture}'
pwd > '${capture}'
for arg do printf '%s\\n' "$arg" >> '${capture}'; done
printf '%s\\n' '{"type":"step_finish","tokens":{"input":10,"output":20},"cost":0.03}'`,
    );
    let probes = 0;
    const runner = makeRunner({
      binaryPath: stub,
      versionProbe: () => {
        probes += 1;
        return "opencode v2.0.3\n";
      },
    });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(project, state),
      prompt: "Say hi.",
      model: "acme-v2/model-z",
      timeoutMs: 10_000,
      maxTokens: 100_000,
    });

    expect(probes).toBe(1);
    expect(trial.outcome).toBe("completed");
    expect(trial.tokens).toBe(30);
    expect(trial.cost).toBe(0.03);
    expect(trial.model).toBe("acme-v2/model-z");
    expect(trial.modelVersion).toBe("model-z");
    expect(readFileSync(capture, "utf8")).toContain("--standalone");
    expect(readFileSync(capture, "utf8")).not.toContain("--dir");
    expect(readFileSync(capture, "utf8")).toContain("--agent");
    expect(readFileSync(capture, "utf8")).toContain("build");
    expect(readFileSync(capture, "utf8")).toContain("acme-v2/model-z");
    expect(readFileSync(capture, "utf8")).toContain("Say hi.");
    expect(readFileSync(databaseCapture, "utf8").trim()).toBe(
      join(state, "data", "opencode", "opencode.db"),
    );
  });

  test("does not pass a host OPENCODE_DB override to V1 trials", async () => {
    const project = tempDir("eval-sandbox-v1-db-env-");
    const capture = join(project, "captured-database-path.txt");
    const hostDatabase = join(tempDir("eval-host-v1-db-"), "opencode.db");
    const stub = writeStub(
      tempDir("eval-stub-v1-db-env-"),
      `printenv OPENCODE_DB > '${capture}' || true
printf '%s\\n' '{"type":"step_finish","tokens":{"input":1,"output":1},"cost":0}'`,
    );
    const runner = makeRunner({
      binaryPath: stub,
      baseEnv: {
        PATH: process.env.PATH ?? "",
        OPENCODE_DB: hostDatabase,
      },
    });
    const trial = await runner.runTrial({
      sandbox: sandboxFor(project, tempDir("eval-state-v1-db-env-")),
      prompt: "Say hi.",
      timeoutMs: 10_000,
      maxTokens: 100_000,
    });

    expect(trial.outcome).toBe("completed");
    expect(readFileSync(capture, "utf8").trim()).toBe("");
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
    const runner = makeRunner({ binaryPath: stub });
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
    const runner = makeRunner({ binaryPath: stub });
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
    const runner = makeRunner({ binaryPath: stub });
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

  test("isolates XDG dirs, injects auth, and runs from the sandbox cwd", async () => {
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
printenv XDG_STATE_HOME >> '${capture}'
printenv HOME >> '${capture}'
printenv PATH >> '${capture}'
printenv EVAL_SECRET_MARKER >> '${capture}' || true
printenv HTTPS_PROXY >> '${capture}' || true
printenv NO_PROXY >> '${capture}' || true
printenv HTTP_PROXY >> '${capture}' || true
for arg do printf '%s\\n' "$arg" >> '${capture}'; done
test -f "$XDG_DATA_HOME/opencode/auth.json" || exit 9
exit 0`,
    );
    const runner = makeRunner({
      binaryPath: stub,
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
    expect(captured).toContain(state);
    const capturedLines = captured.split("\n");
    expect(capturedLines[4]).toBe(join(state, "home"));
    expect(capturedLines[4]).not.toBe(process.env.HOME);
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
    // The child cwd points at the sandbox; it is not passed as a
    // V1-incompatible command-line flag.
    expect(captured).not.toContain("--dir");
    expect(captured).not.toContain("--standalone");
    expect(captured).toContain("the prompt");
  });

  test("flags budget-unmonitored when the host emits no usage events", async () => {
    const stub = writeStub(tempDir("eval-stub-silent-"), `echo done`);
    const runner = makeRunner({ binaryPath: stub });
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
    expect(
      extractModelIdentifiers({
        type: "session.updated",
        properties: {
          info: {
            model: { providerID: "nested-provider", id: "nested-model" },
          },
        },
      }),
    ).toEqual({ provider: "nested-provider", model: "nested-model" });
    expect(extractModelIdentifiers({ type: "step_finish" })).toBeUndefined();
  });
});

describe("SQLite runtime compatibility", () => {
  test("selects the Node SQLite flag for supported experimental releases", () => {
    expect(sqliteRuntimeArguments("22.4.0")).toEqual({
      supported: false,
      args: [],
    });
    expect(sqliteRuntimeArguments("22.12.0")).toEqual({
      supported: true,
      args: ["--experimental-sqlite"],
    });
    expect(sqliteRuntimeArguments("22.13.0")).toEqual({
      supported: true,
      args: [],
    });
    expect(sqliteRuntimeArguments("23.3.0")).toEqual({
      supported: true,
      args: ["--experimental-sqlite"],
    });
    expect(sqliteRuntimeArguments("23.4.0")).toEqual({
      supported: true,
      args: [],
    });
    expect(sqliteRuntimeArguments("24.0.0")).toEqual({
      supported: true,
      args: [],
    });
  });
});

describe("createEvalPermissionPolicy", () => {
  test("creates the current containment policy in V1 shape", () => {
    const policy = createEvalPermissionPolicy("v1") as Record<string, unknown>;
    expect(policy.edit).toBe("allow");
    expect(policy.read).toEqual({
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
    });
    expect(policy.task).toBe("allow");
    expect(policy.webfetch).toBe("deny");
    expect(policy.websearch).toBe("deny");
    expect(policy.external_directory).toBe("deny");
    expect(policy.bash).toEqual({
      "*": "allow",
      "rm -rf *": "deny",
      "rm -fr *": "deny",
      "sudo *": "deny",
    });
  });

  test("creates the current containment policy in V2 shape", () => {
    const policy = createEvalPermissionPolicy("v2") as Record<
      string,
      unknown
    >[];
    expect(policy).toEqual(
      expect.arrayContaining([
        { action: "edit", resource: "*", effect: "allow" },
        { action: "read", resource: "*.env", effect: "deny" },
        { action: "subagent", resource: "*", effect: "allow" },
        { action: "shell", resource: "*", effect: "allow" },
        { action: "webfetch", resource: "*", effect: "deny" },
        { action: "websearch", resource: "*", effect: "deny" },
        { action: "external_directory", resource: "*", effect: "deny" },
        { action: "shell", resource: "rm -rf *", effect: "deny" },
        { action: "shell", resource: "rm -fr *", effect: "deny" },
        { action: "shell", resource: "sudo *", effect: "deny" },
      ]),
    );
    expect(policy.some((rule) => rule.action === "bash")).toBe(false);
    expect(policy.some((rule) => rule.action === "task")).toBe(false);
  });
});
