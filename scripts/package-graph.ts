import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// bun.lock is machine-generated JSONC (trailing commas); normalize them and
// parse strictly. A malformed strip fails loudly instead of silently letting
// stale lockfile bookkeeping strand into a release commit.
interface Lockfile {
  workspaces?: Record<
    string,
    { version?: string; dependencies?: Record<string, string> }
  >;
}

/** An exact-pinned dependency declared outside the package graph. */
export interface LockPin {
  /** Manifest path relative to the repository root, e.g. website/package.json. */
  manifest: string;
  dependency: string;
}

export interface LockSyncInput {
  packages: readonly string[];
  pins?: readonly LockPin[];
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function readLockfile(root: string): Lockfile {
  return JSON.parse(
    readFileSync(join(root, "bun.lock"), "utf8").replace(/,(\s*[}\]])/g, "$1"),
  ) as Lockfile;
}

function defaultRoot(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..");
}

/**
 * Compare bun.lock against the manifests on disk and return one
 * human-readable description per stale entry: workspace versions that
 * drifted from their packages/<name>/package.json and exact pins that
 * drifted from the manifest declaring them. An empty result means the
 * lock is in sync.
 */
export function lockSyncIssues(
  { packages, pins = [] }: LockSyncInput,
  root: string = defaultRoot(),
): string[] {
  const lock = readLockfile(root);
  const issues: string[] = [];

  for (const name of packages) {
    const workspace = `packages/${name}`;
    const manifest = `${workspace}/package.json`;
    const declared = readJson(join(root, manifest)).version;
    const locked = lock.workspaces?.[workspace]?.version;
    if (locked !== declared)
      issues.push(
        `${workspace} has version ${locked ?? "<missing>"} in bun.lock but ${manifest} declares ${declared ?? "<missing>"}`,
      );
  }

  for (const { manifest, dependency } of pins) {
    const workspace = dirname(manifest);
    const dependencies = readJson(join(root, manifest)).dependencies as
      | Record<string, unknown>
      | undefined;
    const declared = dependencies?.[dependency];
    const locked = lock.workspaces?.[workspace]?.dependencies?.[dependency];
    if (locked !== declared)
      issues.push(
        `${workspace} pins ${dependency} to ${locked ?? "<missing>"} in bun.lock but ${manifest} declares ${declared ?? "<missing>"}`,
      );
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Lock repair
// ---------------------------------------------------------------------------

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Index of the workspace stanza opener line, or -1. */
function stanzaStart(lines: string[], workspace: string): number {
  return lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith(`"${workspace}":`) && trimmed.endsWith("{");
  });
}

/**
 * Overwrite the value of the entry addressed by keys — ["version"] for a
 * stanza's direct child, ["dependencies", "@atlante/cli"] for a pin —
 * preserving the line's formatting. Returns false when the stanza or any
 * key along the path is absent; the caller's post-patch lockSyncIssues()
 * run reports such residue so the release can fail loudly.
 */
function setStanzaValue(
  lines: string[],
  workspace: string,
  keys: readonly string[],
  value: string,
): boolean {
  let start = stanzaStart(lines, workspace);
  if (start === -1) return false;

  for (const [depth, key] of keys.entries()) {
    const base = indentOf(lines[start]);
    const last = depth === keys.length - 1;
    let matched = false;
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (trimmed === "") continue;
      if (indentOf(line) <= base) return false; // left the block
      // The lockfile indents direct children exactly two spaces deeper; this
      // keeps a same-named key nested further down (e.g. inside engines)
      // from being rewritten in place of an absent direct child.
      if (indentOf(line) !== base + 2) continue;
      if (!trimmed.startsWith(`"${key}": `)) continue;
      if (!last) {
        if (trimmed !== `"${key}": {`) continue;
        start = i;
      } else {
        lines[i] = line.replace(/: ".*?"/, `: "${value}"`);
      }
      matched = true;
      break;
    }
    if (!matched) return false;
  }
  return true;
}

/**
 * Rewrite the workspace versions and exact pins recorded in bun.lock so
 * they match the manifests on disk. bun 1.3.x treats manifest-version drift
 * as a no-op and may leave the lock untouched (oven-sh/bun#28411, #28935),
 * so the release flow syncs the lock directly after `bun install` instead
 * of trusting the install to do it. Only lines inside the affected
 * workspaces stanzas are rewritten; anything that cannot be repaired (a
 * missing stanza or key) is left in place and reported by the returned
 * lockSyncIssues() run, which the release script fails on.
 */
export function syncLockToManifests(
  { packages, pins = [] }: LockSyncInput,
  root: string = defaultRoot(),
): { synced: number; remaining: string[] } {
  if (lockSyncIssues({ packages, pins }, root).length === 0)
    return { synced: 0, remaining: [] };

  const lockPath = join(root, "bun.lock");
  const lines = readFileSync(lockPath, "utf8").split("\n");
  let synced = 0;

  for (const name of packages) {
    const declared = readJson(
      join(root, `packages/${name}/package.json`),
    ).version;
    if (
      typeof declared === "string" &&
      setStanzaValue(lines, `packages/${name}`, ["version"], declared)
    )
      synced++;
  }

  for (const { manifest, dependency } of pins) {
    const dependencies = readJson(join(root, manifest)).dependencies as
      | Record<string, unknown>
      | undefined;
    const declared = dependencies?.[dependency];
    if (
      typeof declared === "string" &&
      setStanzaValue(
        lines,
        dirname(manifest),
        ["dependencies", dependency],
        declared,
      )
    )
      synced++;
  }

  if (synced > 0) writeFileSync(lockPath, lines.join("\n"));

  return { synced, remaining: lockSyncIssues({ packages, pins }, root) };
}
