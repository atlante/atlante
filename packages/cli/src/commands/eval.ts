import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadProject, type ProjectContext } from "@atlante/builder";
import {
  checkOpenCodeAuth,
  createOpenCodeRunner,
  type EvalProgress,
  EvalRunError,
  type HostRunner,
  type RunReport,
  reserveRunId,
  resolveBudget,
  runEval,
  runExitCode,
  verifyNativeOutputs,
} from "@atlante/eval";
import type { EvalConfig } from "@atlante/schema";
import { EVAL_MAX_TRIALS } from "@atlante/schema";
import {
  type DiscoveredEvalScenario,
  discoverEvalScenarios,
  error,
  hasErrors,
} from "@atlante/validator";
import packageJson from "../../package.json" with { type: "json" };
import { firstPartyProjectContext } from "../first-party-pack.js";
import { diagnosticPath, printDiagnostics } from "../report.js";
import { createStyler, type Styler } from "../style.js";

export type EvalCommandOptions = {
  /** Repeatable `--scenario <name>` filter; absent runs the whole suite. */
  scenario?: string[];
  /** `--trials <n>` override of the configured trial count. */
  trials?: string;
  /** `--json` prints the report JSON to stdout instead of a summary. */
  json?: boolean;
  /** `--out <dir>` relocates the report from `<project>/.atlante/eval`. */
  out?: string;
  /** `--keep` preserves trial sandboxes for inspection. */
  keep?: boolean;
};

/**
 * Runs eval scenarios against the project's verified native outputs. `atlante
 * eval` never builds: outputs must already be materialized and verified,
 * missing or stale ones are a validation failure with `atlante build` as the
 * recovery action. Exit codes: 0 all trials pass, 1 any trial failed, was
 * skipped, or hit a trial-level infrastructure error, 2 validation errors, 3
 * a run-preventing infrastructure error.
 */
export async function runEvalCommand(
  target: string,
  options: EvalCommandOptions = {},
  context: ProjectContext = firstPartyProjectContext(),
  runner?: HostRunner,
): Promise<number> {
  const prepared = prepareEval(target, options, context);
  if (typeof prepared === "number") return prepared;

  const host =
    runner ?? createOpenCodeRunner({ projectRoot: prepared.projectRoot });
  // The default runner needs stored credentials; without them every trial
  // would fail individually. Missing auth is run-preventing infrastructure.
  if (runner === undefined) {
    const auth = checkOpenCodeAuth();
    if (!auth.authenticated) {
      printDiagnostics([
        error(
          "eval-host-unauthenticated",
          `opencode authentication not found at ${auth.path}`,
          {
            source: diagnosticPath(auth.path),
            expected: "host credentials stored by OpenCode",
            next: "run `opencode` and sign in once, then re-run this command",
          },
        ),
      ]);
      return 3;
    }
  }
  let report: RunReport;
  const progressLine = createProgressRenderer();
  const styleProgress = createProgressStyler();
  try {
    report = await runEval({
      projectRoot: prepared.projectRoot,
      evalConfig: prepared.evalConfig,
      budget: resolveBudget({
        evalConfig: prepared.evalConfig,
        trialsOverride: prepared.trialsOverride,
      }),
      scenarios: prepared.scenarios,
      atlanteVersion: packageJson.version,
      ...(options.keep ? { keep: true } : {}),
      runner: host,
      // Live progress goes to stderr in both output modes; stdout stays
      // reserved for the summary (or the pure JSON report with `--json`).
      onProgress: (progress) => {
        console.error(styleProgress(progressLine(progress)));
      },
    });
  } catch (cause) {
    if (cause instanceof EvalRunError) {
      try {
        const reportDir = publishReport(
          prepared.projectRoot,
          cause.report,
          options.out,
        );
        if (options.json) {
          console.log(JSON.stringify(cause.report, null, 2));
        } else {
          printSummary(cause.report, reportDir);
        }
      } catch (publishCause) {
        return reportPublishFailure(
          prepared.projectRoot,
          options.out,
          publishCause,
        );
      }
    }
    return reportRunFailure(prepared.source, cause);
  }

  let reportDir: string;
  try {
    reportDir = publishReport(prepared.projectRoot, report, options.out);
  } catch (cause) {
    return reportPublishFailure(prepared.projectRoot, options.out, cause);
  }
  if (options.json) {
    warnUnmonitoredBudget(report);
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report, reportDir);
  }
  return runExitCode(report);
}

