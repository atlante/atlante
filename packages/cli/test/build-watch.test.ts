import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";
import { runBuild } from "../src/commands/build.js";
import {
  runBuildWatchWithDependencies,
  type WatchCallback,
} from "../src/commands/build-watch.js";

const created: string[] = [];

function tempProject(config?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-build-watch-"));
  created.push(dir);
  if (config !== undefined) writeFileSync(join(dir, "atlante.jsonc"), config);
  return dir;
}

const valid = `{
  "$schema": "${SCHEMA_URI}",
  "values": { "project": "demo" }
}`;

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

async function waitFor(
  check: () => boolean,
  description: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`timed out waiting for ${description}`);
    await Bun.sleep(10);
  }
}

async function withSilencedConsole<T>(run: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

type WatcherFake = {
  watch: (path: string, callback: WatchCallback) => void;
  unwatch: (path: string, callback: WatchCallback) => void;
  callbacks: Map<string, WatchCallback>;
};

function fakeWatcher(): WatcherFake {
  const callbacks = new Map<string, WatchCallback>();
  return {
    watch: (path, callback) => {
      callbacks.set(path, callback);
    },
    unwatch: (path) => {
      callbacks.delete(path);
    },
    callbacks,
  };
}

describe("runBuildWatchWithDependencies", () => {
  test("a change to a watched file triggers a rebuild", async () => {
    const dir = tempProject(valid);
    const watcher = fakeWatcher();
    let builds = 0;

    const handle = runBuildWatchWithDependencies(dir, {
      build: () => {
        builds += 1;
        return 0;
      },
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 20,
    });

    expect(builds).toBe(1);

    const callback = watcher.callbacks.get(join(dir, "atlante.jsonc"));
    expect(callback).toBeDefined();
    callback?.(undefined);

    await waitFor(() => builds === 2, "rebuild after change");
    expect(builds).toBe(2);
    await handle.stop();
  });

  test("an invalid change does not publish", async () => {
    const dir = tempProject(valid);
    await withSilencedConsole(async () => {
      let builds = 0;
      const watcher = fakeWatcher();
      const handle = runBuildWatchWithDependencies(dir, {
        build: (target) => {
          builds += 1;
          return runBuild(target);
        },
        watch: watcher.watch,
        unwatch: watcher.unwatch,
        debounceMs: 40,
      });

      const manifestPath = join(dir, ".atlante", "artifacts", "manifest.json");
      expect(existsSync(manifestPath)).toBe(true);
      const before = readFileSync(manifestPath, "utf8");

      writeFileSync(
        join(dir, "atlante.jsonc"),
        `{
          "$schema": "${SCHEMA_URI}",
          "agents": {
            "broken": { "description": "{{values.missing}}", "identity": "x", "mission": "y" }
          }
        }`,
      );

      watcher.callbacks.get(join(dir, "atlante.jsonc"))?.(undefined);

      await waitFor(() => builds >= 2, "rebuild after invalid change");
      expect(readFileSync(manifestPath, "utf8")).toBe(before);
      await handle.stop();
    });
  });

  test("unrelated file changes are ignored", async () => {
    const dir = tempProject(valid);
    await withSilencedConsole(async () => {
      let builds = 0;
      const handle = runBuildWatchWithDependencies(dir, {
        build: (target) => {
          builds += 1;
          return runBuild(target);
        },
        debounceMs: 20,
      });
      expect(builds).toBe(1);

      writeFileSync(join(dir, "notes.md"), "# notes");
      mkdirSync(join(dir, ".atlante"), { recursive: true });
      writeFileSync(join(dir, ".atlante", "scratch.txt"), "scratch");

      await Bun.sleep(400);
      expect(builds).toBe(1);
      await handle.stop();
    });
  });

  test("a burst of changes debounces to a single rebuild", async () => {
    const dir = tempProject(valid);
    const watcher = fakeWatcher();
    let builds = 0;

    const handle = runBuildWatchWithDependencies(dir, {
      build: () => {
        builds += 1;
        return 0;
      },
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 30,
    });
    expect(builds).toBe(1);

    const callback = watcher.callbacks.get(join(dir, "atlante.jsonc"));
    for (let i = 0; i < 5; i += 1) callback?.(undefined);

    await waitFor(() => builds === 2, "single debounced rebuild");
    await Bun.sleep(80);
    expect(builds).toBe(2);
    await handle.stop();
  });

  test("stop() stops watching and resolves the exit code", async () => {
    const dir = tempProject(valid);
    const watcher = fakeWatcher();
    let builds = 0;
    let stopped = 0;

    const handle = runBuildWatchWithDependencies(dir, {
      build: () => {
        builds += 1;
        return 0;
      },
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 20,
      onStop: () => {
        stopped += 1;
      },
    });

    const callback = watcher.callbacks.get(join(dir, "atlante.jsonc"));
    callback?.(undefined);
    await waitFor(() => builds === 2, "first rebuild");
    expect(watcher.callbacks.size).toBeGreaterThan(0);

    await handle.stop();
    expect(watcher.callbacks.size).toBe(0);
    expect(stopped).toBe(1);
    expect(await handle.exited).toBe(0);

    callback?.(undefined);
    await Bun.sleep(100);
    expect(builds).toBe(2);

    await handle.stop();
    expect(stopped).toBe(1);
  });

  test("keeps watching when the first build fails", async () => {
    const dir = tempProject(valid);
    const watcher = fakeWatcher();
    let builds = 0;

    const handle = runBuildWatchWithDependencies(dir, {
      build: () => {
        builds += 1;
        return 1;
      },
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 20,
    });

    expect(builds).toBe(1);
    expect(watcher.callbacks.size).toBeGreaterThan(0);

    const callback = watcher.callbacks.get(join(dir, "atlante.jsonc"));
    callback?.(undefined);

    await waitFor(() => builds === 2, "rebuild after first failure");
    await handle.stop();
  });

  test("deleting the config drops the old watch set and watches the candidates", async () => {
    const dir = tempProject(valid);
    const watcher = fakeWatcher();
    let builds = 0;

    const handle = runBuildWatchWithDependencies(dir, {
      build: () => {
        builds += 1;
        return 0;
      },
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 20,
    });

    const configPath = join(dir, "atlante.jsonc");
    const alternateCandidate = join(dir, "atlante.json");
    expect(watcher.callbacks.has(configPath)).toBe(true);
    expect(watcher.callbacks.has(alternateCandidate)).toBe(false);

    rmSync(configPath);
    watcher.callbacks.get(configPath)?.(undefined);

    await waitFor(() => builds === 2, "rebuild after config deletion");
    expect(watcher.callbacks.has(configPath)).toBe(true);
    expect(watcher.callbacks.has(alternateCandidate)).toBe(true);
    await handle.stop();
  });

  test("creating the config drops the stale candidates and watches the config path", async () => {
    const dir = tempProject();
    const watcher = fakeWatcher();
    let builds = 0;

    const handle = runBuildWatchWithDependencies(dir, {
      build: () => {
        builds += 1;
        return 0;
      },
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 20,
    });

    const configPath = join(dir, "atlante.jsonc");
    const staleCandidate = join(dir, "atlante.json");
    expect(watcher.callbacks.has(configPath)).toBe(true);
    expect(watcher.callbacks.has(staleCandidate)).toBe(true);

    writeFileSync(configPath, valid);
    watcher.callbacks.get(staleCandidate)?.(undefined);

    await waitFor(() => builds === 2, "rebuild after config creation");
    expect(watcher.callbacks.has(configPath)).toBe(true);
    expect(watcher.callbacks.has(staleCandidate)).toBe(false);
    await handle.stop();
  });
});

describe("runBuildWatch", () => {
  test("SIGINT stops the watcher and the process exits 0", async () => {
    const dir = tempProject(valid);
    const binPath = new URL("../bin/atlante.ts", import.meta.url).pathname;

    const child = Bun.spawn(["bun", binPath, "build", "--watch", dir], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = { text: "" };
    const reader = child.stdout.getReader();
    const decoder = new TextDecoder();
    void (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output.text += decoder.decode(value);
      }
    })();

    try {
      await waitFor(
        () => output.text.includes("built "),
        "initial build output",
        5_000,
      );
    } finally {
      child.kill("SIGINT");
    }

    const code = await child.exited;
    expect(code).toBe(0);
  });
});
