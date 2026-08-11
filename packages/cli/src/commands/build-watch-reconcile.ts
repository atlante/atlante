export type WatchChanges = Readonly<{
  readonly remove: readonly string[];
  readonly add: readonly string[];
}>;

export function desiredWatchPaths(
  current: ReadonlySet<string>,
  recovery: ReadonlySet<string>,
  fullySucceeded: boolean,
): Set<string> {
  return fullySucceeded ? new Set(current) : new Set([...recovery, ...current]);
}

export function recoveryWatchPaths(
  current: ReadonlySet<string>,
  previous: ReadonlySet<string>,
  fullySucceeded: boolean,
): Set<string> {
  return fullySucceeded ? new Set(current) : new Set([...previous, ...current]);
}

export function watchChanges(
  watched: ReadonlySet<string>,
  desired: ReadonlySet<string>,
): WatchChanges {
  return {
    remove: [...watched].filter((path) => !desired.has(path)),
    add: [...desired].filter((path) => !watched.has(path)),
  };
}

export function applyWatchChanges(
  changes: WatchChanges,
  watched: Set<string>,
  watch: (path: string) => void,
  unwatch: (path: string) => void,
): void {
  for (const path of changes.remove) {
    unwatch(path);
    watched.delete(path);
  }
  for (const path of changes.add) {
    watch(path);
    watched.add(path);
  }
}
