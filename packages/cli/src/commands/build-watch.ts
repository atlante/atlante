import { unwatchFile, watchFile } from "node:fs";
import { runBuild } from "./build.js";
import { resolveWatchFiles, type WatchFiles } from "./build-watch-inputs.js";

export type WatchCallback = (event: unknown, filename?: string) => void;

export type BuildWatchDeps = {
  build?: (target: string) => number;
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
  build: runBuild,
  watch: (path, callback) => {
    watchFile(path, { interval: POLL_INTERVAL_MS }, () => callback(undefined));
  },
  unwatch: (path) => {
    unwatchFile(path);
  },
  debounceMs: DEFAULT_DEBOUNCE_MS,
  onStop: () => {},
};

function watchPathsOf(files: WatchFiles): string[] {
  return [
    ...(files.configPath ? [files.configPath] : []),
    ...(files.configCandidates ?? []),
    ...files.presetPaths,
    ...files.templatePaths,
  ];
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
  let resolveExited: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExited = resolve;
  });

  const onChange = (_event: unknown, _filename?: string): void => {
    if (stopped) return;
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      runRebuild();
    }, deps.debounceMs);
  };

  function reconcile(files: WatchFiles): void {
    if (stopped) return;
    const desired = new Set(watchPathsOf(files));
    for (const path of watched) {
      if (!desired.has(path)) {
        deps.unwatch(path, onChange);
        watched.delete(path);
      }
    }
    for (const path of desired) {
      if (!watched.has(path)) {
        deps.watch(path, onChange);
        watched.add(path);
      }
    }
  }

  function runRebuild(): void {
    if (stopped) return;
    if (building) {
      pending = true;
      return;
    }
    building = true;
    try {
      deps.build(target);
      reconcile(resolveWatchFiles(target));
    } catch (cause) {
      console.error(
        `error: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
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

export function runBuildWatch(target: string): Promise<number> {
  let handle: BuildWatchHandle;
  process.once("SIGINT", () => {
    void handle.stop().then(() => process.exit(0));
  });
  handle = runBuildWatchWithDependencies(target);
  return handle.exited;
}
