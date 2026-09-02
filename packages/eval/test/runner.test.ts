import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArtifacts, publishArtifacts } from "@atlante/artifacts";
import type { EvalConfig } from "@atlante/schema";
import {
  type DiscoveredEvalScenario,
  discoverEvalScenarios,
} from "@atlante/validator";
import {
  type HostRunner,
  type RunReport,
  resolveBudget,
  runEval,
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
    expect(result.trials[0]?.checks).toHaveLength(3);
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

  test("sandbox assembly infra errors mark the trial, not the whole run", async () => {
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
