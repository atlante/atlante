import {
  lstatSync,
  realpathSync,
  type Stats,
  statSync,
  unwatchFile,
  watchFile,
} from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import type { ProjectContext } from "@atlante/builder";
import { firstPartyProjectContext } from "../first-party-pack.js";
import { diagnosticPath, printDiagnostic } from "../report.js";
import { type BuildOutcome, runBuildWithContext } from "./build.js";
import { resolveWatchFiles, type WatchFiles } from "./build-watch-inputs.js";
import {
  applyWatchChanges,
  desiredWatchPaths,
  recoveryWatchPaths,
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
type WatchListener = (current: Stats) => void;
const registeredWatchers = new WeakMap<
  WatchCallback,
  Map<string, WatchListener>
>();

const defaultDeps: Required<BuildWatchDeps> = {
  build: runBuildWithContext,
  watch: (path, callback) => {
    let exists = statSync(path, { throwIfNoEntry: false }) !== undefined;
    const listener: WatchListener = (current) => {
      const currentExists = current.nlink > 0;
      if (!exists && !currentExists) return;
      exists = currentExists;
      callback();
    };
    const listeners = registeredWatchers.get(callback) ?? new Map();
    const previous = listeners.get(path);
    if (previous) unwatchFile(path, previous);
    listeners.set(path, listener);
    registeredWatchers.set(callback, listeners);
    watchFile(path, { interval: POLL_INTERVAL_MS }, listener);
  },
  unwatch: (path, callback) => {
    const listeners = registeredWatchers.get(callback);
    const listener = listeners?.get(path);
    if (!listener) return;
    unwatchFile(path, listener);
    listeners?.delete(path);
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

function normalizeBuildOutcome(outcome: number | BuildOutcome): BuildOutcome {
  return typeof outcome === "number" ? { code: outcome } : outcome;
}

export function runBuildWatchWithDependencies(
  target: string,
  dependencies: BuildWatchDeps = {},
  context: ProjectContext = firstPartyProjectContext(),
): BuildWatchHandle {
  const deps: Required<BuildWatchDeps> = {
    ...defaultDeps,
    ...dependencies,
    build:
      dependencies.build ??
      ((path: string) => runBuildWithContext(path, context)),
  };

  const watched = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let building = false;
  let pending = false;
  let stopped = false;
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
    const fullySucceeded = succeeded && files.resourceResolutionSucceeded;
    const desired = desiredWatchPaths(current, recoveryPaths, fullySucceeded);
    recoveryPaths = recoveryWatchPaths(current, recoveryPaths, fullySucceeded);
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
    let outcome: BuildOutcome = { code: 1 };
    let succeeded = false;
    try {
      outcome = normalizeBuildOutcome(deps.build(target));
      succeeded = outcome.code === 0;
    } catch (cause) {
      printDiagnostic({
        severity: "error",
        code: "watch-build-failed",
        message: "watch rebuild failed",
        source: diagnosticPath(target),
        next: "fix the reported error; watch mode will retry on changes",
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }

    try {
      const files = resolveWatchFiles(target, outcome.resourceWatch, context);
      lastFiles = files;
      reconcile(files, succeeded);
    } catch (cause) {
      printDiagnostic({
        severity: "error",
        code: "watch-inputs-failed",
        message: "could not update watched files",
        source: diagnosticPath(target),
        next: "fix the reported error; watch mode will retry on changes",
        cause: cause instanceof Error ? cause.message : String(cause),
      });
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
