import type { EvalConfig } from "@atlante/schema";
import type { DiscoveredEvalScenario } from "@atlante/validator";
import { runChecks } from "./checks.js";
import type { ResolvedBudget } from "./config.js";
import { scenarioTimeoutMs } from "./config.js";
import { createRunId } from "./run-id.js";
import type { Sandbox } from "./sandbox.js";
import {
  assembleSandbox,
  createRunRoot,
  destroyRunRoot,
  destroySandbox,
} from "./sandbox.js";
import { runCommand } from "./spawn.js";
import {
  type RunReport,
  scenarioStatistics,
  type TrialResult,
} from "./types.js";

/**
 * The host-specific surface (spawn invocation, event parsing, permission
 * merge, sandbox config authoring) lives behind this interface. It is NOT
 * pre-abstracted for future hosts: the interface gets extracted from the
 * opencode implementation only when a second host lands.
 */
export interface HostRunner {
  readonly name: string;
  /** Writes the host integration into the assembled sandbox project. */
  prepareHostIntegration(
    sandbox: Sandbox,
    context: { agent?: string },
  ): Promise<void> | void;
  /** Runs one session against the sandbox, honoring the given budget. */
  runTrial(input: RunTrialInput): Promise<TrialRun>;
}

export type RunTrialInput = {
  sandbox: Sandbox;
  prompt: string;
  /** Harness agent driving the task; the host default applies when absent. */
  agent?: string;
  timeoutMs: number;
  maxTokens: number;
  model?: string;
};

export type TrialRunOutcome =
  | "completed"
  | "timeout"
  | "budget-exceeded"
  | "infra-error";

export type TrialRun = {
  outcome: TrialRunOutcome;
  durationMs: number;
  /** Cumulative token usage from the host event stream. */
  tokens?: number;
  /** Cumulative cost from the host event stream. */
  cost?: number;
  /** Model and version identifiers from the session events. */
  model?: string;
  modelVersion?: string;
  /** Diagnostic detail for non-completed outcomes. */
  error?: string;
};

export type EvalProgress =
  | { kind: "scenario-start"; scenario: string }
  | { kind: "trial-start"; scenario: string; trial: number }
  | {
      kind: "trial-end";
      scenario: string;
      trial: number;
      verdict: TrialResult["verdict"];
      durationMs: number;
      tokens?: number;
      cost?: number;
    }
  | { kind: "scenario-end"; scenario: string; passRate: number };

export type RunEvalInput = {
  projectRoot: string;
  evalConfig: EvalConfig;
  budget: ResolvedBudget;
  scenarios: readonly DiscoveredEvalScenario[];
  atlanteVersion: string;
  keep?: boolean;
  runner: HostRunner;
  onProgress?: (progress: EvalProgress) => void;
};

/**
 * Executes the eval run: scenarios sorted by name, trials sequential, budget
 * enforced by construction (the runner loop is the process spawning the
 * host). Fail-closed: every budget violation is recorded as a trial verdict,
 * never silently discarded.
 */
