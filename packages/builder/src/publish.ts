import type { Stats } from "node:fs";
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { isArtifactPayloadPath } from "./artifact-names.js";
import type {
  ArtifactManifest,
  ArtifactPayload,
  CreatedArtifacts,
} from "./artifacts-internal.js";

export type PublishOperation =
  | "create-stage"
  | "ensure-metadata"
  | "create-directory"
  | "write-payload"
  | "write-manifest"
  | "sync-file"
  | "sync-directory"
  | "rename-backup"
  | "rename-stage"
  | "restore-backup"
  | "cleanup-stage"
  | "cleanup-backup";

export type PublishDependencies = {
  /** A test seam for failures at each filesystem boundary. */
  fault?: (operation: PublishOperation, path: string) => void;
};

export type PublishedArtifacts = {
  artifactsPath: string;
  manifest: ArtifactManifest;
  warnings: ArtifactPublicationWarning[];
};

export type ArtifactPublicationWarning = {
  code: "post-publication-sync-failed" | "backup-cleanup-failed";
  path: string;
  message: string;
  cause: unknown;
};

type ArtifactPublicationRecoverability =
  | "no-previous-tree"
  | "restored"
  | "backup-preserved";

class ArtifactPublicationError extends Error {
  readonly publicationCause: unknown;
  readonly cleanupErrors: unknown[];
  readonly backupPath?: string;
  readonly recoverability: ArtifactPublicationRecoverability;
  readonly restoreError?: unknown;

  constructor(
    message: string,
    publicationCause: unknown,
    cleanupErrors: unknown[] = [],
    context: {
      backupPath?: string;
      recoverability: ArtifactPublicationRecoverability;
      restoreError?: unknown;
    } = { recoverability: "no-previous-tree" },
  ) {
    super(message, { cause: publicationCause });
    this.name = "ArtifactPublicationError";
    this.publicationCause = publicationCause;
    this.cleanupErrors = cleanupErrors;
    this.backupPath = context.backupPath;
    this.recoverability = context.recoverability;
    this.restoreError = context.restoreError;
  }
}

class ArtifactCleanupError extends Error {
  constructor(
    message: string,
    override readonly cause: unknown,
  ) {
    super(message, { cause });
    this.name = "ArtifactCleanupError";
  }
}

function operation(
  dependencies: PublishDependencies,
  name: PublishOperation,
  path: string,
): void {
  dependencies.fault?.(name, path);
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isMissing(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "ENOENT"
  );
}

function isUnsupportedDirectorySync(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause.code === "EINVAL" ||
      cause.code === "ENOTSUP" ||
      cause.code === "EISDIR")
  );
}