/** `budgetUnmonitored` must reach operators in both output modes. */
function budgetWarning(styler: Styler): string {
  return `${styler.warning("warning:")} token budget unmonitored for one or more trials (no usage events were observed)`;
}

function warnUnmonitoredBudget(report: RunReport): void {
  if (!hasUnmonitoredBudget(report)) return;
  console.error(budgetWarning(createStyler(process.stderr)));
}

function hasUnmonitoredBudget(report: RunReport): boolean {
  return Object.values(report.scenarios).some((result) =>
    result.trials.some((trial) => trial.budgetUnmonitored === true),
  );
}

type PreparedEval = {
  projectRoot: string;
  source: string;
  evalConfig: EvalConfig;
  scenarios: DiscoveredEvalScenario[];
  trialsOverride: number | undefined;
};

function prepareEval(
  target: string,
  options: EvalCommandOptions,
  context: ProjectContext,
): PreparedEval | 2 {
  const loaded = loadProject(target, context);
  printDiagnostics(loaded.diagnostics);
  if (hasErrors(loaded.diagnostics)) return 2;
  if (!loaded.document || !loaded.projectRoot) {
    printDiagnostics([
      noEvalConfig(
        "no Atlante configuration found",
        diagnosticPath(target),
        "run `atlante init` to scaffold the configuration",
      ),
    ]);
    return 2;
  }

  const evalConfig = loaded.document.eval;
  if (!evalConfig) {
    printDiagnostics([
      noEvalConfig(
        "the configuration has no eval section",
        diagnosticPath(loaded.configPath ?? target),
        'add an "eval" section ({ "host": "opencode", "scenarios": "..." }) to the configuration',
      ),
    ]);
    return 2;
  }

  const trialsOverride = parseTrialsOverride(options.trials);
  if (trialsOverride === null) return 2;

  const discovery = discoverEvalScenarios(
    loaded.projectRoot,
    evalConfig.scenarios,
  );
  printDiagnostics(discovery.diagnostics);
  if (hasErrors(discovery.diagnostics)) return 2;

  const scenarios = filterScenarios(
    discovery.scenarios,
    options.scenario ?? [],
  );
  if (scenarios === null) return 2;

  try {
    verifyNativeOutputs(loaded.projectRoot);
  } catch (cause) {
    printDiagnostics([
      error(
        "native-outputs-not-verified",
        cause instanceof Error ? cause.message : String(cause),
        {
          source: diagnosticPath(join(loaded.projectRoot, ".atlante")),
          expected: "verified native OpenCode outputs",
          next: "run `atlante build` and try again",
        },
      ),
    ]);
    return 2;
  }

  return {
    projectRoot: loaded.projectRoot,
    source: loaded.configPath ?? target,
    evalConfig,
    scenarios,
    trialsOverride,
  };
}

function reportRunFailure(source: string, cause: unknown): 3 {
  // Failures inside trials are verdicts; an exception out of the loop
  // itself means the run could not proceed at all.
  printDiagnostics([
    error("eval-run-failed", "the eval run could not be executed", {
      source: diagnosticPath(source),
      cause: causeMessage(cause),
      next: "re-run with `--keep` and inspect the preserved sandboxes if the cause is unclear",
    }),
  ]);
  return 3;
}

function causeMessage(cause: unknown): string {
  if (cause instanceof EvalRunError) {
    return cause.cause instanceof Error
      ? cause.cause.message
      : String(cause.cause);
  }
  return cause instanceof Error ? cause.message : String(cause);
}

