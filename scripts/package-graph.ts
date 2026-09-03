import { readFileSync } from "node:fs";
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

/**
 * Compare bun.lock against the manifests on disk and return one
 * human-readable description per stale entry: workspace versions that
 * drifted from their packages/<name>/package.json and exact pins that
 * drifted from the manifest declaring them. An empty result means the
 * lock is in sync.
 */
export function lockSyncIssues(
  { packages, pins = [] }: LockSyncInput,
  root: string = join(fileURLToPath(new URL(".", import.meta.url)), ".."),
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
