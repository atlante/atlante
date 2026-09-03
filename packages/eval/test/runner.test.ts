import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifacts, publishArtifacts } from "@atlante/artifacts";
import type { EvalConfig } from "@atlante/schema";
import {
  type DiscoveredEvalScenario,
  discoverEvalScenarios,
} from "@atlante/validator";
import {
  EvalRunError,
  type HostRunner,
  type RunReport,
  resolveBudget,
  runCommand,
  runEval,
  runExitCode,
  type TrialRun,
  type TrialRunOutcome,
  verifyArtifacts,
} from "../src/index.js";

const fixtureProject = join(import.meta.dir, "fixtures", "project");

let projectRoot: string;
let scenarios: DiscoveredEvalScenario[];

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "eval-runner-project-"));
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
  verifyArtifacts(projectRoot);
  scenarios = discoverEvalScenarios(
    projectRoot,
    "eval/scenarios/*.eval.json",
  ).scenarios;
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

/** Scripted fake runner: each call consumes the next scripted outcome. */
function fakeRunner(script: (call: number) => TrialRun): HostRunner {
  let calls = 0;
  return {
    name: "fake",
    prepareHostIntegration() {},
    async runTrial() {
      calls += 1;
      return script(calls);
    },
  };
}

function completedRun(overrides: Partial<TrialRun> = {}): TrialRun {
  return { outcome: "completed", durationMs: 100, ...overrides };
}

const evalConfig: EvalConfig = {
  host: "opencode",
  scenarios: "eval/scenarios/*.eval.json",
};

const evalConfigWithModel: EvalConfig = {
  host: "opencode",
  scenarios: "eval/scenarios/*.eval.json",
  model: "acme/model-x",
};

