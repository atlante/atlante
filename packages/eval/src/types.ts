/**
 * Result and report types. The report shape is a comparison contract: the same
 * keys always, so variant comparison is a mechanical JSON diff.
 */

export type CheckType =
  | "command"
  | "file-exists"
  | "file-absent"
  | "file-contains"
  | "file-unchanged"
  | "diff-allowlist";

/** A check that could not produce a verdict at all is `error` (infra-level). */
export type CheckVerdict = "pass" | "fail" | "error";

export type CheckResult = {
  index: number;
  type: CheckType;
  verdict: CheckVerdict;
  /** Check-specific, JSON-serializable evidence. */
  evidence: Record<string, unknown>;
};

/**
 * Trial verdict taxonomy (fail-closed): a trial that violates its budget is
 * `timeout` or `budget-exceeded`, never silently discarded; `skipped-budget`
 * marks trials not started because the session cap was reached.
 */
export type TrialVerdict =
  | "pass"
  | "fail"
  | "timeout"
  | "budget-exceeded"
  | "infra-error"
  | "skipped-budget";

export type TrialResult = {
  /** Trial index within the scenario. */
  i: number;
  verdict: TrialVerdict;
  durationMs: number;
  /** Cumulative token usage when the host exposes it. */
  tokens?: number;
  /** Cumulative cost when the host exposes it. */
  cost?: number;
  /**
   * No usage event was ever seen, so `maxTokens` was not actually enforced
   * and only the timeout bounded the run.
   */
  budgetUnmonitored?: boolean;
  /** Complete per-check evidence; present for executed trials. */
  checks?: CheckResult[];
  /** Sandbox diff evidence for executed trials. */
  diff?: string;
  /** Diagnostic detail for `infra-error` trials. */
  error?: string;
};

export type ScenarioResult = {
  trials: TrialResult[];
  /** Passes over executed trials; skipped-budget trials are excluded. */
  passRate: number;
  meanDurationMs: number;
  spread: { durationP95Ms: number };
};

export type RunMeta = {
  atlante: string;
  host: string;
  /** Mandatory for valid before/after comparisons. */
  model: string;
  modelVersion: string;
  config: {
    trials: number;
    timeoutMs: number;
    maxSessions: number;
    maxTokens: number;
    /** Setup-command in-flight budget; recorded for report comparability. */
    setupTimeoutMs: number;
    /** Per-check default in-flight budget; recorded for comparability. */
    checkTimeoutDefaultMs: number;
  };
};

export type RunReport = {
  /** Timestamp + random suffix; also the report directory name. */
  runId: string;
  meta: RunMeta;
  /** Keyed by scenario name; keys are sorted. */
  scenarios: Record<string, ScenarioResult>;
};

/** Whether a run satisfies its exit-code contract at the trial level. */
export function runExitCode(report: RunReport): 0 | 1 {
  for (const result of Object.values(report.scenarios)) {
    for (const trial of result.trials) {
      if (trial.verdict !== "pass") return 1;
    }
  }
  return 0;
}

/** Statistics over executed (non-skipped) trials only. */
export function scenarioStatistics(trials: TrialResult[]): ScenarioResult {
  const executed = trials.filter((trial) => trial.verdict !== "skipped-budget");
  const passes = executed.filter((trial) => trial.verdict === "pass").length;
  const durations = executed
    .map((trial) => trial.durationMs)
    .sort((a, b) => a - b);
  const mean =
    durations.length === 0
      ? 0
      : durations.reduce((sum, value) => sum + value, 0) / durations.length;
  const p95Index = Math.max(0, Math.ceil(0.95 * durations.length) - 1);
  return {
    trials,
    passRate: executed.length === 0 ? 0 : passes / executed.length,
    meanDurationMs: Math.round(mean),
    spread: { durationP95Ms: durations[p95Index] ?? 0 },
  };
}
