import {
  EVAL_CHECK_TIMEOUT_DEFAULT_MS,
  type EvalConfig,
} from "@atlante/schema";
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
  /**
   * No usage event was ever seen, so the maxTokens budget was not actually
   * enforced (only the timeout bounded the run).
   */
  budgetUnmonitored?: boolean;
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
 * Wraps an unexpected run-level failure while retaining the report prefix
 * produced before it. Trial-level failures are recorded on their trial and do
 * not use this error type.
 */
export class EvalRunError extends Error {
  readonly report: RunReport;

  constructor(report: RunReport, cause: unknown) {
    super("the eval run failed before it completed", { cause });
    this.name = "EvalRunError";
    this.report = report;
  }
}

/**
 * Executes the eval run: scenarios sorted by name, trials sequential, budget
 * enforced by construction (the runner loop is the process spawning the
 * host). Fail-closed: every budget violation is recorded as a trial verdict,
 * never silently discarded.
 */
export async function runEval(input: RunEvalInput): Promise<RunReport> {
  const runId = createRunId();
  const report: RunReport = {
    runId,
    meta: {
      atlante: input.atlanteVersion,
      host: input.runner.name,
      model: input.evalConfig.model ?? "unknown",
      modelVersion: "unknown",
      config: {
        trials: input.budget.trials,
        timeoutMs: input.budget.timeoutMs,
        maxSessions: input.budget.maxSessions,
        maxTokens: input.budget.maxTokens,
        // Recorded so before/after report diffs can explain setup and
        // grading timing changes.
        setupTimeoutMs: input.budget.setupTimeoutMs,
        checkTimeoutMs: EVAL_CHECK_TIMEOUT_DEFAULT_MS,
      },
    },
    scenarios: {},
  };
  let runRoot: string | undefined;

  try {
    runRoot = createRunRoot();
    let sessions = 0;
    let hostIdentityRecorded = false;
    const scenarios = [...input.scenarios].sort((left, right) =>
      left.scenario.name < right.scenario.name
        ? -1
        : left.scenario.name > right.scenario.name
          ? 1
          : 0,
    );

    for (const scenario of scenarios) {
      const execution = await executeScenario({
        input,
        runRoot,
        scenario,
        sessions: () => sessions,
        onSessionStart: () => {
          sessions += 1;
        },
      });
      report.scenarios[scenario.scenario.name] = execution.result;
      if (execution.model && !hostIdentityRecorded) {
        report.meta.model = execution.model;
        report.meta.modelVersion = execution.modelVersion ?? "unknown";
        hostIdentityRecorded = true;
      }
    }

    return report;
  } catch (cause) {
    throw new EvalRunError(report, cause);
  } finally {
    if (runRoot && !input.keep) destroyRunRoot(runRoot);
  }
}

type ExecuteTrialInput = {
  input: RunEvalInput;
  runRoot: string;
  scenario: DiscoveredEvalScenario;
  trialIndex: number;
  timeoutMs: number;
  onSessionStart: () => void;
};

type ExecuteTrialResult = {
  trial: TrialResult;
  model?: string;
  modelVersion?: string;
};

type ExecuteScenarioInput = {
  input: RunEvalInput;
  runRoot: string;
  scenario: DiscoveredEvalScenario;
  sessions: () => number;
  onSessionStart: () => void;
};

type ExecuteScenarioResult = {
  result: ReturnType<typeof scenarioStatistics>;
  model?: string;
  modelVersion?: string;
};

async function executeScenario(
  execution: ExecuteScenarioInput,
): Promise<ExecuteScenarioResult> {
  const { input, runRoot, scenario, sessions, onSessionStart } = execution;
  const name = scenario.scenario.name;
  input.onProgress?.({ kind: "scenario-start", scenario: name });
  const timeoutMs = scenarioTimeoutMs(scenario.scenario.budget, input.budget);
  const trials: TrialResult[] = [];
  let model: string | undefined;
  let modelVersion: string | undefined;

  for (let index = 0; index < input.budget.trials; index++) {
    if (sessions() >= input.budget.maxSessions) {
      const trial: TrialResult = {
        i: index,
        verdict: "skipped-budget",
        durationMs: 0,
      };
      trials.push(trial);
      emitTrialEnd(input.onProgress, name, index, trial);
      continue;
    }

    input.onProgress?.({
      kind: "trial-start",
      scenario: name,
      trial: index,
    });
    const result = await executeTrial({
      input,
      runRoot,
      scenario,
      trialIndex: index,
      timeoutMs,
      onSessionStart,
    });
    if (model === undefined && result.model !== undefined) {
      model = result.model;
      modelVersion = result.modelVersion;
    }
    const { trial } = result;
    trials.push(trial);
    emitTrialEnd(input.onProgress, name, index, trial);
  }

  const result = scenarioStatistics(trials);
  input.onProgress?.({
    kind: "scenario-end",
    scenario: name,
    passRate: result.passRate,
  });
  return {
    result,
    ...(model !== undefined ? { model, modelVersion } : {}),
  };
}