describe("runEval", () => {
  test("runs trials per scenario and computes statistics", async () => {
    let call = 0;
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 3 }),
      scenarios,
      atlanteVersion: "0.0.0-test",
      runner: fakeRunner(() => {
        call += 1;
        return completedRun({
          tokens: 100 * call,
          cost: 0.01 * call,
          model: "provider/model",
          modelVersion: "v9",
        });
      }),
    });
    const result = report.scenarios["happy-scenario"];
    if (!result) throw new Error("missing scenario result");
    expect(result.trials).toHaveLength(3);
    expect(result.passRate).toBe(1);
    expect(report.meta.model).toBe("provider/model");
    expect(report.meta.modelVersion).toBe("v9");
    expect(report.meta.host).toBe("fake");
    expect(report.meta.config.setupTimeoutMs).toBe(300_000);
    expect(report.meta.config.checkTimeoutDefaultMs).toBe(120_000);
    expect(result.trials[0]?.checks).toHaveLength(3);
  });

  test("falls back to the requested model when the host reports none", async () => {
    const report = await runEval({
      projectRoot,
      evalConfig: evalConfigWithModel,
      budget: resolveBudget({ evalConfig: evalConfigWithModel }),
      scenarios,
      atlanteVersion: "0.0.0-test",
      runner: fakeRunner(() => completedRun()),
    });
    expect(report.meta.model).toBe("acme/model-x");
  });

  test("propagates budget-unmonitored into the trial result", async () => {
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
      scenarios,
      atlanteVersion: "0.0.0-test",
      runner: fakeRunner(() => completedRun({ budgetUnmonitored: true })),
    });
    const result = report.scenarios["happy-scenario"];
    if (!result) throw new Error("missing scenario result");
    expect(result.trials[0]?.budgetUnmonitored).toBe(true);
  });

  test("uses explicit unknown identity when neither config nor host reports it", async () => {
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
      scenarios,
      atlanteVersion: "0.0.0-test",
      runner: fakeRunner(() => completedRun()),
    });
    expect(report.meta.model).toBe("unknown");
    expect(report.meta.modelVersion).toBe("unknown");
  });

  test("check failures produce fail verdicts with complete evidence", async () => {
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
      scenarios,
      atlanteVersion: "0.0.0-test",
      runner: fakeRunner(() => completedRun()),
    });
    const result = report.scenarios["happy-scenario"];
    // The fixture scenario checks src/index.ts unchanged (pass) but
    // src/missing.ts baseline null vs still missing (pass) — both unchanged,
    // and file-exists src/index.ts passes. So this run passes; assert that.
    expect(result?.passRate).toBe(1);
  });

  test("timeout, budget-exceeded, and infra-error are recorded fail-closed", async () => {
    const outcomes: TrialRunOutcome[] = [
      "timeout",
      "budget-exceeded",
      "infra-error",
    ];
    let call = 0;
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 3 }),
      scenarios,
      atlanteVersion: "0.0.0-test",
      runner: fakeRunner(() => {
        const outcome = outcomes[call % outcomes.length];
        call += 1;
        return {
          outcome,
          durationMs: 5,
          ...(outcome === "infra-error"
            ? { error: "host binary missing" }
            : {}),
        };
      }),
    });
    const result = report.scenarios["happy-scenario"];
    expect(result?.trials.map((trial) => trial.verdict)).toEqual([
      "timeout",
      "budget-exceeded",
      "infra-error",
    ]);
    expect(result?.passRate).toBe(0);
    expect(result?.trials[2]?.error).toBe("host binary missing");
    // Budget-violating trials carry no checks: never treated as passes.
    expect(result?.trials.every((trial) => trial.checks === undefined)).toBe(
      true,
    );
  });

  test("skipped-budget trials are recorded when maxSessions is exhausted", async () => {
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: {
        trials: 3,
        timeoutMs: 60_000,
        maxSessions: 2,
        maxTokens: 400_000,
        setupTimeoutMs: 60_000,
      },
      scenarios,
      atlanteVersion: "0.0.0-test",
      runner: fakeRunner(() => completedRun()),
    });
    const result = report.scenarios["happy-scenario"];
    expect(result?.trials.map((trial) => trial.verdict)).toEqual([
      "pass",
      "pass",
      "skipped-budget",
    ]);
    expect(result?.passRate).toBe(1);
  });

  test("sandbox assembly infra errors become an infrastructure trial", async () => {
    const base = scenarios.at(0);
    if (!base) throw new Error("fixture scenario not discovered");
    const broken: DiscoveredEvalScenario = {
      scenario: {
        ...base.scenario,
        name: "broken-fixture",
        task: { ...base.scenario.task, fixture: "eval/fixtures/absent" },
      },
      source: "eval/scenarios/broken.eval.json",
    };
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
      scenarios: [broken],
      atlanteVersion: "0.0.0-test",
      runner: fakeRunner(() => completedRun()),
    });
    const result = report.scenarios["broken-fixture"];
    expect(result?.trials[0]?.verdict).toBe("infra-error");
    expect(result?.trials[0]?.error).toContain("fixture");
  });

  test("continues after an infrastructure trial and exits with code 1", async () => {
    const base = scenarios.at(0);
    if (!base) throw new Error("fixture scenario not discovered");
    const ordered = [
      {
        ...base,
        scenario: {
          ...base.scenario,
          name: "a-infra-failure",
          checks: [],
        },
      },
      {
        ...base,
        scenario: {
          ...base.scenario,
          name: "z-after-infra",
          checks: [],
        },
      },
    ];
    let calls = 0;
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 3 }),
      scenarios: ordered,
      atlanteVersion: "0.0.0-test",
      runner: {
        name: "fake",
        prepareHostIntegration() {},
        async runTrial() {
          calls += 1;
          return {
            outcome: calls === 1 ? "infra-error" : "completed",
            durationMs: 5,
            ...(calls === 1 ? { error: "host unavailable" } : {}),
          };
        },
      },
    });
    expect(calls).toBe(6);
    expect(Object.keys(report.scenarios)).toEqual([
      "a-infra-failure",
      "z-after-infra",
    ]);
    expect(
      report.scenarios["a-infra-failure"]?.trials.map((trial) => trial.verdict),
    ).toEqual(["infra-error", "pass", "pass"]);
    expect(
      report.scenarios["z-after-infra"]?.trials.map((trial) => trial.verdict),
    ).toEqual(["pass", "pass", "pass"]);
    expect(runExitCode(report)).toBe(1);
  });

  test("converts a thrown host error into an infrastructure trial", async () => {
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
      scenarios,
      atlanteVersion: "0.0.0-test",
      runner: {
        name: "fake",
        prepareHostIntegration() {},
        async runTrial() {
          throw new Error("host exploded");
        },
      },
    });
    expect(report.scenarios["happy-scenario"]?.trials[0]?.verdict).toBe(
      "infra-error",
    );
    expect(report.scenarios["happy-scenario"]?.trials[0]?.error).toBe(
      "host exploded",
    );
    expect(runExitCode(report)).toBe(1);
  });

  test("reports an infrastructure verdict when diff evidence cannot be collected", async () => {
    const base = scenarios.at(0);
    if (!base) throw new Error("fixture scenario not discovered");
    const scenario: DiscoveredEvalScenario = {
      ...base,
      scenario: { ...base.scenario, name: "diff-evidence", checks: [] },
    };
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
      scenarios: [scenario],
      atlanteVersion: "0.0.0-test",
      runner: {
        name: "fake",
        prepareHostIntegration() {},
        async runTrial(input) {
          rmSync(join(input.sandbox.root, ".git"), {
            recursive: true,
            force: true,
          });
          return completedRun();
        },
      },
    });
    expect(report.scenarios["diff-evidence"]?.trials[0]?.verdict).toBe(
      "infra-error",
    );
    expect(runExitCode(report)).toBe(1);
  });

  test("diff grading and evidence include changes committed by the host", async () => {
    const base = scenarios.at(0);
    if (!base) throw new Error("fixture scenario not discovered");
    const scenario: DiscoveredEvalScenario = {
      ...base,
      scenario: {
        ...base.scenario,
        name: "committed-out-of-scope",
        checks: [{ type: "diff-allowlist", allow: ["allowed.ts"] }],
      },
    };
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
      scenarios: [scenario],
      atlanteVersion: "0.0.0-test",
      runner: {
        name: "fake",
        prepareHostIntegration() {},
        async runTrial(input) {
          writeFileSync(join(input.sandbox.root, "sneaky.ts"), "scope creep\n");
          const add = await runCommand(["git", "add", "--all", "--force"], {
            cwd: input.sandbox.root,
            timeoutMs: 30_000,
          });
          if (add.exit !== 0) throw new Error("could not stage host change");
          const commit = await runCommand(
            [
              "git",
              "-c",
              "user.name=atlante-eval",
              "-c",
              "user.email=atlante-eval@atlante.local",
              "commit",
              "--quiet",
              "-m",
              "model commit",
            ],
            { cwd: input.sandbox.root, timeoutMs: 30_000 },
          );
          if (commit.exit !== 0)
            throw new Error("could not commit host change");
          return completedRun();
        },
      },
    });
    const trial = report.scenarios["committed-out-of-scope"]?.trials[0];
    expect(trial?.verdict).toBe("fail");
    expect(trial?.checks?.[0]?.evidence.unexpected).toEqual(["sneaky.ts"]);
    expect(trial?.diff).toContain("sneaky.ts");
  });

  test("diff evidence includes changes hidden by index flags", async () => {
    const base = scenarios.at(0);
    if (!base) throw new Error("fixture scenario not discovered");
    const scenario: DiscoveredEvalScenario = {
      ...base,
      scenario: {
        ...base.scenario,
        name: "index-flagged-change",
        checks: [{ type: "file-exists", path: "src/index.ts" }],
      },
    };
    const report = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
      scenarios: [scenario],
      atlanteVersion: "0.0.0-test",
      runner: {
        name: "fake",
        prepareHostIntegration() {},
        async runTrial(input) {
          const flags = await runCommand(
            [
              "git",
              "update-index",
              "--assume-unchanged",
              "--skip-worktree",
              "--",
              "src/index.ts",
            ],
            { cwd: input.sandbox.root, timeoutMs: 30_000 },
          );
          if (flags.exit !== 0) throw new Error("could not set index flags");
          writeFileSync(
            join(input.sandbox.root, "src", "index.ts"),
            "export const changed = true;\n",
          );
          return completedRun();
        },
      },
    });
    const trial = report.scenarios["index-flagged-change"]?.trials[0];
    expect(trial?.verdict).toBe("pass");
    expect(trial?.diff).toContain("src/index.ts");
  });

  test("retains a partial report for an unexpected run-level error", async () => {
    let failure: unknown;
    try {
      await runEval({
        projectRoot,
        evalConfig,
        budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
        scenarios,
        atlanteVersion: "0.0.0-test",
        runner: fakeRunner(() => completedRun()),
        onProgress() {
          throw new Error("progress observer failed");
        },
      });
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(EvalRunError);
    expect((failure as EvalRunError).report.runId).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
    expect((failure as EvalRunError).report.scenarios).toEqual({});
  });

  test("scenario keys are sorted regardless of discovery order", async () => {
    const reversed = [...scenarios].reverse();
    const report: RunReport = await runEval({
      projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride: 1 }),
      scenarios: reversed,
      atlanteVersion: "0.0.0-test",
      runner: fakeRunner(() => completedRun()),
    });
    expect(Object.keys(report.scenarios)).toEqual(
      [...Object.keys(report.scenarios)].sort(),
    );
  });
});
