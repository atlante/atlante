export { runChecks } from "./checks.js";
export type { ResolvedBudget } from "./config.js";
export {
  resolveBudget,
  SETUP_TIMEOUT_DEFAULT_MS,
  scenarioTimeoutMs,
} from "./config.js";
export type {
  ClaudeAuthMethod,
  ClaudeAuthStatus,
  ClaudeAuthStatusProbe,
  ClaudeHostRunner,
  ClaudeRunnerOptions,
  ClaudeVersion,
  ClaudeVersionErrorCode,
  ClaudeVersionProbe,
} from "./host/claude.js";
export {
  CLAUDE_BINARY,
  ClaudeVersionError,
  checkClaudeAuth,
  createClaudeRunner,
  normalizeClaudeUsage,
  parseClaudeVersion,
} from "./host/claude.js";
export type {
  OpenCodeAuthStatus,
  OpenCodeDatabasePathProbe,
  OpenCodeHostRunner,
  OpenCodeRunnerOptions,
} from "./host/opencode.js";
export {
  checkOpenCodeAuth,
  createEvalPermissionPolicy,
  createOpenCodeRunner,
  extractModelIdentifiers,
  normalizeTokens,
  OPENCODE_BINARY,
  sqliteRuntimeArguments,
} from "./host/opencode.js";
export { createRunId, reserveRunId } from "./run-id.js";
export type {
  EvalProgress,
  HostRunner,
  RunEvalInput,
  RunTrialInput,
  TrialRun,
  TrialRunOutcome,
} from "./runner.js";
export { EvalRunError, runEval } from "./runner.js";
export type { Sandbox, SnapshotEntry } from "./sandbox.js";
export {
  assembleSandbox,
  createRunRoot,
  destroyRunRoot,
  destroySandbox,
  type EvalHostName,
  NativeOutputsNotVerifiedError,
  verifyClaudeCodeNativeOutputs,
  verifyHostNativeOutputs,
  verifyNativeOutputs,
} from "./sandbox.js";
export type { CommandOutcome } from "./spawn.js";
export { killTree, runCommand } from "./spawn.js";
export type {
  CheckResult,
  CheckType,
  CheckVerdict,
  RunMeta,
  RunReport,
  ScenarioResult,
  TrialResult,
  TrialVerdict,
} from "./types.js";
export { runExitCode, scenarioStatistics } from "./types.js";