function emitTrialEnd(
  onProgress: RunEvalInput["onProgress"],
  scenario: string,
  trial: number,
  result: TrialResult,
): void {
  onProgress?.({
    kind: "trial-end",
    scenario,
    trial,
    verdict: result.verdict,
    durationMs: result.durationMs,
    ...(result.tokens !== undefined ? { tokens: result.tokens } : {}),
    ...(result.cost !== undefined ? { cost: result.cost } : {}),
  });
}

async function executeTrial(
  execution: ExecuteTrialInput,
): Promise<ExecuteTrialResult> {
  const { input, scenario, trialIndex, timeoutMs } = execution;
  const prepared = await assembleTrial(execution);
  if ("trial" in prepared) {
    return { trial: prepared.trial };
  }

  const run = await runHostTrial({
    input,
    scenario,
    sandbox: prepared.sandbox,
    timeoutMs,
    onSessionStart: execution.onSessionStart,
  });
  const trial = await gradeTrial({
    sandbox: prepared.sandbox,
    scenario,
    trialIndex,
    run,
  });
  return {
    trial,
    ...(run.model ? { model: run.model } : {}),
    ...(run.modelVersion ? { modelVersion: run.modelVersion } : {}),
  };
}

type PreparedTrial = { sandbox: Sandbox } | { trial: TrialResult };

async function assembleTrial(
  execution: ExecuteTrialInput,
): Promise<PreparedTrial> {
  const { input, runRoot, scenario, trialIndex } = execution;
  const startedAt = Date.now();
  try {
    const sandbox = await assembleSandbox(
      {
        runRoot,
        projectRoot: input.projectRoot,
        scenario,
        trialIndex,
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
    return { sandbox };
  } catch (cause) {
    return {
      trial: {
        i: trialIndex,
        verdict: "infra-error",
        durationMs: Date.now() - startedAt,
        error: cause instanceof Error ? cause.message : String(cause),
      },
    };
  }
}

async function runHostTrial(input: {
  input: RunEvalInput;
  scenario: DiscoveredEvalScenario;
  sandbox: Sandbox;
  timeoutMs: number;
  onSessionStart: () => void;
}): Promise<TrialRun> {
  const startedAt = Date.now();
  input.onSessionStart();
  try {
    return await input.input.runner.runTrial({
      sandbox: input.sandbox,
      prompt: input.scenario.scenario.task.prompt,
      ...(input.scenario.scenario.task.agent
        ? { agent: input.scenario.scenario.task.agent }
        : {}),
      timeoutMs: input.timeoutMs,
      maxTokens: input.input.budget.maxTokens,
      ...(input.input.evalConfig.model
        ? { model: input.input.evalConfig.model }
        : {}),
    });
  } catch (cause) {
    return {
      outcome: "infra-error",
      durationMs: Date.now() - startedAt,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

async function gradeTrial(input: {
  sandbox: Sandbox;
  scenario: DiscoveredEvalScenario;
  trialIndex: number;
  run: TrialRun;
}): Promise<TrialResult> {
  const { sandbox, scenario, trialIndex, run } = input;
  const trial: TrialResult = {
    i: trialIndex,
    // Overwritten below; the mapping stays fail-closed either way.
    verdict: run.outcome === "completed" ? "fail" : run.outcome,
    durationMs: run.durationMs,
    ...(run.tokens !== undefined ? { tokens: run.tokens } : {}),
    ...(run.cost !== undefined ? { cost: run.cost } : {}),
    ...(run.budgetUnmonitored ? { budgetUnmonitored: true } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
  };
  try {
    if (run.outcome === "completed") {
      const checks = await runChecks(sandbox, scenario.scenario.checks);
      trial.verdict = checks.some((check) => check.verdict === "error")
        ? "infra-error"
        : checks.every((check) => check.verdict === "pass")
          ? "pass"
          : "fail";
      trial.checks = checks;
      trial.diff = await sandboxDiff(sandbox);
    }
  } catch (cause) {
    trial.verdict = "infra-error";
    trial.error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    destroySandbox(sandbox);
  }
  return trial;
}

const DIFF_EVIDENCE_LIMIT = 20_000;

/** Sandbox diff against the baseline commit; report evidence, not a verdict. */
async function sandboxDiff(sandbox: Sandbox): Promise<string> {
  // Stage all current paths so git diff HEAD also includes untracked and
  // ignored files created by the host after the baseline commit.
  const staged = await runCommand(["git", "add", "--all", "--force"], {
    cwd: sandbox.root,
    timeoutMs: 60_000,
  });
  if (staged.spawnError !== undefined || staged.exit !== 0) {
    throw new Error(
      `could not collect sandbox diff: git add exited ${staged.exit}: ${staged.spawnError ?? staged.stderr.slice(-400)}`,
    );
  }
  const outcome = await runCommand(["git", "diff", "HEAD"], {
    cwd: sandbox.root,
    timeoutMs: 60_000,
  });
  if (outcome.spawnError !== undefined || outcome.exit !== 0) {
    throw new Error(
      `could not collect sandbox diff: git diff exited ${outcome.exit}: ${outcome.spawnError ?? outcome.stderr.slice(-400)}`,
    );
  }
  const diff = outcome.stdout;
  return diff.length > DIFF_EVIDENCE_LIMIT
    ? `${diff.slice(0, DIFF_EVIDENCE_LIMIT)}\n… truncated`
    : diff;
}
