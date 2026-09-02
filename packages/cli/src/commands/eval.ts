import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject, type ProjectContext } from "@atlante/builder";
import {
  createOpenCodeRunner,
  type HostRunner,
  type RunReport,
  resolveBudget,
  runEval,
  runExitCode,
  verifyArtifacts,
} from "@atlante/eval";
import { discoverEvalScenarios, error, hasErrors } from "@atlante/validator";
import packageJson from "../../package.json" with { type: "json" };
import { firstPartyProjectContext } from "../first-party-pack.js";
import { diagnosticPath, printDiagnostics } from "../report.js";

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
 * Runs eval scenarios against the project's verified artifacts. `atlante eval`
 * never builds: artifacts must already be published and verified, missing or
 * stale ones are a validation failure with `atlante build` as the recovery
 * action. Exit codes: 0 all trials pass, 1 any trial failed or was skipped,
 * 2 validation errors, 3 a run-preventing infrastructure error.
 */
export async function runEvalCommand(
  target: string,
  options: EvalCommandOptions = {},
  context: ProjectContext = firstPartyProjectContext(),
  runner?: HostRunner,
): Promise<number> {
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

  const filters = options.scenario ?? [];
  const scenarios = filterScenarios(discovery.scenarios, filters);
  if (scenarios === null) return 2;

  try {
    verifyArtifacts(loaded.projectRoot);
  } catch (cause) {
    printDiagnostics([
      error(
        "artifacts-not-verified",
        cause instanceof Error ? cause.message : String(cause),
        {
          source: diagnosticPath(join(loaded.projectRoot, ".atlante")),
          expected: "a verified artifact publication",
          next: "run `atlante build` and try again",
        },
      ),
    ]);
    return 2;
  }

  const host =
    runner ?? createOpenCodeRunner({ projectRoot: loaded.projectRoot });
  let report: RunReport;
  try {
    report = await runEval({
      projectRoot: loaded.projectRoot,
      evalConfig,
      budget: resolveBudget({ evalConfig, trialsOverride }),
      scenarios,
      atlanteVersion: packageJson.version,
      ...(options.keep ? { keep: true } : {}),
      runner: host,
    });
  } catch (cause) {
    // Failures inside trials are verdicts; an exception out of the loop
    // itself means the run could not proceed at all.
    printDiagnostics([
      error("eval-run-failed", "the eval run could not be executed", {
        source: diagnosticPath(loaded.configPath ?? target),
        cause: cause instanceof Error ? cause.message : String(cause),
        next: "re-run with `--keep` and inspect the preserved sandboxes if the cause is unclear",
      }),
    ]);
    return 3;
  }

  const reportDir = publishReport(loaded.projectRoot, report, options.out);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report, reportDir);
  }
  return runExitCode(report);
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
  if (!Number.isInteger(value) || value < 1) {
    printDiagnostics([
      error(
        "invalid-trials",
        `--trials must be a positive integer, got ${raw}`,
        {
          expected: "a positive integer",
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
 * `.atlante/.gitignore` (created or appended, never rewritten).
 */
function publishReport(
  projectRoot: string,
  report: RunReport,
  out: string | undefined,
): string {
  const base = out ?? join(projectRoot, ".atlante", "eval");
  const dir = join(base, report.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  if (out === undefined) ensureEvalGitignored(projectRoot);
  return dir;
}

function ensureEvalGitignored(projectRoot: string): void {
  const gitignore = join(projectRoot, ".atlante", ".gitignore");
  const existing = existsSync(gitignore) ? readFileSync(gitignore, "utf8") : "";
  if (existing.split("\n").some((line) => line.trim() === "eval/")) return;
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(gitignore, `${existing}${separator}eval/\n`);
}

function formatMs(ms: number): string {
  return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function printSummary(report: RunReport, reportDir: string): void {
  console.log(`eval ${report.runId}`);
  console.log(
    `host ${report.meta.host} · model ${report.meta.model ?? "host default"}`,
  );
  for (const [name, result] of Object.entries(report.scenarios)) {
    console.log("");
    console.log(
      `${name}: pass ${Math.round(result.passRate * 100)}% · mean ${formatMs(result.meanDurationMs)} · p95 ${formatMs(result.spread.durationP95Ms)}`,
    );
    for (const trial of result.trials) {
      const usage = [
        trial.cost !== undefined ? `$${trial.cost.toFixed(4)}` : undefined,
        trial.tokens !== undefined ? `${trial.tokens} tokens` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
      const detail = [formatMs(trial.durationMs), usage]
        .filter(Boolean)
        .join(" · ");
      console.log(
        `  trial ${trial.i}: ${trial.verdict}${detail ? ` (${detail})` : ""}`,
      );
      for (const check of trial.checks ?? []) {
        if (check.verdict !== "pass") {
          console.log(
            `    check ${check.index} (${check.type}): ${check.verdict}`,
          );
        }
      }
    }
  }
  console.log("");
  console.log(`report ${diagnosticPath(join(reportDir, "report.json"))}`);
}
