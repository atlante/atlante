import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EvalCheck } from "@atlante/schema";
import type { Sandbox } from "./sandbox.js";
import { runCommand } from "./spawn.js";
import type { CheckResult, CheckType, CheckVerdict } from "./types.js";

/** Evidence output is capped so reports stay readable. */
const OUTPUT_EVIDENCE_LIMIT = 2_000;

/** A check outcome before it receives its report position. */
type RawCheckResult = {
  verdict: CheckVerdict;
  evidence: Record<string, unknown>;
};

const PASS: RawCheckResult = Object.freeze({
  verdict: "pass" as const,
  evidence: {},
});

function fail(evidence: Record<string, unknown>): RawCheckResult {
  return { verdict: "fail", evidence };
}

function errorVerdict(evidence: Record<string, unknown>): RawCheckResult {
  return { verdict: "error", evidence };
}

function outputTail(text: string): string {
  return text.length > OUTPUT_EVIDENCE_LIMIT
    ? text.slice(-OUTPUT_EVIDENCE_LIMIT)
    : text;
}

async function commandCheck(
  sandbox: Sandbox,
  check: Extract<EvalCheck, { type: "command" }>,
): Promise<RawCheckResult> {
  const outcome = await runCommand(check.run, {
    cwd: sandbox.root,
    timeoutMs: check.timeoutMs,
  });
  if (outcome.spawnError !== undefined) {
    return errorVerdict({
      run: check.run,
      cause: outcome.spawnError,
    });
  }
  const combined = `${outcome.stdout}\n${outcome.stderr}`;
  const evidence: Record<string, unknown> = {
    run: check.run,
    exit: outcome.exit,
    expectExit: check.expectExit,
    ...(outcome.timedOut ? { timedOut: true } : {}),
    output: outputTail(combined.trim()),
  };
  if (outcome.exit !== check.expectExit) return fail(evidence);
  if (check.outputMatches !== undefined) {
    const matched = new RegExp(check.outputMatches).test(combined);
    evidence.outputMatches = check.outputMatches;
    if (!matched) return fail(evidence);
  }
  return { verdict: "pass", evidence };
}

function fileExistsCheck(
  sandbox: Sandbox,
  path: string,
  expectExists: boolean,
): RawCheckResult {
  const exists = existsSync(join(sandbox.root, path));
  return exists === expectExists ? PASS : fail({ path, exists, expectExists });
}

function fileContainsCheck(
  sandbox: Sandbox,
  check: Extract<EvalCheck, { type: "file-contains" }>,
): RawCheckResult {
  const absolute = join(sandbox.root, check.path);
  const stat = statSync(absolute, { throwIfNoEntry: false });
  if (!stat?.isFile()) return fail({ path: check.path, exists: Boolean(stat) });
  let content: string;
  try {
    content = readFileSync(absolute, "utf8");
  } catch (cause) {
    return errorVerdict({
      path: check.path,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (check.regex) {
    let regex: RegExp;
    try {
      regex = new RegExp(check.pattern);
    } catch {
      // Schema validation compiles opt-in regexes; stay fail-closed anyway.
      return errorVerdict({
        path: check.path,
        cause: "invalid regular expression",
      });
    }
    return regex.test(content)
      ? PASS
      : fail({ path: check.path, pattern: check.pattern, regex: true });
  }
  return content.includes(check.pattern)
    ? PASS
    : fail({ path: check.path, pattern: check.pattern });
}

function fileUnchangedCheck(sandbox: Sandbox, path: string): RawCheckResult {
  const absolute = join(sandbox.root, path);
  const baseline = sandbox.snapshot.find((entry) => entry.path === path);
  if (!baseline) {
    // Snapshot capture is part of assembly; a missing entry is infra-level.
    return errorVerdict({ path, cause: "no baseline snapshot entry" });
  }
  const current = statSync(absolute, { throwIfNoEntry: false })?.isFile()
    ? createHash("sha256").update(readFileSync(absolute)).digest("hex")
    : null;
  return current === baseline.hash
    ? PASS
    : fail({
        path,
        baselineHash: baseline.hash,
        currentHash: current,
      });
}

async function diffAllowlistCheck(
  sandbox: Sandbox,
  allow: readonly string[],
): Promise<RawCheckResult> {
  const outcome = await runCommand(
    ["git", "status", "--porcelain", "--untracked-files=all"],
    { cwd: sandbox.root, timeoutMs: 60_000 },
  );
  if (outcome.exit !== 0 || outcome.spawnError !== undefined) {
    return errorVerdict({
      cause: outcome.spawnError ?? `git status exited ${outcome.exit}`,
      stderr: outputTail(outcome.stderr),
    });
  }
  const changed = parsePorcelainPaths(outcome.stdout);
  const allowSet = new Set(allow);
  const unexpected = changed.filter((path) => !allowSet.has(path));
  return unexpected.length === 0
    ? PASS
    : fail({ allow: [...allowSet], unexpected, changed });
}

/**
 * Parses `git status --porcelain` v1 output into project-relative paths.
 * Rename entries contribute both the old and the new path.
 */
export function parsePorcelainPaths(stdout: string): string[] {
  const paths: string[] = [];
  for (const line of stdout.split("\n")) {
    if (line.length < 4) continue;
    const body = line.slice(3);
    const arrow = body.indexOf(" -> ");
    if (arrow >= 0) {
      paths.push(body.slice(0, arrow), body.slice(arrow + 4));
    } else {
      paths.push(body);
    }
  }
  return paths;
}

/**
 * Runs every check against the sandbox state and returns complete evidence:
 * all checks run even after one fails, so the report always carries the full
 * picture. The trial verdict is the AND of all check verdicts.
 */
export async function runChecks(
  sandbox: Sandbox,
  checks: readonly EvalCheck[],
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const [index, check] of checks.entries()) {
    let result: RawCheckResult;
    switch (check.type) {
      case "command":
        result = await commandCheck(sandbox, check);
        break;
      case "file-exists":
      case "file-absent":
        result = fileExistsCheck(
          sandbox,
          check.path,
          check.type === "file-exists",
        );
        break;
      case "file-contains":
        result = fileContainsCheck(sandbox, check);
        break;
      case "file-unchanged":
        result = fileUnchangedCheck(sandbox, check.path);
        break;
      case "diff-allowlist":
        result = await diffAllowlistCheck(sandbox, check.allow);
        break;
    }
    results.push({
      index,
      type: check.type as CheckType,
      verdict: result.verdict,
      evidence: result.evidence,
    });
  }
  return results;
}