export async function runEval(input: RunEvalInput): Promise<RunReport> {
  const runId = createRunId();
  const runRoot = createRunRoot();
  const report: RunReport = {
    runId,
    meta: {
      atlante: input.atlanteVersion,
      host: input.runner.name,
      config: {
        trials: input.budget.trials,
        timeoutMs: input.budget.timeoutMs,
        maxSessions: input.budget.maxSessions,
        maxTokens: input.budget.maxTokens,
      },
    },
    scenarios: {},
  };

  try {
    let sessions = 0;
    const scenarios = [...input.scenarios].sort((left, right) =>
      left.scenario.name < right.scenario.name
        ? -1
        : left.scenario.name > right.scenario.name
          ? 1
          : 0,
    );

    for (const scenario of scenarios) {
      const name = scenario.scenario.name;
      input.onProgress?.({ kind: "scenario-start", scenario: name });
      const timeoutMs = scenarioTimeoutMs(
        scenario.scenario.budget,
        input.budget,
      );
      const trials: TrialResult[] = [];

      for (let index = 0; index < input.budget.trials; index++) {
        if (sessions >= input.budget.maxSessions) {
          trials.push({ i: index, verdict: "skipped-budget", durationMs: 0 });
          input.onProgress?.({
            kind: "trial-end",
            scenario: name,
            trial: index,
            verdict: "skipped-budget",
            durationMs: 0,
          });
          continue;
        }

        input.onProgress?.({
          kind: "trial-start",
          scenario: name,
          trial: index,
        });
        sessions += 1;
        const startedAt = Date.now();
        let sandbox: Sandbox;
        try {
          sandbox = await assembleSandbox(
            {
              runRoot,
              projectRoot: input.projectRoot,
              scenario,
              trialIndex: index,
              budget: input.budget,
              keep: Boolean(input.keep),
            },
            (assembled) =>
              input.runner.prepareHostIntegration(assembled, {
                ...(scenario.scenario.task.agent
                  ? { agent: scenario.scenario.task.agent }
                  : {}),
              }),
          );
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          const durationMs = Date.now() - startedAt;
          trials.push({ i: index, verdict: "infra-error", durationMs, error });
          input.onProgress?.({
            kind: "trial-end",
            scenario: name,
            trial: index,
            verdict: "infra-error",
            durationMs,
          });
          continue;
        }

        const run = await input.runner.runTrial({
          sandbox,
          prompt: scenario.scenario.task.prompt,
          ...(scenario.scenario.task.agent
            ? { agent: scenario.scenario.task.agent }
            : {}),
          timeoutMs,
          maxTokens: input.budget.maxTokens,
          ...(input.evalConfig.model ? { model: input.evalConfig.model } : {}),
        });

        if (run.model && report.meta.model === undefined) {
          report.meta.model = run.model;
          report.meta.modelVersion = run.modelVersion;
        }

        const trial: TrialResult = {
          i: index,
          // Overwritten below; the mapping stays fail-closed either way.
          verdict: "fail",
          durationMs: run.durationMs,
        };
        if (run.outcome === "completed") {
          const checks = await runChecks(sandbox, scenario.scenario.checks);
          trial.verdict = checks.every((check) => check.verdict === "pass")
            ? "pass"
            : "fail";
          trial.checks = checks;
          trial.diff = await sandboxDiff(sandbox);
        } else if (run.outcome === "timeout") {
          trial.verdict = "timeout";
          trial.error = run.error;
        } else if (run.outcome === "budget-exceeded") {
          trial.verdict = "budget-exceeded";
          trial.error = run.error;
        } else {
          trial.verdict = "infra-error";
          trial.error = run.error;
        }
        if (run.tokens !== undefined) trial.tokens = run.tokens;
        if (run.cost !== undefined) trial.cost = run.cost;
        trials.push(trial);
        input.onProgress?.({
          kind: "trial-end",
          scenario: name,
          trial: index,
          verdict: trial.verdict,
          durationMs: trial.durationMs,
          ...(run.tokens !== undefined ? { tokens: run.tokens } : {}),
          ...(run.cost !== undefined ? { cost: run.cost } : {}),
        });
        destroySandbox(sandbox);
      }

      const statistics = scenarioStatistics(trials);
      report.scenarios[name] = statistics;
      input.onProgress?.({
        kind: "scenario-end",
        scenario: name,
        passRate: statistics.passRate,
      });
    }

    return report;
  } finally {
    if (!input.keep) destroyRunRoot(runRoot);
  }
}

const DIFF_EVIDENCE_LIMIT = 20_000;

/** Sandbox diff against the baseline commit; report evidence, not a verdict. */
async function sandboxDiff(sandbox: Sandbox): Promise<string> {
  const outcome = await runCommand(["git", "diff", "HEAD"], {
    cwd: sandbox.root,
    timeoutMs: 60_000,
  });
  if (outcome.exit !== 0) return "";
  const diff = outcome.stdout;
  return diff.length > DIFF_EVIDENCE_LIMIT
    ? `${diff.slice(0, DIFF_EVIDENCE_LIMIT)}\n… truncated`
    : diff;
}
