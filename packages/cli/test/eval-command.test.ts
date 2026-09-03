import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
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
import { fileURLToPath } from "node:url";
import type { HostRunner, RunTrialInput, TrialRun } from "@atlante/eval";
import { EVAL_SCENARIO_SCHEMA_URI, SCHEMA_URI } from "@atlante/schema";
import { runEvalCommand } from "../src/commands/eval.js";
import { runBuild } from "../src/main.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

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

/** Authors a full eval-enabled project; artifacts stay unpublished by default. */
function evalProject(options: { evalSection?: object } = {}): string {
  const project = tempDir();
  const evalSection =
    options.evalSection === undefined
      ? { host: "opencode", scenarios: "eval/scenarios/*.eval.json" }
      : options.evalSection;
  writeFileSync(
    join(project, "atlante.jsonc"),
    `${JSON.stringify({
      $schema: SCHEMA_URI,
      extends: "@atlante/pack",
      values: { project: "demo" },
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
  cpSync(
    firstPartyPackRoot,
    join(project, "node_modules", "@atlante", "pack"),
    {
      recursive: true,
    },
  );
  writeFileSync(
    join(project, "package.json"),
    `${JSON.stringify({
      name: "atlante-eval-command-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
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
 * Publishes a real, verified artifact tree through the CLI's own build flow —
 * the eval gate (`verifyArtifacts`) then accepts it. This also keeps the CLI
 * test tree free of full-contract `@atlante/artifacts` imports, which the
 * package-graph governance test forbids.
 */
async function publishFixtureArtifacts(project: string): Promise<void> {
  const exit = await runBuild(project);
  if (exit !== 0) throw new Error("fixture build failed");
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
  test("runs the suite, writes the report, and gitignores it", async () => {
    const project = evalProject();
    await publishFixtureArtifacts(project);
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

  test("exits 1 when a check fails", async () => {
    const project = evalProject();
    await publishFixtureArtifacts(project);
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
    const project = evalProject({ evalSection: undefined });
    // Re-author without the eval key entirely.
    writeFileSync(
      join(project, "atlante.jsonc"),
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        extends: "@atlante/pack",
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

  test("exits 2 when artifacts are not published", async () => {
    const project = evalProject();
    const exit = await runEvalCommand(project, {}, undefined, fakeRunner(true));
    expect(exit).toBe(2);
  });

  test("exits 2 for an unknown --scenario filter", async () => {
    const project = evalProject();
    await publishFixtureArtifacts(project);
    const exit = await runEvalCommand(
      project,
      { scenario: ["nope"] },
      undefined,
      fakeRunner(true),
    );
    expect(exit).toBe(2);
  });

  test("exits 2 for an invalid --trials value", async () => {
    const project = evalProject();
    await publishFixtureArtifacts(project);
    const exit = await runEvalCommand(
      project,
      { trials: "zero" },
      undefined,
      fakeRunner(true),
    );
    expect(exit).toBe(2);
  });

  test("--trials overrides the configured trial count", async () => {
    const project = evalProject();
    await publishFixtureArtifacts(project);
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
    const project = evalProject();
    await publishFixtureArtifacts(project);
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
    await publishFixtureArtifacts(project);
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
    const project = evalProject();
    await publishFixtureArtifacts(project);
    const exit = await runEvalCommand(project, {}, undefined, throwingRunner());
    expect(exit).toBe(1);
  });

  test("--json prints the report and --out relocates it", async () => {
    const project = evalProject();
    await publishFixtureArtifacts(project);
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
    const project = evalProject();
    await publishFixtureArtifacts(project);
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

  test("returns 3 when the report cannot be written", async () => {
    const project = evalProject();
    await publishFixtureArtifacts(project);
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
    const project = evalProject();
    await publishFixtureArtifacts(project);
    const outside = tempDir();
    const reportDir = join(project, ".atlante", "eval");
    symlinkSync(outside, reportDir, "dir");
    const exit = await runEvalCommand(project, {}, undefined, fakeRunner(true));
    expect(exit).toBe(3);
    expect(readdirSync(outside)).toEqual([]);
  });
});
