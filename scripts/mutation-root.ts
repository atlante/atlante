import { randomUUID } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

const unsafeRootError =
  "ATLANTE_MUTATION_ROOT must be an absolute path inside os.tmpdir()";
const staleLockMs = 60_000;

function isInside(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation === "" || (!relation.startsWith(`..${sep}`) && relation !== "..")
  );
}

function realpathOfExistingAncestor(path: string): string {
  let current = path;
  while (true) {
    try {
      return realpathSync.native(current);
    } catch {
      const parent = dirname(current);
      if (parent === current) throw new Error(unsafeRootError);
      current = parent;
    }
  }
}

export function resolveMutationRoot(
  configuredRoot: string | undefined,
  _projectRoot: string,
): string {
  if (configuredRoot === undefined) return "mutation";
  if (
    !isAbsolute(configuredRoot) ||
    configuredRoot.split(/[\\/]/).includes("..")
  ) {
    throw new Error(unsafeRootError);
  }

  const tempRoot = realpathSync.native(tmpdir());
  const resolvedRoot = resolve(configuredRoot);
  if (!isInside(resolve(tmpdir()), resolvedRoot))
    throw new Error(unsafeRootError);

  const realRoot = realpathOfExistingAncestor(resolvedRoot);
  if (!isInside(tempRoot, realRoot)) throw new Error(unsafeRootError);
  return resolvedRoot;
}

export function mutationReportPath(
  mutationRoot: string,
  workspace: string,
  name: string,
): string {
  if (
    !["mutation.html", "mutation.json", "incremental.json"].includes(name) &&
    !/^temp-\d+$/.test(name)
  ) {
    throw new Error("mutation report path is not allowed");
  }
  return `${mutationRoot}/${workspace}/${name}`;
}

export function acquireMutationCampaign(
  mutationRoot: string,
  workspace: string,
): () => Promise<void> {
  const mutationRootPath = resolve(mutationRoot);
  const workspaceRoot = resolve(mutationRoot, workspace);
  if (!isInside(mutationRootPath, workspaceRoot)) {
    throw new Error("mutation workspace must stay inside the mutation root");
  }
  const lockPath = resolve(workspaceRoot, ".campaign-lock");
  mkdirSync(workspaceRoot, { recursive: true });

  try {
    publishLock(lockPath, workspaceRoot);
  } catch (error) {
    replaceStaleLock(error, lockPath, workspace);
  }

  const ownedLock = statSync(lockPath);
  cleanupStaleTemps(workspaceRoot);
  return async () => {
    try {
      const currentLock = statSync(lockPath);
      if (
        currentLock.dev === ownedLock.dev &&
        currentLock.ino === ownedLock.ino &&
        readLockOwner(lockPath) === process.pid
      ) {
        rmSync(lockPath, { force: true });
      }
    } catch {
      // The lock was already released or replaced by another campaign.
    }
  };
}

function publishLock(lockPath: string, workspaceRoot: string): void {
  const temporaryPath = resolve(
    workspaceRoot,
    `.campaign-lock-${process.pid}-${randomUUID()}`,
  );
  try {
    writeFileSync(temporaryPath, String(process.pid), { flag: "wx" });
    // The hard link is the no-overwrite publication point. The lock is never
    // visible until its metadata has been completely written.
    linkSync(temporaryPath, lockPath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function replaceStaleLock(
  error: unknown,
  lockPath: string,
  workspace: string,
): void {
  assertLockIsReplaceable(error, lockPath, workspace);
  rmSync(lockPath, { recursive: true, force: true });
  try {
    publishLock(lockPath, dirname(lockPath));
  } catch (retryError) {
    if (
      retryError instanceof Error &&
      "code" in retryError &&
      retryError.code === "EEXIST"
    ) {
      throw new Error(`mutation campaign already active for ${workspace}`);
    }
    throw retryError;
  }
}

function assertLockIsReplaceable(
  error: unknown,
  lockPath: string,
  workspace: string,
): void {
  if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
    throw error;
  }
  const owner = readLockOwner(lockPath);
  if (Number.isInteger(owner) && isProcessAlive(owner)) {
    throw new Error(`mutation campaign already active for ${workspace}`);
  }
  if (!Number.isInteger(owner) && isFreshLock(lockPath)) {
    throw new Error(`mutation campaign already active for ${workspace}`);
  }
}

function readLockOwner(lockPath: string): number {
  try {
    const contents = readFileSync(lockPath, "utf8").trim();
    return /^\d+$/.test(contents) ? Number.parseInt(contents, 10) : Number.NaN;
  } catch {
    // A lock without metadata is stale because ownership is published
    // synchronously immediately after the lock directory is created.
    return Number.NaN;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isFreshLock(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs < staleLockMs;
  } catch {
    return false;
  }
}

function cleanupStaleTemps(workspaceRoot: string): void {
  for (const entry of readdirSync(workspaceRoot)) {
    if (/^temp-\d+$/.test(entry)) {
      const candidate = resolve(workspaceRoot, entry);
      if (isInside(workspaceRoot, candidate)) {
        rmSync(candidate, { recursive: true, force: true });
      }
    }
  }
}
