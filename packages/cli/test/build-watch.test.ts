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
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, type ProjectContext } from "@atlante/builder";
import { createPackageResourcePack } from "@atlante/resources";
import { SCHEMA_URI } from "@atlante/schema";
import { runBuild, runBuildWithContext } from "../src/commands/build.js";
import {
  runBuildWatchWithDependencies,
  type WatchCallback,
} from "../src/commands/build-watch.js";
import { runValidate } from "../src/commands/validate.js";

const created: string[] = [];

function tempProject(config?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-build-watch-"));
  created.push(dir);
  if (config !== undefined) writeFileSync(join(dir, "atlante.jsonc"), config);
  return dir;
}

function firstPartyProjectWithoutUserDeclaration(): string {
  const dir = tempProject(`{
    "$schema": "${SCHEMA_URI}",
    "extends": "@atlante/pack"
  }`);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "atlante-build-watch-no-pack-fixture",
      version: "1.0.0",
    })}\n`,
  );
  return dir;
}

function firstPartyContextFixture(): {
  dir: string;
  manifest: string;
  template: string;
  context: ProjectContext;
} {
  const dir = tempProject(`{
    "$schema": "${SCHEMA_URI}",
    "extends": "@atlante/pack",
    "agents": {
      "reviewer": {
        "$template": "@atlante/pack/agent",
        "description": "Review",
        "identity": "Identity"
      }
    }
  }`);
  const packRoot = mkdtempSync(join(tmpdir(), "atlante-first-party-pack-"));
  created.push(packRoot);
  const manifest = join(packRoot, "package.json");
  const templateDirectory = join(packRoot, "agent");
  const template = join(templateDirectory, "template.md");
  mkdirSync(templateDirectory, { recursive: true });
  writeFileSync(
    manifest,
    `${JSON.stringify({
      name: "@atlante/pack",
      version: "1.2.3",
      atlante: { format: 1 },
    })}\n`,
  );
  writeFileSync(
    join(packRoot, "atlante.jsonc"),
    '{ "values": { "pack": "valid" } }\n',
  );
  writeFileSync(
    join(templateDirectory, "template.jsonc"),
    `${JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { identity: { type: "string" } },
      required: ["identity"],
      additionalProperties: false,
    })}\n`,
  );
  writeFileSync(template, "{{identity}}\n");

  return {
    dir,
    manifest,
    template,
    context: {
      firstPartyPack: createPackageResourcePack(packRoot, "@atlante/pack"),
    },
  };
}

function writeExternalPackage(
  root: string,
  version = "1.2.3",
  name = "review-pack",
): { manifest: string; template: string; source: string } {
  const agent = join(root, "agent");
  mkdirSync(agent, { recursive: true });
  const manifest = join(root, "package.json");
  const template = join(agent, "template.jsonc");
  const source = join(agent, "template.md");
  writeFileSync(
    manifest,
    `${JSON.stringify({
      name,
      version,
      atlante: { format: 1 },
    })}\n`,
  );
  writeFileSync(join(root, "atlante.jsonc"), "{}\n");
  writeFileSync(
    template,
    `${JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { identity: { type: "string" } },
      required: ["identity"],
      additionalProperties: false,
    })}\n`,
  );
  writeFileSync(source, "{{identity}}\n");
  return { manifest, template, source };
}

function externalPackageProject(): {
  dir: string;
  packageRoot: string;
  installedPackage: string;
  files: { manifest: string; template: string; source: string };
} {
  const dir = tempProject(`{
    "$schema": "${SCHEMA_URI}",
    "extends": "review-pack",
    "agents": {
      "reviewer": {
        "$template": "review-pack/agent",
        "description": "Review",
        "identity": "Identity"
      }
    }
  }`);
  const workspace = tempProject();
  const packageRoot = join(workspace, "review-pack");
  const installedPackage = join(dir, "node_modules", "review-pack");
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(packageRoot, installedPackage, "dir");
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "atlante-watch-fixture",
      version: "1.0.0",
      dependencies: { "review-pack": "file:workspace" },
    })}\n`,
  );
  return {
    dir,
    packageRoot,
    installedPackage,
    files: writeExternalPackage(packageRoot),
  };
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

function callbackForPath(
  watcher: WatcherFake,
  path: string,
): WatchCallback | undefined {
  const expected = canonical(path);
  return [...watcher.callbacks.entries()].find(([watched]) => {
    try {
      return canonical(watched) === expected;
    } catch {
      return false;
    }
  })?.[1];
}

