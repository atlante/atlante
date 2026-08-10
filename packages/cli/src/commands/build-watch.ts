import {
  lstatSync,
  realpathSync,
  statSync,
  unwatchFile,
  watchFile,
} from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { type BuildOutcome, runBuildWithContext } from "./build.js";
import { resolveWatchFiles, type WatchFiles } from "./build-watch-inputs.js";
import {
  applyWatchChanges,
  desiredWatchPaths,
  recoveryWatchPaths,
  successfulWatchPaths,
  watchChanges,
} from "./build-watch-reconcile.js";

export type WatchCallback = () => void;

export type BuildWatchDeps = {
  build?: (target: string) => number | BuildOutcome;
  watch?: (path: string, callback: WatchCallback) => void;
  unwatch?: (path: string, callback: WatchCallback) => void;
  debounceMs?: number;
  onStop?: () => void;
};

export type BuildWatchHandle = {
  readonly exited: Promise<number>;
  stop(): Promise<void>;
};

const POLL_INTERVAL_MS = 100;
const DEFAULT_DEBOUNCE_MS = 150;

const defaultDeps: Required<BuildWatchDeps> = {
  build: runBuildWithContext,
  watch: (path, callback) => {
    let exists = statSync(path, { throwIfNoEntry: false }) !== undefined;
    watchFile(path, { interval: POLL_INTERVAL_MS }, (current) => {
      const currentExists = current.nlink > 0;
      if (!exists && !currentExists) return;
      exists = currentExists;
      callback();
    });
  },
  unwatch: (path) => {
    unwatchFile(path);
  },
  debounceMs: DEFAULT_DEBOUNCE_MS,
  onStop: () => {},
};

function canonicalIdentity(path: string): string {
  let current = path;
  const suffix: string[] = [];
  while (true) {
    try {
      return [...[realpathSync(current)], ...suffix].join(sep);
    } catch {
      const parent = dirname(current);
      if (parent === current) return path;
      suffix.unshift(basename(current));
      current = parent;
    }
  }
}

function watchPathsOf(files: WatchFiles): string[] {
  const paths = [
    ...(files.configPath ? [files.configPath] : []),
    ...(files.configCandidates ?? []),
    ...files.resourcePaths,
    ...files.unresolvedParents,
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    let identity = canonicalIdentity(path);
    try {
      if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
        identity = `symlink:${resolve(path)}`;
    } catch {
      // Keep the canonical identity for a path that disappears during setup.
    }
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(path);
  }
  return result;
}

function codeOf(outcome: number | BuildOutcome): number {
  return typeof outcome === "number" ? outcome : outcome.code;
}

function contextOf(
  outcome: number | BuildOutcome,
): BuildOutcome["resourceWatch"] {
  return typeof outcome === "number" ? undefined : outcome.resourceWatch;
}

export function runBuildWatchWithDependencies(
  target: string,
  dependencies: BuildWatchDeps = {},
): BuildWatchHandle {
  const deps: Required<BuildWatchDeps> = { ...defaultDeps, ...dependencies };

  const watched = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let building = false;
  let pending = false;
  let stopped = false;
  let successfulPaths = new Set<string>();
  let recoveryPaths = new Set<string>();
  let lastFiles: WatchFiles | undefined;
  let resolveExited: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  const onChange = (): void => {
    if (stopped) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      runRebuild();
    }, deps.debounceMs);
  };

  function reconcile(files: WatchFiles, succeeded: boolean): void {
    if (stopped) return;
    const current = new Set(watchPathsOf(files));
    const desired = desiredWatchPaths(
      current,
      successfulPaths,
      recoveryPaths,
      succeeded,
      files.resourceResolutionSucceeded,
    );
    successfulPaths = successfulWatchPaths(
      current,
      successfulPaths,
      succeeded,
      files.resourceResolutionSucceeded,
    );
    recoveryPaths = recoveryWatchPaths(
      current,
      successfulPaths,
      recoveryPaths,
      succeeded,
      files.resourceResolutionSucceeded,
    );
    applyWatchChanges(
      watchChanges(watched, desired),
      watched,
      (path) => deps.watch(path, onChange),
      (path) => deps.unwatch(path, onChange),
    );
  }

  function runRebuild(): void {
    if (stopped) return;
    if (building) {
      pending = true;
      return;
    }
    building = true;
    let outcome: number | BuildOutcome = 1;
    let succeeded = false;
    try {
      outcome = deps.build(target);
      succeeded = codeOf(outcome) === 0;
    } catch (cause) {
      console.error(
        `error: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }

    try {
      const files = resolveWatchFiles(target, contextOf(outcome));
      lastFiles = files;
      reconcile(files, succeeded);
    } catch (cause) {
      console.error(
        `error: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      if (lastFiles) reconcile(lastFiles, false);
    } finally {
      building = false;
      if (pending) {
        pending = false;
        runRebuild();
      }
    }
  }

  async function stop(): Promise<void> {
    if (stopped) return;
    stopped = true;
    if (debounceTimer !== undefined) {
      clearTimeout(debounceTimer);
      debounceTimer = undefined;
    }
    for (const path of watched) deps.unwatch(path, onChange);
    watched.clear();
    deps.onStop();
    resolveExited(0);
  }

  runRebuild();

  return { exited, stop };
}

/** Watch mode does not propagate build failures to the exit code: the process
 * keeps polling, prints failures to stderr, and exits 0 when stopped. */
export function runBuildWatch(target: string): Promise<number> {
  let handle: BuildWatchHandle;
  process.once("SIGINT", () => {
    void handle.stop().then(() => process.exit(0));
  });
  handle = runBuildWatchWithDependencies(target);
  return handle.exited;
}
