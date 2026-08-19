import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGES = [
  "schema",
  "resources",
  "validator",
  "builder",
  "pack",
  "opencode-plugin",
  "cli",
] as const;
const LEGACY_PACKAGES = ["templates", "presets"] as const;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

test("removes old workspace entries, manifests, imports, scripts, and lock entries", () => {
  for (const name of LEGACY_PACKAGES) {
    expect(existsSync(join(ROOT, "packages", name))).toBe(false);
  }

  const rootManifest = readJson(join(ROOT, "package.json"));
  expect(rootManifest.workspaces).toEqual(["packages/*"]);

  const lockfile = readFileSync(join(ROOT, "bun.lock"), "utf8");
  for (const name of LEGACY_PACKAGES) {
    expect(lockfile).not.toContain(`@atlante/${name}`);
    expect(lockfile).not.toContain(`packages/${name}`);
  }

  const packageSource = PACKAGES.flatMap((name) => {
    const packageRoot = join(ROOT, "packages", name);
    return [
      join(packageRoot, "package.json"),
      ...filesUnder(join(packageRoot, "src")),
    ];
  });
  for (const path of packageSource) {
    const source = readFileSync(path, "utf8");
    for (const name of LEGACY_PACKAGES) {
      expect(source, `${path} retains the old ${name} package`).not.toContain(
        `@atlante/${name}`,
      );
    }
  }

  const release = readFileSync(join(ROOT, "scripts", "release.ts"), "utf8");
  const publish = readFileSync(
    join(ROOT, "scripts", "publish-packages.ts"),
    "utf8",
  );
  for (const name of LEGACY_PACKAGES) {
    expect(release).not.toContain(`"${name}"`);
    expect(publish).not.toContain(name);
  }
});

test("keeps resources private and synchronizes exactly seven workspaces", () => {
  const resources = readJson(
    join(ROOT, "packages", "resources", "package.json"),
  );
  expect(resources.private).toBe(true);
  expect(resources.publishConfig).toBeUndefined();

  const manifestPaths = PACKAGES.map((name) =>
    join(ROOT, "packages", name, "package.json"),
  );
  expect(manifestPaths.every((path) => existsSync(path))).toBe(true);
  const versions = manifestPaths.map((path) => readJson(path).version);
  expect(new Set(versions).size).toBe(1);

  const release = readFileSync(join(ROOT, "scripts", "release.ts"), "utf8");
  for (const name of PACKAGES) expect(release).toContain(`"${name}"`);
  expect(release).toContain("const PACKAGES = [");
});

test("keeps only pack, CLI, and OpenCode publishable", () => {
  const publishable = new Set<string>();
  for (const name of PACKAGES) {
    const manifest = readJson(join(ROOT, "packages", name, "package.json"));
    if (manifest.publishConfig) publishable.add(name);
  }
  expect([...publishable].sort()).toEqual(["cli", "opencode-plugin", "pack"]);

  const publish = readFileSync(
    join(ROOT, "scripts", "publish-packages.ts"),
    "utf8",
  );
  expect(publish).toContain(
    'const PACKAGES = ["pack", "cli", "opencode-plugin"]',
  );
  expect(publish).not.toContain("bundled");
});

test(
  "publishes a static first-party pack with no executable API",
  async () => {
    const pack = readJson(join(ROOT, "packages", "pack", "package.json"));
    expect(pack.main).toBeUndefined();
    expect(pack.module).toBeUndefined();
    expect(pack.exports).toBeUndefined();
    expect(pack.bin).toBeUndefined();
    expect(pack.atlante).toEqual({ format: 1 });

    const result = await Bun.$`npm pack --dry-run --json`
      .cwd(join(ROOT, "packages", "pack"))
      .quiet()
      .nothrow();
    expect(result.exitCode).toBe(0);

    const report = JSON.parse(result.stdout.toString()) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files = report[0]?.files.map(({ path }) => path) ?? [];
    expect(files).toContain("package.json");
    expect(files).toContain("atlante.jsonc");
    expect(files).toContain("agent/template.jsonc");
    expect(files).toContain("agent/template.md");
    expect(files).toContain("architect/instance.jsonc");
    expect(files.some((file) => /\.(?:c|m)?js$|\.ts$/.test(file))).toBe(false);
  },
  { timeout: 15_000 },
);

test("keeps the first-party pack as a CLI runtime dependency in source", () => {
  const cli = readJson(join(ROOT, "packages", "cli", "package.json"));
  const dependencies = cli.dependencies as Record<string, unknown>;
  expect(dependencies["@atlante/pack"]).toBe("workspace:*");
});

test("orders release packages pack, CLI, then OpenCode plugin", () => {
  const publish = readFileSync(
    join(ROOT, "scripts", "publish-packages.ts"),
    "utf8",
  );
  expect(publish.indexOf('"pack"')).toBeLessThan(publish.indexOf('"cli"'));
  expect(publish.indexOf('"cli"')).toBeLessThan(
    publish.indexOf('"opencode-plugin"'),
  );
});