describe("runBuildWatchWithDependencies", () => {
  test("revalidates a captured first-party pack for every request and recovers facets", async () => {
    const fixture = firstPartyContextFixture();
    const watcher = fakeWatcher();
    const validManifest: Record<string, unknown> = {
      name: "@atlante/pack",
      version: "1.2.3",
      atlante: { format: 1 },
    };
    const invalidManifests: ReadonlyArray<{
      readonly manifest: Record<string, unknown>;
      readonly message: string;
    }> = [
      {
        manifest: { ...validManifest, name: "@atlante/not-pack" },
        message:
          "package metadata must declare the resolved package name and version",
      },
      {
        manifest: { ...validManifest, version: "not-semver" },
        message: "package metadata version must be a strict semver value",
      },
      {
        manifest: {
          name: validManifest.name,
          version: validManifest.version,
        },
        message: "package metadata must declare numeric atlante.format 1",
      },
      {
        manifest: { ...validManifest, atlante: { format: 2 } },
        message:
          "package atlante.format is unsupported; expected numeric format 1",
      },
    ];
    const outcomes: number[] = [];
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));

    const handle = runBuildWatchWithDependencies(
      fixture.dir,
      {
        build: (target) => {
          const outcome = runBuildWithContext(target, fixture.context);
          outcomes.push(outcome.code);
          return outcome;
        },
        watch: watcher.watch,
        unwatch: watcher.unwatch,
        debounceMs: 20,
      },
      fixture.context,
    );

    try {
      expect(outcomes).toEqual([0]);
      const manifestCallback = watcher.callbacks.get(
        realpathSync(fixture.manifest),
      );
      expect(manifestCallback).toBeDefined();

      for (const [index, { manifest, message }] of invalidManifests.entries()) {
        writeFileSync(fixture.manifest, `${JSON.stringify(manifest)}\n`);
        const requestErrors: string[] = [];
        const requestError = console.error;
        console.error = (...args: unknown[]) =>
          requestErrors.push(args.join(" "));
        try {
          expect(await runValidate(fixture.dir, fixture.context)).toBe(1);
          expect(runBuildWithContext(fixture.dir, fixture.context).code).toBe(
            1,
          );
        } finally {
          console.error = requestError;
        }
        expect(requestErrors).toHaveLength(2);
        expect(requestErrors[0]).toBe(requestErrors[1]);
        expect(requestErrors[0]).toContain(message);

        manifestCallback?.();
        await waitFor(
          () => outcomes.length === index + 2,
          "failed watch rebuild",
        );
        expect(outcomes.at(-1)).toBe(1);
      }

      const repairedManifest = { ...validManifest, version: "2.0.0" };
      writeFileSync(fixture.manifest, `${JSON.stringify(repairedManifest)}\n`);
      manifestCallback?.();
      await waitFor(
        () => outcomes.length === invalidManifests.length + 2,
        "watch recovery after package metadata repair",
      );
      expect(outcomes.at(-1)).toBe(0);
      expect(fixture.context.firstPartyPack?.package?.version).toBe("1.2.3");
      const loaded = loadProject(fixture.dir, fixture.context);
      expect({
        kind: loaded.resources?.provenance["/values/pack"]?.kind,
        path: String(loaded.resources?.provenance["/values/pack"]?.path),
      }).toEqual({
        kind: "package",
        path: "@atlante/pack@2.0.0/atlante.jsonc",
      });

      writeFileSync(fixture.template, "Changed {{identity}}\n");
      watcher.callbacks.get(realpathSync(fixture.template))?.();
      await waitFor(
        () => outcomes.length === invalidManifests.length + 3,
        "watch recovery after facet change",
      );
      expect(outcomes.at(-1)).toBe(0);
      expect(errors).toHaveLength(invalidManifests.length);
      for (const [index, { message }] of invalidManifests.entries())
        expect(errors[index]).toContain(message);
    } finally {
      console.error = originalError;
      await handle.stop();
    }
  });

  test("uses the CLI first-party context for fallback watch loading", async () => {
    const dir = firstPartyProjectWithoutUserDeclaration();
    const watcher = fakeWatcher();

    const handle = runBuildWatchWithDependencies(dir, {
      watch: watcher.watch,
      unwatch: watcher.unwatch,
      build: (target) => runBuild(target),
      debounceMs: 20,
    });

    try {
      expect(watcher.callbacks.size).toBeGreaterThan(0);
      expect(
        [...watcher.callbacks.keys()].some((path) =>
          path.endsWith("packages/pack/package.json"),
        ),
      ).toBe(true);
    } finally {
      await handle.stop();
    }
  });

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

  test("retries a missing package when its safe parent receives the package", async () => {
    const dir = tempProject(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "review-pack",
      "agents": {
        "reviewer": {
          "$template": "review-pack/agent",
          "description": "Review",
          "identity": "Identity"
        }
      }
    }`);
    const nodeModules = join(dir, "node_modules");
    mkdirSync(nodeModules);
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({
        name: "atlante-watch-fixture",
        version: "1.0.0",
        dependencies: { "review-pack": "1.2.3" },
      })}\n`,
    );
    const watcher = fakeWatcher();
    let builds = 0;

    await withSilencedConsole(async () => {
      const handle = runBuildWatchWithDependencies(dir, {
        build: (target) => {
          builds += 1;
          return runBuild(target);
        },
        watch: watcher.watch,
        unwatch: watcher.unwatch,
        debounceMs: 20,
      });

      try {
        expect(builds).toBe(1);
        const retryParent = canonical(nodeModules);
        expect(watcher.callbacks.has(retryParent)).toBe(true);

        const packageRoot = join(nodeModules, "review-pack");
        const files = writeExternalPackage(packageRoot);
        watcher.callbacks.get(retryParent)?.();

        await waitFor(() => builds === 2, "rebuild after package installation");
        expect(watcher.callbacks.has(canonical(files.manifest))).toBe(true);
        expect(watcher.callbacks.has(canonical(files.template))).toBe(true);
      } finally {
        await handle.stop();
      }
    });
  });

  test("recovers a missing dependency from a canonical workspace ancestor", async () => {
    const dir = tempProject(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "author-pack"
    }`);
    const workspace = tempProject();
    const packageRoot = join(workspace, "author-pack");
    const installed = join(dir, "node_modules", "author-pack");
    const workspaceNodeModules = join(workspace, "node_modules");
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    mkdirSync(workspaceNodeModules);
    const localNodeModules = join(packageRoot, "node_modules");
    mkdirSync(localNodeModules);
    symlinkSync(packageRoot, installed, "dir");
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({
        name: "atlante-build-watch-fixture",
        version: "1.0.0",
        dependencies: { "author-pack": "file:workspace" },
      })}\n`,
    );
    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "author-pack",
        version: "1.0.0",
        atlante: { format: 1 },
        dependencies: { "review-pack": "1.2.3" },
      })}\n`,
    );
    writeFileSync(
      join(packageRoot, "atlante.jsonc"),
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        extends: "review-pack",
        agents: {
          reviewer: {
            $template: "review-pack/agent",
            description: "Review",
            identity: "Identity",
          },
        },
      })}\n`,
    );

    const watcher = fakeWatcher();
    let builds = 0;

    await withSilencedConsole(async () => {
      const handle = runBuildWatchWithDependencies(dir, {
        build: (target) => {
          builds += 1;
          return runBuild(target);
        },
        watch: watcher.watch,
        unwatch: watcher.unwatch,
        debounceMs: 20,
      });

      try {
        expect(builds).toBe(1);
        const retryParent = canonical(workspaceNodeModules);
        expect(watcher.callbacks.has(canonical(localNodeModules))).toBe(true);
        expect(watcher.callbacks.has(retryParent)).toBe(true);

        const dependencyRoot = join(workspaceNodeModules, "review-pack");
        const files = writeExternalPackage(dependencyRoot);
        const preset = join(dependencyRoot, "atlante.jsonc");
        const unrelated = join(workspaceNodeModules, "unrelated-pack");
        mkdirSync(unrelated);
        writeFileSync(join(unrelated, "package.json"), "{ malformed\n");
        const unrelatedManifest = join(unrelated, "package.json");

        watcher.callbacks.get(retryParent)?.();
        await waitFor(
          () => builds === 2,
          "rebuild after hoisted package creation",
        );
        await Bun.sleep(60);
        expect(builds).toBe(2);
        expect(callbackForPath(watcher, files.manifest)).toBeDefined();
        expect(callbackForPath(watcher, preset)).toBeDefined();
        expect(callbackForPath(watcher, files.template)).toBeDefined();
        expect(callbackForPath(watcher, files.source)).toBeDefined();
        expect(callbackForPath(watcher, unrelatedManifest)).toBeUndefined();
      } finally {
        await handle.stop();
      }
    });
  });

  test("recovers a missing scoped dependency from its existing workspace scope", async () => {
    const dir = tempProject(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "author-pack"
    }`);
    const workspace = tempProject();
    const packageRoot = join(workspace, "author-pack");
    const installed = join(dir, "node_modules", "author-pack");
    const workspaceNodeModules = join(workspace, "node_modules");
    const scopeRoot = join(workspaceNodeModules, "@scope");
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    mkdirSync(scopeRoot, { recursive: true });
    const localNodeModules = join(packageRoot, "node_modules");
    mkdirSync(localNodeModules);
    symlinkSync(packageRoot, installed, "dir");
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({
        name: "atlante-build-watch-scoped-fixture",
        version: "1.0.0",
        dependencies: { "author-pack": "file:workspace" },
      })}\n`,
    );
    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "author-pack",
        version: "1.0.0",
        atlante: { format: 1 },
        dependencies: { "@scope/review-pack": "1.2.3" },
      })}\n`,
    );
    writeFileSync(
      join(packageRoot, "atlante.jsonc"),
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        extends: "@scope/review-pack",
        agents: {
          reviewer: {
            $template: "@scope/review-pack/agent",
            description: "Review",
            identity: "Identity",
          },
        },
      })}\n`,
    );

    const watcher = fakeWatcher();
    let builds = 0;

    await withSilencedConsole(async () => {
      const handle = runBuildWatchWithDependencies(dir, {
        build: (target) => {
          builds += 1;
          return runBuild(target);
        },
        watch: watcher.watch,
        unwatch: watcher.unwatch,
        debounceMs: 20,
      });

      try {
        expect(builds).toBe(1);
        const retryParent = canonical(scopeRoot);
        expect(watcher.callbacks.has(canonical(localNodeModules))).toBe(true);
        expect(watcher.callbacks.has(retryParent)).toBe(true);

        const dependencyRoot = join(scopeRoot, "review-pack");
        const files = writeExternalPackage(
          dependencyRoot,
          "1.2.3",
          "@scope/review-pack",
        );
        const preset = join(dependencyRoot, "atlante.jsonc");

        watcher.callbacks.get(retryParent)?.();
        await waitFor(
          () => builds === 2,
          "rebuild after scoped hoisted package creation",
        );
        await Bun.sleep(60);
        expect(builds).toBe(2);
        expect(callbackForPath(watcher, files.manifest)).toBeDefined();
        expect(callbackForPath(watcher, preset)).toBeDefined();
        expect(callbackForPath(watcher, files.template)).toBeDefined();
        expect(callbackForPath(watcher, files.source)).toBeDefined();
      } finally {
        await handle.stop();
      }
    });
  });

  test("reconciles external metadata and facets while retaining failed inputs and artifacts", async () => {
    const { dir, packageRoot, installedPackage, files } =
      externalPackageProject();
    const watcher = fakeWatcher();
    let builds = 0;

    await withSilencedConsole(async () => {
      const handle = runBuildWatchWithDependencies(dir, {
        build: (target) => {
          builds += 1;
          return runBuild(target);
        },
        watch: watcher.watch,
        unwatch: watcher.unwatch,
        debounceMs: 20,
      });
      try {
        expect(builds).toBe(1);
        const projectRoot = canonical(dir);
        const packageCanonical = canonical(packageRoot);
        const packageRelative = relative(projectRoot, packageCanonical);
        expect(
          packageRelative === ".." || packageRelative.startsWith(`..${sep}`),
        ).toBe(true);
        expect(canonical(installedPackage)).toBe(packageCanonical);
        const manifestPath = join(
          dir,
          ".atlante",
          "artifacts",
          "manifest.json",
        );
        const before = readFileSync(manifestPath, "utf8");
        expect(callbackForPath(watcher, files.manifest)).toBeDefined();
        expect(callbackForPath(watcher, files.source)).toBeDefined();

        writeExternalPackage(packageRoot, "1.2.4");
        callbackForPath(watcher, files.manifest)?.();
        await waitFor(
          () => builds === 2,
          "rebuild after package metadata change",
        );
        expect(readFileSync(manifestPath, "utf8")).toBe(before);

        writeFileSync(files.source, "{{#if\n");
        callbackForPath(watcher, files.source)?.();
        await waitFor(() => builds === 3, "failed rebuild after facet change");
        expect(readFileSync(manifestPath, "utf8")).toBe(before);
        expect(callbackForPath(watcher, files.manifest)).toBeDefined();
        expect(callbackForPath(watcher, files.template)).toBeDefined();
        expect(callbackForPath(watcher, files.source)).toBeDefined();

        writeFileSync(files.source, "{{identity}}\n");
        callbackForPath(watcher, files.source)?.();
        await waitFor(() => builds === 4, "rebuild after facet recovery");
      } finally {
        await handle.stop();
      }
    });
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
