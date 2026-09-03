import type { Sandbox } from "./sandbox.js";
import { type CommandOutcome, pickAllowedEnv, runCommand } from "./spawn.js";

const SANDBOX_GIT_TIMEOUT_MS = 60_000;
const MAX_UPDATE_INDEX_ARG_BYTES = 64 * 1024;

/** Runs Git after a model session with the sandbox's process safeguards. */
export function runSandboxGit(
  sandbox: Sandbox,
  argv: readonly string[],
): Promise<CommandOutcome> {
  return runCommand(
    [
      "git",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.quotePath=false",
      ...argv,
    ],
    {
      cwd: sandbox.root,
      timeoutMs: SANDBOX_GIT_TIMEOUT_MS,
      env: pickAllowedEnv(process.env),
    },
  );
}

/** Parses Git's NUL-delimited path output without decoding or losing bytes. */
export function parseGitNameList(stdout: string): string[] {
  return stdout.split("\0").filter((path) => path.length > 0);
}

/**
 * Clears model-controlled index flags before comparing the worktree. Git can
 * otherwise trust `assume-unchanged` or `skip-worktree` and hide real edits.
 * Returns an error string so callers can fail closed at their own boundary.
 */
export async function clearIndexFlags(
  sandbox: Sandbox,
): Promise<string | undefined> {
  const listed = await runSandboxGit(sandbox, ["ls-files", "-z"]);
  if (listed.spawnError !== undefined || listed.exit !== 0) {
    return gitFailure("ls-files", listed);
  }

  for (const flag of ["--no-assume-unchanged", "--no-skip-worktree"]) {
    for (const paths of pathChunks(parseGitNameList(listed.stdout))) {
      const cleared = await runSandboxGit(sandbox, [
        "update-index",
        flag,
        // Refresh after clearing the flag; otherwise a modified skip-worktree
        // entry can retain its old stat data and remain invisible to diff.
        "--refresh",
        "--really-refresh",
        "--",
        ...paths,
      ]);
      if (
        (cleared.spawnError !== undefined || cleared.exit !== 0) &&
        !isNeedsUpdate(cleared)
      ) {
        return gitFailure("update-index", cleared);
      }
    }
  }
  return undefined;
}

function pathChunks(paths: readonly string[]): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    const pathBytes = Buffer.byteLength(path) + 1;
    if (current.length > 0 && bytes + pathBytes > MAX_UPDATE_INDEX_ARG_BYTES) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(path);
    bytes += pathBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function gitFailure(command: string, outcome: CommandOutcome): string {
  return `git ${command} failed (exit ${outcome.exit}): ${outcome.spawnError ?? outcome.stderr.slice(-400)}`;
}

/** `update-index --refresh` uses exit 1 to report files needing an update. */
function isNeedsUpdate(outcome: CommandOutcome): boolean {
  const lines = outcome.stdout.trim().split("\n");
  return (
    outcome.exit === 1 &&
    outcome.spawnError === undefined &&
    outcome.stderr.length === 0 &&
    lines.length > 0 &&
    lines.every((line) => line.endsWith(": needs update"))
  );
}
