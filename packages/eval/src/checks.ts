import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalCheck } from "@atlante/schema";
import type { Sandbox } from "./sandbox.js";
import { pickAllowedEnv, runCommand } from "./spawn.js";
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

type SafePath = { absolute: string } | { unsafe: string };

/**
 * Resolves a check path without traversing a symlink created by the host.
 * Lexical schema validation protects authored paths; this walk protects the
 * same path after the host has modified the sandbox tree.
 */
function noFollowPath(sandbox: Sandbox, path: string): SafePath {
  try {
    let current = sandbox.root;
    const rootStat = lstatSync(current, { throwIfNoEntry: false });
    if (rootStat?.isSymbolicLink()) {
      return { unsafe: "sandbox root is a symbolic link" };
    }
    for (const segment of path.split(/[\\/]+/)) {
      if (segment === "" || segment === ".") continue;
      current = join(current, segment);
      const stat = lstatSync(current, { throwIfNoEntry: false });
      if (stat?.isSymbolicLink()) {
        return { unsafe: `path traverses a symbolic link at ${segment}` };
      }
    }
    return { absolute: current };
  } catch (cause) {
    return {
      unsafe: `could not inspect sandbox path: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
}

function filesystemError(path: string, cause: unknown): RawCheckResult {
  return errorVerdict({
    path,
    cause: cause instanceof Error ? cause.message : String(cause),
  });
}

async function commandCheck(
  sandbox: Sandbox,
  check: Extract<EvalCheck, { type: "command" }>,
): Promise<RawCheckResult> {
  const outcome = await runCommand(check.run, {
    cwd: sandbox.root,
    timeoutMs: check.timeoutMs,
    env: pickAllowedEnv(process.env),
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
  // A timeout is a failed check even if the terminated process reports a
  // clean exit after receiving SIGTERM.
  if (outcome.timedOut) return fail(evidence);
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
  const safe = noFollowPath(sandbox, path);
  if ("unsafe" in safe) return errorVerdict({ path, cause: safe.unsafe });
  try {
    const exists =
      lstatSync(safe.absolute, { throwIfNoEntry: false }) !== undefined;
    return exists === expectExists
      ? PASS
      : fail({ path, exists, expectExists });
  } catch (cause) {
    return filesystemError(path, cause);
  }
}

function fileContainsCheck(
  sandbox: Sandbox,
  check: Extract<EvalCheck, { type: "file-contains" }>,
): RawCheckResult {
  const safe = noFollowPath(sandbox, check.path);
  if ("unsafe" in safe) {
    return errorVerdict({ path: check.path, cause: safe.unsafe });
  }
  const absolute = safe.absolute;
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(absolute, { throwIfNoEntry: false });
  } catch (cause) {
    return filesystemError(check.path, cause);
  }
  if (!stat?.isFile()) return fail({ path: check.path, exists: Boolean(stat) });
  let content: string;
  try {
    content = readFileSync(absolute, "utf8");
  } catch (cause) {
    return filesystemError(check.path, cause);
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
  const safe = noFollowPath(sandbox, path);
  if ("unsafe" in safe) return errorVerdict({ path, cause: safe.unsafe });
  const baseline = sandbox.snapshot.find((entry) => entry.path === path);
  if (!baseline) {
    // Snapshot capture is part of assembly; a missing entry is infra-level.
    return errorVerdict({ path, cause: "no baseline snapshot entry" });
  }
  try {
    const current = lstatSync(safe.absolute, {
      throwIfNoEntry: false,
    })?.isFile()
      ? createHash("sha256").update(readFileSync(safe.absolute)).digest("hex")
      : null;
    return current === baseline.hash
      ? PASS
      : fail({
          path,
          baselineHash: baseline.hash,
          currentHash: current,
        });
  } catch (cause) {
    return filesystemError(path, cause);
  }
}

async function diffAllowlistCheck(
  sandbox: Sandbox,
  allow: readonly string[],
): Promise<RawCheckResult> {
  const outcome = await runCommand(
    [
      "git",
      "-c",
      "core.fsmonitor=false",
      // Literal paths: default quoting C-escapes non-ASCII/special names,
      // which would false-fail the allowlist and corrupt report evidence.
      "-c",
      "core.quotePath=false",
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignored=matching",
    ],
    {
      cwd: sandbox.root,
      timeoutMs: 60_000,
      env: pickAllowedEnv(process.env),
    },
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
