import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostRunner, RunTrialInput, TrialRun } from "@atlante/eval";
import {
  EVAL_SCENARIO_SCHEMA_URI,
  SCHEMA_URI,
  SCHEMA_URI_V02,
} from "@atlante/schema";
import { createProgressStyler, runEvalCommand } from "../src/commands/eval.js";
import { runBuild } from "../src/main.js";
import { installStubPack } from "./stub-pack.js";

/**
 * Foreign pack name so CLI commands resolve the stub from the fixture's
 * node_modules instead of intercepting `@atlante/pack` with the bundled
 * first-party pack.
 */
const FIXTURE_PACK = "@fixture/pack";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-eval-command-"));
  created.push(dir);
  return dir;
}

function scenarioDocument(): string {
  return `${JSON.stringify({
    $schema: EVAL_SCENARIO_SCHEMA_URI,
    version: "0.1",
    name: "cli-happy",
    description: "CLI command fixture scenario.",
    task: {
      fixture: "eval/fixtures/api",
      prompt: "Create the file.",
    },
    checks: [{ type: "file-exists", path: "src/created-by-host.ts" }],
  })}\n`;
}

function writePackEvalSuite(
  project: string,
  options: { host?: string } = {},
): void {
  const packRoot = join(project, "node_modules", ...FIXTURE_PACK.split("/"));
  const packConfigPath = join(packRoot, "atlante.jsonc");
  const packConfig = JSON.parse(readFileSync(packConfigPath, "utf8")) as Record<
    string,
    unknown
  >;
  packConfig.eval = {
    ...(options.host === undefined ? {} : { host: options.host }),
    scenarios: "eval/scenarios/*.eval.json",
    fixtures: "eval/fixtures",
  };
  writeFileSync(packConfigPath, `${JSON.stringify(packConfig)}\n`);
  mkdirSync(join(packRoot, "eval", "scenarios"), { recursive: true });
  mkdirSync(join(packRoot, "eval", "fixtures", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(packRoot, "eval", "scenarios", "pack-happy.eval.json"),
    `${JSON.stringify({
      $schema: EVAL_SCENARIO_SCHEMA_URI,
      version: "0.1",
      name: "pack-happy",
      task: { fixture: "eval/fixtures/pack", prompt: "Create the file." },
      checks: [{ type: "file-exists", path: "pack-only.txt" }],
    })}\n`,
  );
  writeFileSync(
    join(packRoot, "eval", "fixtures", "pack", "pack-only.txt"),
    "pack fixture\n",
  );
}

/** Authors a full eval-enabled project; native outputs stay unbuilt by default. */
function evalProject(
  options: { evalSection?: object; schemaUri?: string; hosts?: string[] } = {},
): string {
  const project = writeEvalProject(options);
  created.push(project);
  return project;
}

/** Same layout as `evalProject`, but outside the per-test cleanup list. */
function writeEvalProject(
  options: { evalSection?: object; schemaUri?: string; hosts?: string[] } = {},
): string {
  const project = mkdtempSync(join(tmpdir(), "atlante-eval-command-"));
  const evalSection =
    options.evalSection === undefined
      ? { host: "opencode", scenarios: "eval/scenarios/*.eval.json" }
      : options.evalSection;
  writeFileSync(
    join(project, "atlante.jsonc"),
    `${JSON.stringify({
      $schema: options.schemaUri ?? SCHEMA_URI,
      extends: "@fixture/pack",
      values: { project: "demo" },
      ...(options.hosts === undefined ? {} : { hosts: options.hosts }),
      agents: {
        reviewer: {
          description: "Reviews changes.",
          identity: "You review.",
          mission: "Find defects.",
        },
      },
      eval: evalSection,
    })}\n`,
  );
  installStubPack(project, { name: FIXTURE_PACK });
  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify({
      name: "atlante-eval-command-fixture",
      version: "1.0.0",
      devDependencies: { [FIXTURE_PACK]: "workspace:0.1.6" },
    })}\n`,
  );
  mkdirSync(join(project, "eval", "scenarios"), { recursive: true });
  writeFileSync(
    join(project, "eval", "scenarios", "cli-happy.eval.json"),
    scenarioDocument(),
  );
  mkdirSync(join(project, "eval", "fixtures", "api", "src"), {
    recursive: true,
  });
  writeFileSync(
    join(project, "eval", "fixtures", "api", "src", "index.ts"),
    "export {};\n",
  );
  return project;
}

/**
 * Builds real, verified native outputs through the CLI's own build flow — the
 * eval gate (`verifyNativeOutputs`) then accepts them.
 */
async function buildFixtureOutputs(project: string): Promise<void> {
  const exit = await runBuild(project);
  if (exit !== 0) throw new Error("fixture build failed");
}

// One built template per file: every test copies it instead of re-running the
// full build. The template never runs eval, so it never gains run state, and
// each test mutates only its own copy.
const templateDirs: string[] = [];
let builtTemplate: string | undefined;
let builtClaudeTemplate: string | undefined;

/** A cheap copy of the built template project, registered for per-test cleanup. */
function builtProject(): string {
  if (builtTemplate === undefined) throw new Error("template not built");
  const project = tempDir();
  cpSync(builtTemplate, project, { recursive: true });
  return project;
}

/** A cheap copy of the built Claude-only template project. */
function builtClaudeProject(): string {
  if (builtClaudeTemplate === undefined)
    throw new Error("claude template not built");
  const project = tempDir();
  cpSync(builtClaudeTemplate, project, { recursive: true });
  return project;
}

/** Fake host: `createsFile` decides whether the graded check can pass. */
function fakeRunner(
  createsFile: boolean,
  budgetUnmonitored = false,
): HostRunner {
  return {
    name: "fake",
    prepareHostIntegration() {},
    async runTrial(input: RunTrialInput): Promise<TrialRun> {
      if (createsFile) {
        writeFileSync(
          join(input.sandbox.root, "src", "created-by-host.ts"),
          "ok\n",
        );
      }
      return {
        outcome: "completed",
        durationMs: 5,
        ...(budgetUnmonitored ? { budgetUnmonitored: true } : {}),
        tokens: 100,
        cost: 0.001,
        model: "test/model",
        modelVersion: "model-x",
      };
    },
  };
}

function throwingRunner(): HostRunner {
  return {
    name: "fake",
    prepareHostIntegration() {},
    async runTrial(): Promise<TrialRun> {
      throw new Error("host exploded");
    },
  };
}

function reportPaths(project: string): { runId: string; file: string } {
  const evalDir = join(project, ".atlante", "eval");
  const entries = readdirSync(evalDir, {
    withFileTypes: true,
    encoding: "utf8",
  }) as Dirent<string>[];
  const runId = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .at(0);
  if (runId === undefined) throw new Error(`no run directory in ${evalDir}`);
  return { runId, file: join(evalDir, runId, "report.json") };
}

describe("runEvalCommand", () => {
  // Pin plain-text progress so stderr assertions are deterministic whether
  // the test runner's stderr is a terminal or a pipe.
  let previousNoColor: string | undefined;
  beforeAll(async () => {
    const template = writeEvalProject();
    templateDirs.push(template);
    await buildFixtureOutputs(template);
    builtTemplate = template;
    const claudeTemplate = writeEvalProject({
      schemaUri: SCHEMA_URI_V02,
      hosts: ["claude-code"],
      evalSection: {
        host: "claude-code",
        scenarios: "eval/scenarios/*.eval.json",
      },
    });
    templateDirs.push(claudeTemplate);
    await buildFixtureOutputs(claudeTemplate);
    builtClaudeTemplate = claudeTemplate;
  });
  afterAll(() => {
    for (const dir of templateDirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    previousNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
  });
  afterEach(() => {
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
  });

  test("runs the suite, writes the report, and gitignores it", async () => {
    const project = builtProject();
    const exit = await runEvalCommand(project, {}, undefined, fakeRunner(true));
    expect(exit).toBe(0);
    const { runId, file } = reportPaths(project);
    expect(runId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    const report = JSON.parse(readFileSync(file, "utf8"));
    expect(report.meta.host).toBe("fake");
    expect(report.meta.model).toBe("test/model");
    expect(report.scenarios["cli-happy"].passRate).toBe(1);
    const gitignore = readFileSync(
      join(project, ".atlante", ".gitignore"),
      "utf8",
    );
    expect(gitignore.split("\n")).toContain("eval/");
  });

  test("discovers pack scenarios but does not execute them without explicit inclusion", async () => {
    const project = evalProject();
    writePackEvalSuite(project);
    await buildFixtureOutputs(project);
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        {},
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(0);
      const { file } = reportPaths(project);
      const report = JSON.parse(readFileSync(file, "utf8"));
      expect(report.scenarios["cli-happy"].passRate).toBe(1);
      expect(report.scenarios["pack-happy"]).toBeUndefined();
      expect(errors.join("\n")).toContain("pack-happy");
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("executes an explicitly included pack scenario against the pack fixture", async () => {
    const project = evalProject({
      evalSection: { host: "opencode", include: [FIXTURE_PACK] },
    });
    writePackEvalSuite(project);
    await buildFixtureOutputs(project);
    let calls = 0;
    const exit = await runEvalCommand(project, {}, undefined, {
      name: "fake",
      prepareHostIntegration() {},
      async runTrial(input) {
        calls += 1;
        expect(existsSync(join(input.sandbox.root, "pack-only.txt"))).toBe(
          true,
        );
        return {
          outcome: "completed",
          durationMs: 5,
          model: "test/model",
          modelVersion: "model-x",
        };
      },
    });
    expect(exit).toBe(0);
    expect(calls).toBe(3);
    const { file } = reportPaths(project);
    const report = JSON.parse(readFileSync(file, "utf8"));
    expect(report.scenarios["pack-happy"].passRate).toBe(1);
  });

  test("exits 2 when an explicitly included pack has no eval suite", async () => {
    const project = evalProject({
      evalSection: { host: "opencode", include: [FIXTURE_PACK] },
    });
    await buildFixtureOutputs(project);
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        {},
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(2);
      expect(errors.join("\n")).toContain(
        "eval.include locator has no pack eval suite",
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("exits 2 before execution when an included pack suite declares an incompatible host", async () => {
    const project = evalProject({
      schemaUri: SCHEMA_URI_V02,
      hosts: ["opencode", "claude-code"],
      evalSection: { host: "opencode", include: [FIXTURE_PACK] },
    });
    writePackEvalSuite(project, { host: "claude-code" });
    await buildFixtureOutputs(project);
    let runnerCalled = false;
    const runner: HostRunner = {
      name: "never",
      prepareHostIntegration() {},
      async runTrial(): Promise<TrialRun> {
        runnerCalled = true;
        throw new Error("must not run");
      },
    };
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(project, {}, undefined, runner);
      expect(exit).toBe(2);
    } finally {
      errorSpy.mockRestore();
    }
    expect(runnerCalled).toBe(false);
    expect(errors.join("\n")).toContain("eval-pack-host-incompatible");
    expect(existsSync(join(project, ".atlante", "eval"))).toBe(false);
  });

  test("exits 2 when a claude-code run includes an opencode-only pack suite", async () => {
    const project = evalProject({
      schemaUri: SCHEMA_URI_V02,
      hosts: ["claude-code"],
      evalSection: { host: "claude-code", include: [FIXTURE_PACK] },
    });
    writePackEvalSuite(project, { host: "opencode" });
    await buildFixtureOutputs(project);
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        {},
        undefined,
        fakeRunner(false),
      );
      expect(exit).toBe(2);
    } finally {
      errorSpy.mockRestore();
    }
    expect(errors.join("\n")).toContain("eval-pack-host-incompatible");
  });

  test("runs an included pack suite whose declared host matches the project host", async () => {
    const project = evalProject({
      schemaUri: SCHEMA_URI_V02,
      hosts: ["claude-code"],
      evalSection: { host: "claude-code", include: [FIXTURE_PACK] },
    });
    writePackEvalSuite(project, { host: "claude-code" });
    await buildFixtureOutputs(project);
    let calls = 0;
    const exit = await runEvalCommand(project, {}, undefined, {
      name: "fake",
      prepareHostIntegration() {},
      async runTrial(input) {
        calls += 1;
        expect(existsSync(join(input.sandbox.root, "pack-only.txt"))).toBe(
          true,
        );
        return {
          outcome: "completed",
          durationMs: 5,
          model: "test/model",
          modelVersion: "model-x",
        };
      },
    });
    expect(exit).toBe(0);
    expect(calls).toBe(3);
    const { file } = reportPaths(project);
    const report = JSON.parse(readFileSync(file, "utf8"));
    expect(report.scenarios["pack-happy"].passRate).toBe(1);
  });

  test("runs a host-neutral pack suite under a claude-code project host", async () => {
    const project = evalProject({
      schemaUri: SCHEMA_URI_V02,
      hosts: ["claude-code"],
      evalSection: { host: "claude-code", include: [FIXTURE_PACK] },
    });
    writePackEvalSuite(project);
    await buildFixtureOutputs(project);
    const exit = await runEvalCommand(
      project,
      {},
      undefined,
      fakeRunner(false),
    );
    expect(exit).toBe(0);
    const { file } = reportPaths(project);
    const report = JSON.parse(readFileSync(file, "utf8"));
    expect(report.scenarios["pack-happy"].passRate).toBe(1);
  });

  test("exits 1 when a check fails", async () => {
    const project = builtProject();
    const exit = await runEvalCommand(
      project,
      {},
      undefined,
      fakeRunner(false),
    );
    expect(exit).toBe(1);
    const { file } = reportPaths(project);
    const report = JSON.parse(readFileSync(file, "utf8"));
    expect(report.scenarios["cli-happy"].passRate).toBe(0);
    const trial = report.scenarios["cli-happy"].trials[0];
    expect(trial.verdict).toBe("fail");
    expect(trial.checks[0].verdict).toBe("fail");
  });

  test("exits 2 when the eval section is missing", async () => {
    const project = builtProject();
    // Re-author without the eval key entirely.
    writeFileSync(
      join(project, "atlante.jsonc"),
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        extends: FIXTURE_PACK,
        values: { project: "demo" },
        agents: {
          reviewer: {
            description: "Reviews changes.",
            identity: "You review.",
            mission: "Find defects.",
          },
        },
      })}\n`,
    );
    const exit = await runEvalCommand(project, {}, undefined, fakeRunner(true));
    expect(exit).toBe(2);
  });

  test("exits 2 when native outputs are not built", async () => {
    const project = evalProject();
    const exit = await runEvalCommand(project, {}, undefined, fakeRunner(true));
    expect(exit).toBe(2);
  });

  test("exits 2 before execution when eval.host is not materialized", async () => {
    const project = evalProject({
      schemaUri: SCHEMA_URI_V02,
      hosts: ["opencode"],
      evalSection: {
        host: "claude-code",
        scenarios: "eval/scenarios/*.eval.json",
      },
    });
    let runnerCalled = false;
    const runner: HostRunner = {
      name: "never",
      prepareHostIntegration() {},
      async runTrial(): Promise<TrialRun> {
        runnerCalled = true;
        throw new Error("must not run");
      },
    };
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(project, {}, undefined, runner);
      expect(exit).toBe(2);
    } finally {
      errorSpy.mockRestore();
    }
    expect(runnerCalled).toBe(false);
    expect(errors.join("\n")).toContain("eval-host-not-materialized");
  });

  test("passes the materialization gate when eval.host is selected", async () => {
    const project = evalProject({
      schemaUri: SCHEMA_URI_V02,
      hosts: ["opencode", "claude-code"],
      evalSection: {
        host: "claude-code",
        scenarios: "eval/scenarios/*.eval.json",
      },
    });
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      // Unbuilt outputs still fail, but past the host gate.
      const exit = await runEvalCommand(
        project,
        {},
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(2);
    } finally {
      errorSpy.mockRestore();
    }
    const output = errors.join("\n");
    expect(output).not.toContain("eval-host-not-materialized");
    expect(output).toContain("native-outputs-not-verified");
  });

  test("verifies Claude native outputs for eval.host claude-code", async () => {
    // Unbuilt Claude outputs fail before any host spawn, naming the host.
    const project = evalProject({
      schemaUri: SCHEMA_URI_V02,
      hosts: ["claude-code"],
      evalSection: {
        host: "claude-code",
        scenarios: "eval/scenarios/*.eval.json",
      },
    });
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        {},
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(2);
    } finally {
      errorSpy.mockRestore();
    }
    expect(errors.join("\n")).toContain("Claude Code");
  });

  test("exits 3 with a diagnostic when the Claude host has no auth", async () => {
    const project = builtClaudeProject();
    // Pin a stub host so this test exercises the auth preflight rather
    // than depending on the machine's Claude installation or login state.
    // Injected runners skip the preflight entirely.
    const binDir = tempDir();
    const binary = join(binDir, "claude");
    writeFileSync(
      binary,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then printf \'%s\\n\' \'2.1.218 (Claude Code)\'; exit 0; fi\nif [ "$1" = "auth" ]; then printf \'%s\\n\' \'{"loggedIn":false}\'; exit 1; fi\nexit 1\n',
    );
    chmodSync(binary, 0o755);
    const previousPath = process.env.PATH;
    const previousApiKey = process.env.ANTHROPIC_API_KEY;
    const previousAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
    const previousOAuth = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const previousBedrock = process.env.CLAUDE_CODE_USE_BEDROCK;
    const previousVertex = process.env.CLAUDE_CODE_USE_VERTEX;
    const previousFoundry = process.env.CLAUDE_CODE_USE_FOUNDRY;
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.PATH = `${binDir}:${previousPath ?? ""}`;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.CLAUDE_CODE_USE_VERTEX;
    delete process.env.CLAUDE_CODE_USE_FOUNDRY;
    delete process.env.CLAUDE_CONFIG_DIR;
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(project, {}, undefined);
      expect(exit).toBe(3);
      expect(errors.join("\n")).toContain("eval-host-unauthenticated");
      expect(errors.join("\n")).toContain("claude setup-token");
      // No report was published: the run never started.
      expect(existsSync(join(project, ".atlante", "eval"))).toBe(false);
    } finally {
      errorSpy.mockRestore();
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousApiKey;
      if (previousAuthToken === undefined)
        delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previousAuthToken;
      if (previousOAuth === undefined)
        delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOAuth;
      if (previousBedrock === undefined)
        delete process.env.CLAUDE_CODE_USE_BEDROCK;
      else process.env.CLAUDE_CODE_USE_BEDROCK = previousBedrock;
      if (previousVertex === undefined)
        delete process.env.CLAUDE_CODE_USE_VERTEX;
      else process.env.CLAUDE_CODE_USE_VERTEX = previousVertex;
      if (previousFoundry === undefined)
        delete process.env.CLAUDE_CODE_USE_FOUNDRY;
      else process.env.CLAUDE_CODE_USE_FOUNDRY = previousFoundry;
      if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
    }
  });

  test("exits 2 for an unknown --scenario filter", async () => {
    const project = builtProject();
    const exit = await runEvalCommand(
      project,
      { scenario: ["nope"] },
      undefined,
      fakeRunner(true),
    );
    expect(exit).toBe(2);
  });

  test("exits 2 for an invalid --trials value", async () => {
    const project = builtProject();
    const exit = await runEvalCommand(
      project,
      { trials: "zero" },
      undefined,
      fakeRunner(true),
    );
    expect(exit).toBe(2);
  });

  test("--trials overrides the configured trial count", async () => {
    const project = builtProject();
    const exit = await runEvalCommand(
      project,
      { trials: "2" },
      undefined,
      fakeRunner(true),
    );
    expect(exit).toBe(0);
    const { file } = reportPaths(project);
    const report = JSON.parse(readFileSync(file, "utf8"));
    expect(report.meta.config.trials).toBe(2);
    // Recorded so before/after report diffs can explain setup/grading timing.
    expect(report.meta.config.setupTimeoutMs).toBe(300_000);
    expect(report.meta.config.checkTimeoutDefaultMs).toBe(120_000);
    expect(report.scenarios["cli-happy"].trials).toHaveLength(2);
  });

  test("exits 2 when --trials exceeds the configured maximum", async () => {
    const project = builtProject();
    const exit = await runEvalCommand(
      project,
      { trials: "51" },
      undefined,
      fakeRunner(true),
    );
    expect(exit).toBe(2);
  });

  test("skipped-budget trials fail the run", async () => {
    const project = evalProject({
      evalSection: {
        host: "opencode",
        scenarios: "eval/scenarios/*.eval.json",
        budget: { maxSessions: 1 },
      },
    });
    await buildFixtureOutputs(project);
    const exit = await runEvalCommand(
      project,
      { trials: "2" },
      undefined,
      fakeRunner(true),
    );
    expect(exit).toBe(1);
    const { file } = reportPaths(project);
    const report = JSON.parse(readFileSync(file, "utf8"));
    const verdicts = report.scenarios["cli-happy"].trials.map(
      (trial: { verdict: string }) => trial.verdict,
    );
    expect(verdicts).toEqual(["pass", "skipped-budget"]);
  });

  test("exits 1 when a host trial throws", async () => {
    const project = builtProject();
    const exit = await runEvalCommand(project, {}, undefined, throwingRunner());
    expect(exit).toBe(1);
  });

  test("--json prints the report and --out relocates it", async () => {
    const project = builtProject();
    const out = tempDir();
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation(
      (...parts: unknown[]) => {
        logs.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        { json: true, out },
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(0);
      const printed = JSON.parse(logs.join("\n"));
      expect(printed.scenarios["cli-happy"].passRate).toBe(1);
      // The report went to --out, and the default location stayed untouched.
      expect(existsSync(join(project, ".atlante", "eval"))).toBe(false);
      const runId = printed.runId as string;
      expect(existsSync(join(out, runId, "report.json"))).toBe(true);
      // A custom location is not silently gitignored.
      expect(existsSync(join(project, ".atlante", ".gitignore"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  test("human summary warns when token usage is unmonitored", async () => {
    const project = builtProject();
    const logs: string[] = [];
    const spy = spyOn(console, "log").mockImplementation(
      (...parts: unknown[]) => {
        logs.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        {},
        undefined,
        fakeRunner(true, true),
      );
      expect(exit).toBe(0);
      expect(logs.some((line) => line.includes("budget unmonitored"))).toBe(
        true,
      );
    } finally {
      spy.mockRestore();
    }
  });

  test("streams progress events to stderr as they arrive", async () => {
    const project = builtProject();
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation(
      (...parts: unknown[]) => {
        logs.push(parts.join(" "));
      },
    );
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        {},
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(0);
      // One human-readable line per event kind, on stderr only.
      expect(errors).toContain("== cli-happy");
      expect(errors).toContain("trial 0 running...");
      expect(errors).toContain("trial 0: pass (5ms · $0.0010 · 100 tokens)");
      expect(errors).toContain("cli-happy: 3/3 trials passed");
      const indexOf = (line: string): number => {
        const index = errors.indexOf(line);
        if (index === -1) throw new Error(`missing stderr line: ${line}`);
        return index;
      };
      expect(indexOf("== cli-happy")).toBeLessThan(
        indexOf("trial 0 running..."),
      );
      expect(indexOf("trial 0 running...")).toBeLessThan(
        indexOf("trial 0: pass (5ms · $0.0010 · 100 tokens)"),
      );
      expect(
        indexOf("trial 0: pass (5ms · $0.0010 · 100 tokens)"),
      ).toBeLessThan(indexOf("cli-happy: 3/3 trials passed"));
      // stdout keeps the human summary; progress never pollutes it.
      expect(logs.join("\n")).not.toContain("running...");
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("--json keeps stdout pure JSON while progress still streams to stderr", async () => {
    const project = builtProject();
    const out = tempDir();
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation(
      (...parts: unknown[]) => {
        logs.push(parts.join(" "));
      },
    );
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        { json: true, out },
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(0);
      // Progress stays observable on stderr in --json mode.
      expect(errors).toContain("== cli-happy");
      expect(errors).toContain("trial 0 running...");
      // stdout parses as exactly one JSON document: the report.
      const printed = JSON.parse(logs.join("\n"));
      expect(printed.scenarios["cli-happy"].passRate).toBe(1);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("progress counts exclude skipped-budget trials", async () => {
    const project = evalProject({
      evalSection: {
        host: "opencode",
        scenarios: "eval/scenarios/*.eval.json",
        budget: { maxSessions: 1 },
      },
    });
    await buildFixtureOutputs(project);
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        { trials: "2" },
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(1);
      // 1 pass + 1 skipped: executed trials only, matching the pass rate.
      expect(errors).toContain("trial 1: skipped-budget (0ms)");
      expect(errors).toContain("cli-happy: 1/1 trials passed");
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("summary repeats aggregates, not the per-trial lines", async () => {
    const project = builtProject();
    const logs: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation(
      (...parts: unknown[]) => {
        logs.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        {},
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(0);
      const stdout = logs.join("\n");
      // Per-trial verdicts stream live to stderr; the summary must not
      // repeat them.
      expect(stdout).not.toContain("trial 0:");
      // Aggregates, header, and report path stay.
      expect(stdout).toContain("cli-happy: pass 100% · mean 5ms · p95 5ms");
      expect(stdout).toContain("host fake · model test/model");
      expect(stdout).toContain("report ");
    } finally {
      logSpy.mockRestore();
    }
  });

  test("--json mode still warns about an unmonitored budget on stderr", async () => {
    const project = builtProject();
    const out = tempDir();
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation(
      (...parts: unknown[]) => {
        logs.push(parts.join(" "));
      },
    );
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        { json: true, out },
        undefined,
        fakeRunner(true, true),
      );
      expect(exit).toBe(0);
      expect(errors.some((line) => line.includes("budget unmonitored"))).toBe(
        true,
      );
      // stdout stays parseable JSON.
      JSON.parse(logs.join("\n"));
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  test("exits 3 with a diagnostic when the default runner has no host auth", async () => {
    const project = builtProject();
    // Pin a V2 host so this test exercises the auth preflight rather than
    // depending on whether the machine running the suite has OpenCode
    // installed. Injected runners skip the preflight entirely.
    const binDir = tempDir();
    const binary = join(binDir, "opencode");
    writeFileSync(
      binary,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '%s\\n' 'opencode v2.0.3'; exit 0; fi\nexit 1\n",
    );
    chmodSync(binary, 0o755);
    const emptyDataHome = tempDir();
    const previousPath = process.env.PATH;
    const previous = process.env.XDG_DATA_HOME;
    const previousDatabase = process.env.OPENCODE_DB;
    process.env.PATH = `${binDir}:${previousPath ?? ""}`;
    process.env.XDG_DATA_HOME = emptyDataHome;
    delete process.env.OPENCODE_DB;
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(project, {}, undefined);
      expect(exit).toBe(3);
      expect(errors.join("\n")).toContain("eval-host-unauthenticated");
      // No report was published: the run never started.
      expect(existsSync(join(project, ".atlante", "eval"))).toBe(false);
    } finally {
      errorSpy.mockRestore();
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
      if (previousDatabase === undefined) delete process.env.OPENCODE_DB;
      else process.env.OPENCODE_DB = previousDatabase;
    }
  });

  test("exits 3 when a V1 host has database-only auth state", async () => {
    const project = builtProject();
    const binDir = tempDir();
    const binary = join(binDir, "opencode");
    writeFileSync(
      binary,
      "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then printf '%s\\n' 'opencode v1.18.29'; exit 0; fi\nexit 1\n",
    );
    chmodSync(binary, 0o755);
    const dataHome = tempDir();
    mkdirSync(join(dataHome, "opencode"), { recursive: true });
    writeFileSync(join(dataHome, "opencode", "opencode.db"), "database-only\n");
    const previousPath = process.env.PATH;
    const previousDataHome = process.env.XDG_DATA_HOME;
    process.env.PATH = `${binDir}:${previousPath ?? ""}`;
    process.env.XDG_DATA_HOME = dataHome;
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(project, {}, undefined);
      expect(exit).toBe(3);
      expect(errors.join("\n")).toContain("eval-host-unauthenticated");
      expect(errors.join("\n")).toContain("auth.json");
      expect(errors.join("\n")).not.toContain("opencode.db");
    } finally {
      errorSpy.mockRestore();
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previousDataHome;
    }
  });

  test("returns 3 when the report cannot be written", async () => {
    const project = builtProject();
    const out = join(project, "report-file");
    writeFileSync(out, "not a directory\n");
    const exit = await runEvalCommand(
      project,
      { out },
      undefined,
      fakeRunner(true),
    );
    expect(exit).toBe(3);
  });

  test("returns 3 instead of following a symlinked report directory", async () => {
    const project = builtProject();
    const outside = tempDir();
    const reportDir = join(project, ".atlante", "eval");
    symlinkSync(outside, reportDir, "dir");
    const exit = await runEvalCommand(project, {}, undefined, fakeRunner(true));
    expect(exit).toBe(3);
    expect(readdirSync(outside)).toEqual([]);
  });

  test("progress is gray when stderr is an interactive terminal", async () => {
    const project = builtProject();
    const previousNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    // Force the TTY branch of the styler regardless of how the tests run.
    const stderr = process.stderr as unknown as { isTTY?: boolean };
    const previousIsTTY = stderr.isTTY;
    Object.defineProperty(stderr, "isTTY", {
      value: true,
      configurable: true,
      writable: true,
    });
    const errors: string[] = [];
    const errorSpy = spyOn(console, "error").mockImplementation(
      (...parts: unknown[]) => {
        errors.push(parts.join(" "));
      },
    );
    try {
      const exit = await runEvalCommand(
        project,
        { trials: "1" },
        undefined,
        fakeRunner(true),
      );
      expect(exit).toBe(0);
      expect(errors).toContain(`${"\x1b[90m"}== cli-happy${"\x1b[0m"}`);
    } finally {
      errorSpy.mockRestore();
      if (previousNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = previousNoColor;
      if (previousIsTTY === undefined) delete stderr.isTTY;
      else stderr.isTTY = previousIsTTY;
    }
  });
});

describe("createProgressStyler", () => {
  test("grays lines on an interactive stderr", () => {
    const style = createProgressStyler({ isTTY: true }, {});
    expect(style("== cli-happy")).toBe("\x1b[90m== cli-happy\x1b[0m");
  });

  test("keeps plain text for piped stderr and for NO_COLOR", () => {
    expect(createProgressStyler({ isTTY: false }, {})("== s")).toBe("== s");
    expect(
      createProgressStyler({ isTTY: true }, { NO_COLOR: "1" })("== s"),
    ).toBe("== s");
    // An empty NO_COLOR value does not opt out (no-color.org).
    expect(
      createProgressStyler({ isTTY: true }, { NO_COLOR: "" })("== s"),
    ).toBe("\x1b[90m== s\x1b[0m");
  });
});
