import { describe, expect, test } from "vitest";
import {
  desiredWatchPaths,
  recoveryWatchPaths,
} from "../src/commands/build-watch-reconcile.js";

function paths(...values: string[]): Set<string> {
  return new Set(values);
}

describe("watch reconciliation recovery", () => {
  test("accumulates inputs across consecutive failed builds", () => {
    const previousRecovery = paths("stable", "recovery-a");
    const current = paths("recovery-b");

    expect(desiredWatchPaths(current, previousRecovery, false)).toEqual(
      paths("stable", "recovery-a", "recovery-b"),
    );
    expect(recoveryWatchPaths(current, previousRecovery, false)).toEqual(
      paths("stable", "recovery-a", "recovery-b"),
    );
  });

  test("resets recovery to current paths after a resource-successful build", () => {
    const current = paths("current");

    expect(desiredWatchPaths(current, paths("older"), true)).toEqual(current);
    expect(recoveryWatchPaths(current, paths("older"), true)).toEqual(current);
  });

  test("keeps a missing-resource recovery parent until resolution succeeds", () => {
    const successful = paths("config");
    const unresolvedParent = "/project/resources";
    const failed = paths("config", unresolvedParent);
    const recovered = paths(
      "config",
      "/project/resources/missing/instance.jsonc",
    );

    const recovery = recoveryWatchPaths(failed, successful, false);
    expect(recovery).toEqual(paths("config", unresolvedParent));
    expect(desiredWatchPaths(recovered, recovery, true)).toEqual(recovered);
    expect(recoveryWatchPaths(recovered, recovery, true)).toEqual(recovered);
  });
});
