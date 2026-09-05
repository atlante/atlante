import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
import {
  failResource,
  normalizeResourcePaths,
  ResourceResolutionError,
} from "./errors.js";
import { isWithin } from "./resource-paths.js";
import {
  candidateContext,
  type ResolvedResourceTarget,
  type ResourceFailureContext,
  type ResourceFile,
  type ResourceFileName,
  targetContext,
  targetResolutionDependencies,
  withPackTrust,
} from "./resource-targets.js";
import {
  candidateWatchPaths,
  symlinkTraversal,
  symlinkWatchPaths,
} from "./symlink-watch.js";
import type { RawResourceLocator } from "./types.js";

function fileContext(
  target: ResolvedResourceTarget,
  file: ResourceFile,
): ResourceFailureContext {
  return withPackTrust(target.pack, {
    dependencies: targetResolutionDependencies(
      target.pack,
      target.resolutionDependencies,
      [file.path, ...file.watchPaths],
    ),
    unresolvedParents: [target.directory],
  });
}

function unsafeRead(
  locator: RawResourceLocator,
  target?: ResolvedResourceTarget,
  file?: ResourceFile,
): never {
  const context =
    file && target
      ? fileContext(target, file)
      : target
        ? targetContext(target)
        : undefined;
  return failResource(
    "unsafe-path",
    "resource file changed outside the resource root",
    { locator },
    context,
  );
}

function missingFile(
  target: ResolvedResourceTarget,
  locator: RawResourceLocator,
  name: ResourceFileName,
): never {
  const candidate = join(target.lexicalDirectory, name);
  const context = candidateContext(
    target.pack,
    candidate,
    target.resolutionDependencies,
  );
  return failResource(
    "missing-target",
    "resource facet file is unavailable",
    { locator },
    withPackTrust(target.pack, {
      dependencies: targetResolutionDependencies(
        target.pack,
        target.resolutionDependencies,
        [target.directory, ...context.dependencies],
      ),
      unresolvedParents: normalizeResourcePaths([
        target.directory,
        ...context.unresolvedParents,
      ]),
    }),
  );
}

/** Checks one exact facet filename with lstat before any read or open. */
export function inspectResourceFile(
  target: ResolvedResourceTarget,
  name: ResourceFileName,
  locator: RawResourceLocator = target.locator,
): ResourceFile | undefined {
  assertStableTarget(target, locator);
  const candidate = join(target.lexicalDirectory, name);
  if (symlinkTraversal(target.pack, candidate).escaped) {
    return failResource(
      "unsafe-path",
      "resource file changed outside the resource root",
      { locator },
      candidateContext(target.pack, candidate, target.resolutionDependencies),
    );
  }
  let candidateStat: ReturnType<typeof lstatSync>;
  try {
    candidateStat = lstatSync(candidate);
  } catch {
    return undefined;
  }

  let canonical: string;
  try {
    canonical = realpathSync(candidate);
  } catch {
    return missingFile(target, locator, name);
  }
  if (!isWithin(target.pack.root, canonical)) {
    return failResource(
      "unsafe-path",
      "resource file changed outside the resource root",
      { locator },
      candidateContext(target.pack, candidate, target.resolutionDependencies),
    );
  }

  let targetStat: ReturnType<typeof lstatSync>;
  try {
    targetStat = lstatSync(canonical);
  } catch {
    return missingFile(target, locator, name);
  }
  if (!targetStat.isFile() || candidateStat.isFIFO()) {
    return failResource(
      "wrong-target-type",
      "resource facet is not a regular file",
      {
        locator,
      },
      withPackTrust(target.pack, {
        dependencies: targetResolutionDependencies(
          target.pack,
          target.resolutionDependencies,
          [target.directory, ...candidateWatchPaths(target.pack, candidate)],
        ),
        unresolvedParents: [target.directory],
      }),
    );
  }
  return Object.freeze({
    path: canonical,
    lexicalPath: candidate,
    watchPaths: Object.freeze([...symlinkWatchPaths(target.pack, candidate)]),
    name,
  });
}

