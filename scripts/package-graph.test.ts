import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGES = [
  "schema",
  "resources",
  "validator",
  "builder",
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

test("keeps resources private and synchronizes exactly six workspaces", () => {
  const resources = readJson(
    join(ROOT, "packages", "resources", "package.json"),
  );
  expect(resources.private).toBe(true);
  expect(resources.publishConfig).toBeUndefined();

  const manifestPaths = PACKAGES.map((name) =>
    join(ROOT, "packages", name, "package.json"),
  );
  expect(manifestPaths.every((path) => existsSync(path))).toBe(true);

  const release = readFileSync(join(ROOT, "scripts", "release.ts"), "utf8");
  for (const name of PACKAGES) expect(release).toContain(`"${name}"`);
  expect(release).toContain("const PACKAGES = [");
});

test("keeps only CLI and OpenCode publishable", () => {
  const publishable = new Set<string>();
  for (const name of PACKAGES) {
    const manifest = readJson(join(ROOT, "packages", name, "package.json"));
    if (manifest.publishConfig) publishable.add(name);
  }
  expect([...publishable].sort()).toEqual(["cli", "opencode-plugin"]);

  const publish = readFileSync(
    join(ROOT, "scripts", "publish-packages.ts"),
    "utf8",
  );
  expect(publish).toContain('const PACKAGES = ["cli", "opencode-plugin"]');
  expect(publish).toContain("bundled/resources");
  expect(publish).not.toContain("bundled/templates");
  expect(publish).not.toContain("bundled/presets");
});