function syncFile(path: string, dependencies: PublishDependencies): void {
  operation(dependencies, "sync-file", path);
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncDirectory(path: string, dependencies: PublishDependencies): void {
  operation(dependencies, "sync-directory", path);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch (cause) {
    if (!isUnsupportedDirectorySync(cause)) throw cause;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function removeDirectory(
  path: string,
  operationName: "cleanup-stage" | "cleanup-backup",
  dependencies: PublishDependencies,
): void {
  try {
    operation(dependencies, operationName, path);
    rmSync(path, { recursive: true });
  } catch (cause) {
    if (!isMissing(cause)) {
      throw new ArtifactCleanupError(
        `unable to clean up artifact directory: ${path}: ${errorMessage(cause)}`,
        cause,
      );
    }
  }
}

function ensureMetadataDirectory(
  path: string,
  dependencies: PublishDependencies,
): void {
  operation(dependencies, "ensure-metadata", path);
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch (cause) {
    if (!isMissing(cause)) throw cause;
    mkdirSync(path);
    return;
  }

  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`.atlante must be a real directory: ${path}`);
  }
}

function safeRelativePayloadPath(path: string): string[] {
  const parts = path.split("/");
  if (!isArtifactPayloadPath(path)) {
    throw new Error(`unsafe artifact payload path: ${path}`);
  }
  return parts;
}

function writePayload(
  stagePath: string,
  payload: ArtifactPayload,
  dependencies: PublishDependencies,
): void {
  const parts = safeRelativePayloadPath(payload.path);
  const path = join(stagePath, ...parts);
  operation(dependencies, "write-payload", path);
  writeFileSync(path, payload.bytes, { flag: "wx" });
  syncFile(path, dependencies);
}

function writeManifest(
  stagePath: string,
  manifest: ArtifactManifest,
  dependencies: PublishDependencies,
): void {
  const path = join(stagePath, "manifest.json");
  operation(dependencies, "write-manifest", path);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  syncFile(path, dependencies);
}

function existingLiveDirectory(path: string): boolean {
  try {
    const stats = lstatSync(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(
        `artifact publication target is not a real directory: ${path}`,
      );
    }
    return true;
  } catch (cause) {
    if (isMissing(cause)) return false;
    throw cause;
  }
}

function formatPublicationError(
  cause: unknown,
  cleanupErrors: readonly unknown[],
  recoverability: ArtifactPublicationRecoverability,
  backupPath: string | undefined,
  restoreError: unknown,
): string {
  const message = `artifact publication failed: ${errorMessage(cause)}`;
  const cleanup =
    cleanupErrors.length === 0
      ? ""
      : `; cleanup failed: ${cleanupErrors.map(errorMessage).join("; ")}`;
  if (recoverability === "backup-preserved" && backupPath) {
    return `${message}${cleanup}; previous artifact tree preserved at ${backupPath}; restore failed: ${errorMessage(restoreError)}`;
  }
  return `${message}${cleanup}`;
}

function cleanupCause(cause: unknown): unknown {
  return cause instanceof ArtifactCleanupError && cause.cause !== undefined
    ? cause.cause
    : cause;
}

function finishPublication(
  metadataPath: string,
  backupPath: string | undefined,
  dependencies: PublishDependencies,
): { backupPath?: string; warnings: ArtifactPublicationWarning[] } {
  const warnings: ArtifactPublicationWarning[] = [];
  try {
    syncDirectory(metadataPath, dependencies);
  } catch (syncCause) {
    warnings.push({
      code: "post-publication-sync-failed",
      path: metadataPath,
      message: `unable to sync published artifact directory: ${errorMessage(syncCause)}`,
      cause: syncCause,
    });
  }

  if (backupPath) {
    const previousBackupPath = backupPath;
    try {
      removeDirectory(previousBackupPath, "cleanup-backup", dependencies);
      backupPath = undefined;
    } catch (cleanupFailure) {
      warnings.push({
        code: "backup-cleanup-failed",
        path: previousBackupPath,
        message: `unable to clean up previous artifact directory: ${errorMessage(cleanupFailure)}`,
        cause: cleanupFailure,
      });
    }
  }

  try {
    syncDirectory(metadataPath, dependencies);
  } catch (syncCause) {
    warnings.push({
      code: "post-publication-sync-failed",
      path: metadataPath,
      message: `unable to sync artifact directory after cleanup: ${errorMessage(syncCause)}`,
      cause: syncCause,
    });
  }
  return { backupPath, warnings };
}

type PublicationState = {
  stagePath?: string;
  backupPath?: string;
  oldMoved: boolean;
  newLive: boolean;
  recoverability: ArtifactPublicationRecoverability;
  restoreError?: unknown;
};

function stageArtifacts(
  metadataPath: string,
  created: CreatedArtifacts,
  state: PublicationState,
  dependencies: PublishDependencies,
): string {
  ensureMetadataDirectory(metadataPath, dependencies);
  operation(dependencies, "create-stage", metadataPath);
  state.stagePath = mkdtempSync(join(metadataPath, ".artifacts.stage-"));
  operation(dependencies, "create-directory", state.stagePath);
  mkdirSync(join(state.stagePath, "agents"));
  mkdirSync(join(state.stagePath, "skills"));

  for (const payload of created.payloads) {
    writePayload(state.stagePath, payload, dependencies);
  }
  syncDirectory(join(state.stagePath, "agents"), dependencies);
  syncDirectory(join(state.stagePath, "skills"), dependencies);
  writeManifest(state.stagePath, created.manifest, dependencies);
  syncDirectory(state.stagePath, dependencies);
  return state.stagePath;
}

function replaceLiveTree(
  artifactsPath: string,
  state: PublicationState,
  dependencies: PublishDependencies,
): void {
  if (existingLiveDirectory(artifactsPath)) {
    state.backupPath = `${state.stagePath}.backup`;
    operation(dependencies, "rename-backup", artifactsPath);
    renameSync(artifactsPath, state.backupPath);
    state.oldMoved = true;
  }

  operation(dependencies, "rename-stage", state.stagePath as string);
  renameSync(state.stagePath as string, artifactsPath);
  state.stagePath = undefined;
  state.newLive = true;
}

function restorePreviousTree(
  artifactsPath: string,
  state: PublicationState,
  dependencies: PublishDependencies,
  cleanupErrors: unknown[],
): void {
  if (!state.oldMoved || state.newLive || !state.backupPath) return;
  try {
    operation(dependencies, "restore-backup", state.backupPath);
    renameSync(state.backupPath, artifactsPath);
    state.backupPath = undefined;
    state.oldMoved = false;
    state.recoverability = "restored";
  } catch (restoreCause) {
    state.restoreError = cleanupCause(restoreCause);
    cleanupErrors.push(state.restoreError);
    state.recoverability = "backup-preserved";
  }
}

function cleanupStagedTree(
  state: PublicationState,
  dependencies: PublishDependencies,
  cleanupErrors: unknown[],
): void {
  if (!state.stagePath) return;
  try {
    removeDirectory(state.stagePath, "cleanup-stage", dependencies);
    state.stagePath = undefined;
  } catch (cleanupFailure) {
    cleanupErrors.push(cleanupCause(cleanupFailure));
  }
}

function cleanupBackupTree(
  state: PublicationState,
  dependencies: PublishDependencies,
  cleanupErrors: unknown[],
): void {
  if (!state.backupPath || state.recoverability === "backup-preserved") return;
  try {
    removeDirectory(state.backupPath, "cleanup-backup", dependencies);
    state.backupPath = undefined;
  } catch (cleanupFailure) {
    cleanupErrors.push(cleanupCause(cleanupFailure));
  }
}

function failPublication(
  cause: unknown,
  artifactsPath: string,
  state: PublicationState,
  dependencies: PublishDependencies,
): never {
  const cleanupErrors: unknown[] =
    cause instanceof ArtifactCleanupError && cause.cause !== undefined
      ? [cleanupCause(cause)]
      : [];

  restorePreviousTree(artifactsPath, state, dependencies, cleanupErrors);
  cleanupStagedTree(state, dependencies, cleanupErrors);
  cleanupBackupTree(state, dependencies, cleanupErrors);

  throw new ArtifactPublicationError(
    formatPublicationError(
      cause,
      cleanupErrors,
      state.recoverability,
      state.backupPath,
      state.restoreError,
    ),
    cause,
    cleanupErrors,
    {
      backupPath: state.backupPath,
      recoverability: state.recoverability,
      restoreError: state.restoreError,
    },
  );
}

/**
 * Publish a complete artifact tree. The live directory is only changed after
 * every staged payload and the manifest have been flushed.
 */
export function publishArtifacts(
  projectRoot: string,
  created: CreatedArtifacts,
  dependencies: PublishDependencies = {},
): PublishedArtifacts {
  const metadataPath = join(projectRoot, ".atlante");
  const artifactsPath = join(metadataPath, "artifacts");
  const state: PublicationState = {
    oldMoved: false,
    newLive: false,
    recoverability: "no-previous-tree",
  };
  try {
    stageArtifacts(metadataPath, created, state, dependencies);
    replaceLiveTree(artifactsPath, state, dependencies);
    const finished = finishPublication(
      metadataPath,
      state.backupPath,
      dependencies,
    );
    state.backupPath = finished.backupPath;
    return {
      artifactsPath,
      manifest: created.manifest,
      warnings: finished.warnings,
    };
  } catch (cause) {
    failPublication(cause, artifactsPath, state, dependencies);
  }
}