function assertStableTarget(
  target: ResolvedResourceTarget,
  locator: RawResourceLocator,
): void {
  if (symlinkTraversal(target.pack, target.lexicalDirectory).escaped) {
    unsafeRead(locator, target);
  }
  let canonical: string;
  try {
    canonical = realpathSync(target.lexicalDirectory);
  } catch {
    unsafeRead(locator, target);
  }
  if (
    canonical !== target.directory ||
    !isWithin(target.pack.root, canonical)
  ) {
    unsafeRead(locator, target);
  }
  try {
    if (!lstatSync(target.directory).isDirectory()) unsafeRead(locator, target);
  } catch {
    unsafeRead(locator, target);
  }
}

function assertStableFile(
  target: ResolvedResourceTarget,
  file: ResourceFile,
  locator: RawResourceLocator,
): void {
  if (symlinkTraversal(target.pack, file.lexicalPath).escaped) {
    unsafeRead(locator, target, file);
  }
  let canonical: string;
  try {
    canonical = realpathSync(file.lexicalPath);
  } catch {
    unsafeRead(locator, target, file);
  }
  if (canonical !== file.path || !isWithin(target.pack.root, canonical)) {
    unsafeRead(locator, target, file);
  }
  let isRegularFile: boolean;
  try {
    isRegularFile = lstatSync(file.path).isFile();
  } catch {
    unsafeRead(locator, target, file);
  }
  if (!isRegularFile) {
    failResource(
      "wrong-target-type",
      "resource facet is not a regular file",
      { locator },
      fileContext(target, file),
    );
  }
}

function readFlags(): number {
  const fsConstants = constants as typeof constants & {
    readonly O_NOFOLLOW?: number;
    readonly O_NONBLOCK?: number;
  };
  return (
    fsConstants.O_RDONLY |
    (fsConstants.O_NOFOLLOW ?? 0) |
    (fsConstants.O_NONBLOCK ?? 0)
  );
}

function openAndReadResourceFile(
  target: ResolvedResourceTarget,
  file: ResourceFile,
  locator: RawResourceLocator,
  beforeRead?: (path: string) => void,
): Uint8Array {
  let fd: number | undefined;
  try {
    beforeRead?.(file.path);
    fd = openSync(file.path, readFlags());
    if (!fstatSync(fd).isFile()) {
      return failResource(
        "wrong-target-type",
        "resource facet is not a regular file",
        {
          locator,
        },
        fileContext(target, file),
      );
    }
    return readFileSync(fd);
  } catch {
    assertStableTarget(target, locator);
    let observed: string | undefined;
    try {
      observed = realpathSync(file.path);
    } catch {
      // The path disappeared during the read attempt.
    }
    if (observed && !isWithin(target.pack.root, observed)) {
      return unsafeRead(locator, target, file);
    }
    return failResource(
      "wrong-target-type",
      "resource facet could not be read",
      {
        locator,
      },
      fileContext(target, file),
    );
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The read result is already determined.
      }
    }
  }
}

function assertStableRead(
  target: ResolvedResourceTarget,
  file: ResourceFile,
  locator: RawResourceLocator,
): void {
  if (symlinkTraversal(target.pack, file.lexicalPath).escaped) {
    unsafeRead(locator, target, file);
  }
  let afterFile: string;
  try {
    afterFile = realpathSync(file.lexicalPath);
  } catch {
    unsafeRead(locator, target, file);
  }
  if (afterFile !== file.path || !isWithin(target.pack.root, afterFile)) {
    unsafeRead(locator, target, file);
  }
  assertStableTarget(target, locator);
}

/**
 * Reads the canonical file, not the authored symlink path. The final
 * realpath/lstat checks reject changes observed after the read. Node/Bun do
 * not expose a portable openat-style descriptor walk, so a concurrent swap
 * after the last check is not a privilege boundary; this layer makes no
 * stronger claim than those race checks support.
 */
export function readResourceFile(
  target: ResolvedResourceTarget,
  file: ResourceFile,
  locator: RawResourceLocator = target.locator,
  beforeRead?: (path: string) => void,
): string {
  assertStableTarget(target, locator);
  assertStableFile(target, file, locator);
  const bytes = openAndReadResourceFile(target, file, locator, beforeRead);
  assertStableRead(target, file, locator);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failResource(
      "invalid-resolved-input",
      "resource facet is not valid UTF-8",
      {
        locator,
      },
      fileContext(target, file),
    );
  }
}

export function isResourceResolutionError(
  error: unknown,
): error is ResourceResolutionError {
  return error instanceof ResourceResolutionError;
}