function reportPublishFailure(
  projectRoot: string,
  out: string | undefined,
  cause: unknown,
): 3 {
  printDiagnostics([
    error("eval-report-failed", "the eval report could not be written", {
      source: diagnosticPath(out ?? join(projectRoot, ".atlante", "eval")),
      cause: cause instanceof Error ? cause.message : String(cause),
      next: "choose a writable report location and try again",
    }),
  ]);
  return 3;
}

function noEvalConfig(message: string, source: string, next: string) {
  return error("eval-not-configured", message, {
    source,
    expected: "a configuration with an eval section",
    next,
  });
}

/** `--trials` is optional; a present-but-invalid value is a usage error (null). */
function parseTrialsOverride(
  raw: string | undefined,
): number | undefined | null {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > EVAL_MAX_TRIALS) {
    printDiagnostics([
      error(
        "invalid-trials",
        `--trials must be an integer from 1 to ${EVAL_MAX_TRIALS}, got ${raw}`,
        {
          expected: `an integer from 1 to ${EVAL_MAX_TRIALS}`,
          next: "pass e.g. `--trials 3`",
        },
      ),
    ]);
    return null;
  }
  return value;
}

/** Returns null after printing an `unknown-scenario-filter` diagnostic. */
function filterScenarios<T extends { scenario: { name: string } }>(
  scenarios: readonly T[],
  filters: readonly string[],
): T[] | null {
  if (filters.length === 0) return [...scenarios];
  const available = new Set(
    scenarios.map((scenario) => scenario.scenario.name),
  );
  const unknown = filters.filter((name) => !available.has(name));
  if (unknown.length > 0) {
    printDiagnostics([
      error(
        "unknown-scenario-filter",
        `--scenario matched no scenario: ${unknown.join(", ")}`,
        {
          expected: `one of: ${[...available].sort().join(", ") || "(none discovered)"}`,
          next: "list the scenario names in the configured scenario location",
        },
      ),
    ]);
    return null;
  }
  const selected = new Set(filters);
  return scenarios.filter((scenario) => selected.has(scenario.scenario.name));
}

/**
 * Writes `<base>/<runId>/report.json` under the project. Eval runs are
 * disposable evidence: the default location is gitignored via
 * `.atlante/.gitignore` (created or appended, never rewritten). The run
 * directory is atomically reserved before the report file is written.
 */
function publishReport(
  projectRoot: string,
  report: RunReport,
  out: string | undefined,
): string {
  const base = out ?? join(projectRoot, ".atlante", "eval");
  assertNoSymlinkPath(base, "report output");
  mkdirSync(base, { recursive: true });
  assertNoSymlinkPath(base, "report output");
  // Reserve the leaf atomically: an existence check followed by recursive
  // mkdir would still allow two concurrent evals to choose the same id.
  reserveRunId(report, (id) => {
    const candidate = join(base, id);
    assertNoSymlinkPath(candidate, "report output");
    try {
      mkdirSync(candidate);
      return true;
    } catch (cause) {
      if (isAlreadyExistsError(cause)) return false;
      throw cause;
    }
  });
  const dir = join(base, report.runId);
  assertNoSymlinkPath(dir, "report output");
  const reportPath = join(dir, "report.json");
  assertNoSymlinkPath(reportPath, "report output");
  // A second exclusive guard prevents overwriting evidence if anything else
  // creates a report file inside our freshly reserved directory.
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
  });
  if (out === undefined) ensureEvalGitignored(projectRoot);
  return dir;
}

function isAlreadyExistsError(cause: unknown): boolean {
  return (
    cause instanceof Error && (cause as NodeJS.ErrnoException).code === "EEXIST"
  );
}

function ensureEvalGitignored(projectRoot: string): void {
  const gitignore = join(projectRoot, ".atlante", ".gitignore");
  assertNoSymlinkPath(gitignore, "eval gitignore");
  const existing = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  if (existing.split("\n").some((line) => line.trim() === "eval/")) return;
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignore, `${existing}${separator}eval/\n`);
}

