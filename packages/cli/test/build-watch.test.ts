import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

function canonical(path: string): string {
  return realpathSync(path, "utf8");
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
    callback?.();

    await waitFor(() => builds === 2, "rebuild after change");
    expect(builds).toBe(2);
    await handle.stop();
  });

  test("stopping one handle does not remove another handle's listener", async () => {
    const dir = tempProject(valid);
    let firstBuilds = 0;
    let secondBuilds = 0;
    const first = runBuildWatchWithDependencies(dir, {
      build: () => {
        firstBuilds += 1;
        return 0;
      },
      debounceMs: 20,
    });
    const second = runBuildWatchWithDependencies(dir, {
      build: () => {
        secondBuilds += 1;
        return 0;
      },
      debounceMs: 20,
    });

    try {
      expect(firstBuilds).toBe(1);
      expect(secondBuilds).toBe(1);
      await first.stop();

      writeFileSync(join(dir, "atlante.jsonc"), `${valid}\n`);
      await waitFor(
        () => secondBuilds === 2,
        "rebuild on the remaining handle",
      );
    } finally {
      await second.stop();
    }
  });

  test("rebuilds once after a missing local resource is created", async () => {
    const dir = tempProject(`{
      "$schema": "${SCHEMA_URI}",
      "agents": { "local": "./resources/instance" }
    }`);
    const resources = join(dir, "resources");
    const template = join(resources, "template");
    const instance = join(resources, "instance");
    mkdirSync(template, { recursive: true });
    writeFileSync(
      join(template, "template.jsonc"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { value: { type: "string" } },
      }),
    );
    writeFileSync(join(template, "template.md"), "{{value}}\n");

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
    expect(watcher.callbacks.has(canonical(resources))).toBe(true);

    mkdirSync(instance);
    writeFileSync(
      join(instance, "instance.jsonc"),
      JSON.stringify({
        $template: "../template",
        description: "Created",
        value: "created",
      }),
    );
    watcher.callbacks.get(canonical(resources))?.();

    await waitFor(() => builds === 2, "rebuild after resource creation");
    await Bun.sleep(50);
    expect(builds).toBe(2);
    expect(
      watcher.callbacks.has(canonical(join(instance, "instance.jsonc"))),
    ).toBe(true);
    await handle.stop();
  });

  test("reconciles a retargeted resource symlink and drops the stale target", async () => {
    const dir = tempProject(`{
      "$schema": "${SCHEMA_URI}",
      "agents": { "local": "./link" }
    }`);
    const first = join(dir, "first");
    const second = join(dir, "second");
    for (const [directory, value] of [
      [first, "first"],
      [second, "second"],
    ] as const) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, "template.jsonc"),
        JSON.stringify({
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { value: { type: "string" } },
        }),
      );
      writeFileSync(join(directory, "template.md"), "{{value}}\n");
      writeFileSync(
        join(directory, "instance.jsonc"),
        JSON.stringify({ $template: "./", description: value, value }),
      );
    }
    const link = join(dir, "link");
    symlinkSync(first, link);

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

    expect(
      watcher.callbacks.has(canonical(join(first, "instance.jsonc"))),
    ).toBe(true);
    expect(watcher.callbacks.has(link)).toBe(true);

    unlinkSync(link);
    symlinkSync(second, link);
    watcher.callbacks.get(link)?.();

    await waitFor(() => builds === 2, "rebuild after symlink retarget");
    expect(
      watcher.callbacks.has(canonical(join(second, "instance.jsonc"))),
    ).toBe(true);
    expect(
      watcher.callbacks.has(canonical(join(first, "instance.jsonc"))),
    ).toBe(false);
    await handle.stop();
  });

  test("preserves successful resource watches through an invalid resource recovery", async () => {
    const dir = tempProject(`{
      "$schema": "${SCHEMA_URI}",
      "agents": { "local": { "$template": "./template", "description": "Local", "value": "value" } }
    }`);
    const template = join(dir, "template");
    mkdirSync(template);
    const schemaPath = join(template, "template.jsonc");
    const markdownPath = join(template, "template.md");
    const schema = JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { value: { type: "string" } },
    });
    writeFileSync(schemaPath, schema);
    writeFileSync(markdownPath, "{{value}}\n");

    const watcher = fakeWatcher();
    let builds = 0;
    const handle = runBuildWatchWithDependencies(dir, {
      build: (target) => {
        builds += 1;
        return runBuild(target);
      },
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 20,
    });
    const manifestPath = join(dir, ".atlante", "artifacts", "manifest.json");
    const before = readFileSync(manifestPath, "utf8");

    writeFileSync(schemaPath, "{ malformed");
    watcher.callbacks.get(canonical(schemaPath))?.();
    await waitFor(() => builds === 2, "rebuild after invalid resource change");
    expect(readFileSync(manifestPath, "utf8")).toBe(before);
    expect(watcher.callbacks.has(canonical(markdownPath))).toBe(true);

    writeFileSync(schemaPath, schema);
    watcher.callbacks.get(canonical(schemaPath))?.();
    await waitFor(() => builds === 3, "rebuild after resource recovery");
    await Bun.sleep(50);
    expect(builds).toBe(3);
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

      watcher.callbacks.get(join(dir, "atlante.jsonc"))?.();

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
    for (let i = 0; i < 5; i += 1) callback?.();

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
    callback?.();
    await waitFor(() => builds === 2, "first rebuild");
    expect(watcher.callbacks.size).toBeGreaterThan(0);

    await handle.stop();
    expect(watcher.callbacks.size).toBe(0);
    expect(stopped).toBe(1);
    expect(await handle.exited).toBe(0);

    callback?.();
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
    callback?.();

    await waitFor(() => builds === 2, "rebuild after first failure");
    await handle.stop();
  });

  test("accumulates recovery inputs across consecutive failed rebuilds", async () => {
    const dir = tempProject(valid);
    const stable = join(dir, "stable.jsonc");
    const recoveryA = join(dir, "recovery-a.jsonc");
    const recoveryB = join(dir, "recovery-b.jsonc");
    for (const path of [stable, recoveryA, recoveryB])
      writeFileSync(path, "{}");

    const watcher = fakeWatcher();
    let builds = 0;
    const outcomes = [
      {
        code: 0,
        resourceWatch: { dependencies: [stable], unresolvedParents: [] },
      },
      {
        code: 1,
        resourceWatch: { dependencies: [recoveryA], unresolvedParents: [] },
      },
      {
        code: 1,
        resourceWatch: { dependencies: [recoveryB], unresolvedParents: [] },
      },
      {
        code: 0,
        resourceWatch: {
          dependencies: [recoveryA, recoveryB],
          unresolvedParents: [],
        },
      },
    ] as const;
    const handle = runBuildWatchWithDependencies(dir, {
      build: () => outcomes[builds++] ?? outcomes[0],
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 20,
    });

    expect(builds).toBe(1);
    watcher.callbacks.get(stable)?.();
    await waitFor(() => builds === 2, "rebuild with recovery input A");
    expect(watcher.callbacks.has(recoveryA)).toBe(true);

    watcher.callbacks.get(stable)?.();
    await waitFor(() => builds === 3, "rebuild with recovery input B");
    expect(watcher.callbacks.has(recoveryA)).toBe(true);
    expect(watcher.callbacks.has(recoveryB)).toBe(true);

    writeFileSync(recoveryA, "repaired");
    writeFileSync(recoveryB, "repaired");
    watcher.callbacks.get(recoveryA)?.();
    watcher.callbacks.get(recoveryB)?.();
    await waitFor(
      () => builds === 4,
      "one rebuild after both recovery inputs repair",
    );
    await Bun.sleep(60);
    expect(builds).toBe(4);
    await handle.stop();
  });

  test("recovers a local preset after its alternate root file causes ambiguity", async () => {
    const dir = tempProject(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "./base"
    }`);
    const base = join(dir, "base");
    const selected = join(base, "atlante.jsonc");
    const alternate = join(base, "atlante.json");
    mkdirSync(base);
    writeFileSync(selected, '{"values": {"base": "yes"}}\n');
    const watcher = fakeWatcher();
    const messages: string[] = [];
    let builds = 0;
    const handle = runBuildWatchWithDependencies(dir, {
      build: (target) => {
        const originalError = console.error;
        console.error = (...args: unknown[]) => messages.push(args.join(" "));
        try {
          builds += 1;
          return runBuild(target);
        } finally {
          console.error = originalError;
        }
      },
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 20,
    });

    expect(builds).toBe(1);
    expect(watcher.callbacks.has(canonical(selected))).toBe(true);
    expect(watcher.callbacks.has(alternate)).toBe(true);

    writeFileSync(alternate, '{"values": {"alternate": "yes"}}\n');
    watcher.callbacks.get(alternate)?.();
    await waitFor(() => builds === 2, "rebuild after local preset ambiguity");
    expect(
      messages.some((message) => message.includes("ambiguous-facet")),
    ).toBe(true);

    rmSync(alternate);
    watcher.callbacks.get(alternate)?.();
    await waitFor(() => builds === 3, "rebuild after local preset recovery");
    await Bun.sleep(60);
    expect(builds).toBe(3);
    await handle.stop();
  });

  test("recovers a root config after its alternate filename causes ambiguity", async () => {
    const dir = tempProject(valid);
    const configPath = join(dir, "atlante.jsonc");
    const alternate = join(dir, "atlante.json");
    const watcher = fakeWatcher();
    const messages: string[] = [];
    let builds = 0;
    const handle = runBuildWatchWithDependencies(dir, {
      build: (target) => {
        const originalError = console.error;
        console.error = (...args: unknown[]) => messages.push(args.join(" "));
        try {
          builds += 1;
          return runBuild(target);
        } finally {
          console.error = originalError;
        }
      },
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      debounceMs: 20,
    });

    expect(builds).toBe(1);
    expect(watcher.callbacks.has(configPath)).toBe(true);
    expect(watcher.callbacks.has(alternate)).toBe(true);

    writeFileSync(alternate, valid);
    watcher.callbacks.get(alternate)?.();
    await waitFor(() => builds === 2, "rebuild after root config ambiguity");
    expect(
      messages.some((message) => message.includes("ambiguous-config")),
    ).toBe(true);

    rmSync(alternate);
    watcher.callbacks.get(alternate)?.();
    await waitFor(() => builds === 3, "rebuild after root config recovery");
    await Bun.sleep(60);
    expect(builds).toBe(3);
    await handle.stop();
  });

  test("deleting the config retains the old watch set and watches candidates", async () => {
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
    expect(watcher.callbacks.has(alternateCandidate)).toBe(true);

    rmSync(configPath);
    watcher.callbacks.get(configPath)?.();

    await waitFor(() => builds === 2, "rebuild after config deletion");
    expect(watcher.callbacks.has(configPath)).toBe(true);
    expect(watcher.callbacks.has(alternateCandidate)).toBe(true);
    await handle.stop();
  });

  test("creating the config keeps candidate watches alongside the config path", async () => {
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
    watcher.callbacks.get(staleCandidate)?.();

    await waitFor(() => builds === 2, "rebuild after config creation");
    expect(watcher.callbacks.has(configPath)).toBe(true);
    expect(watcher.callbacks.has(staleCandidate)).toBe(true);
    await handle.stop();
  });
});

describe("runBuildWatch", () => {
  test("SIGINT stops the watcher and the process exits 0", async () => {
    const dir = tempProject(valid);
    const binPath = fileURLToPath(
      new URL("../bin/atlante.ts", import.meta.url),
    );

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
