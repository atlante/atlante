import type { EvalConfig } from "@atlante/schema";
import { EVAL_BUDGET_DEFAULTS } from "@atlante/schema";

/** Extra in-flight budget for scenario `setup` commands. */
export const SETUP_TIMEOUT_DEFAULT_MS = 300_000;

export type ResolvedBudget = {
  trials: number;
  timeoutMs: number;
  maxSessions: number;
  maxTokens: number;
  setupTimeoutMs: number;
};

/**
 * Resolves the effective run budget from the authored `eval` section and CLI
 * overrides. Schema defaults apply to partial budgets; a missing budget
 * section inherits every default.
 */
export function resolveBudget(input: {
  evalConfig: EvalConfig | undefined;
  trialsOverride?: number;
}): ResolvedBudget {
  const authored = input.evalConfig?.budget;
  return {
    trials:
      input.trialsOverride ?? authored?.trials ?? EVAL_BUDGET_DEFAULTS.trials,
    timeoutMs: authored?.timeoutMs ?? EVAL_BUDGET_DEFAULTS.timeoutMs,
    maxSessions: authored?.maxSessions ?? EVAL_BUDGET_DEFAULTS.maxSessions,
    maxTokens: authored?.maxTokens ?? EVAL_BUDGET_DEFAULTS.maxTokens,
    setupTimeoutMs: SETUP_TIMEOUT_DEFAULT_MS,
  };
}

/** Scenario-level timeout override, else the run budget timeout. */
export function scenarioTimeoutMs(
  scenarioBudget: { timeoutMs?: number } | undefined,
  budget: ResolvedBudget,
): number {
  return scenarioBudget?.timeoutMs ?? budget.timeoutMs;
}