/** Refuses to read or write through a symlinked report path component. */
function assertNoSymlinkPath(target: string, label: string): void {
  const missing: string[] = [];
  let current = resolve(target);
  while (true) {
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat !== undefined) {
      if (stat.isSymbolicLink())
        throw new Error(`${label} path traverses a symbolic link: ${current}`);
      break;
    }
    const parent = dirname(current);
    if (parent === current) break;
    missing.unshift(basename(current));
    current = parent;
  }
  for (const segment of missing) {
    current = join(current, segment);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink())
      throw new Error(`${label} path traverses a symbolic link: ${current}`);
  }
}

function formatMs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Shared `(<duration> · <$cost> · <tokens>)` detail; absent parts are omitted. */
function formatTrialDetail(trial: {
  durationMs: number;
  tokens?: number;
  cost?: number;
}): string {
  const usage = [
    trial.cost !== undefined ? `$${trial.cost.toFixed(4)}` : undefined,
    trial.tokens !== undefined ? `${trial.tokens} tokens` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return [formatMs(trial.durationMs), usage].filter(Boolean).join(" · ");
}

type EvalTrialTally = { passed: number; executed: number };

/**
 * Turns each `EvalProgress` event into one human-readable stderr line.
 * Stateful across a run so the scenario-end line can report passed/executed
 * counts consistent with the report's `passRate` (`skipped-budget` trials
 * excluded, like `scenarioStatistics`).
 */
function createProgressRenderer(): (progress: EvalProgress) => string {
  const tallies = new Map<string, EvalTrialTally>();
  return (progress: EvalProgress) => {
    switch (progress.kind) {
      case "scenario-start":
        tallies.set(progress.scenario, { passed: 0, executed: 0 });
        return `== ${progress.scenario}`;
      case "trial-start":
        return `trial ${progress.trial} running...`;
      case "trial-end": {
        const tally = tallies.get(progress.scenario) ?? {
          passed: 0,
          executed: 0,
        };
        if (progress.verdict !== "skipped-budget") tally.executed += 1;
        if (progress.verdict === "pass") tally.passed += 1;
        tallies.set(progress.scenario, tally);
        const detail = formatTrialDetail(progress);
        return `trial ${progress.trial}: ${progress.verdict}${detail ? ` (${detail})` : ""}`;
      }
      case "scenario-end": {
        const tally = tallies.get(progress.scenario) ?? {
          passed: 0,
          executed: 0,
        };
        return tally.executed === 0
          ? `${progress.scenario}: no trials executed`
          : `${progress.scenario}: ${tally.passed}/${tally.executed} trials passed`;
      }
    }
  };
}

/**
 * Grays progress lines on an interactive stderr so live output does not read
 * like an error; piped stderr and `NO_COLOR` get plain text.
 */
export function createProgressStyler(
  stream: { isTTY?: boolean } = process.stderr,
  env: NodeJS.ProcessEnv = process.env,
): (line: string) => string {
  return createStyler(stream, env).dim;
}

/**
 * End-of-run recap on stdout. Per-trial verdicts already streamed live to
 * stderr, so the summary repeats only what the logs do not carry: run id,
 * host identity, warnings, per-scenario aggregate statistics, and the report
 * location.
 */
function printSummary(report: RunReport, reportDir: string): void {
  const styler = createStyler();
  console.log(`eval ${report.runId}`);
  console.log(
    `host ${report.meta.host} · model ${report.meta.model ?? "host default"}`,
  );
  const hasUnmonitored = hasUnmonitoredBudget(report);
  if (hasUnmonitored) {
    console.log(budgetWarning(styler));
  }
  for (const [name, result] of Object.entries(report.scenarios)) {
    console.log("");
    console.log(
      `${name}: pass ${Math.round(result.passRate * 100)}% · mean ${formatMs(result.meanDurationMs)} · p95 ${formatMs(result.spread.durationP95Ms)}`,
    );
  }
  console.log("");
  console.log(
    `${styler.success("report")} ${styler.dim(diagnosticPath(join(reportDir, "report.json")))}`,
  );
}
