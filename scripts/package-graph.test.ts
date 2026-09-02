import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// Packages are listed in architectural layer order, lowest layer first; keep
// this list in the same order as AGENTS.md and scripts/release.ts.
const PACKAGES = [
  "schema",
  "resources",
  "validator",
  "builder",
  "pack",
  "opencode",
  "eval",
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
  expect(rootManifest.workspaces).toEqual(["packages/*", "website", "docs"]);

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

test("keeps resources private and synchronizes exactly eight workspaces", () => {
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

// bun.lock is machine-generated JSONC (trailing commas); normalize them and
// parse strictly. A malformed strip fails loudly below instead of silently
// letting stale lockfile bookkeeping strand into an unrelated PR.
function readLockfile(): {
  workspaces: Record<
    string,
    { version?: string; dependencies?: Record<string, string> }
  >;
} {
  return JSON.parse(
    readFileSync(join(ROOT, "bun.lock"), "utf8").replace(/,(\s*[}\]])/g, "$1"),
  );
}

// The release flow refreshes bun.lock, but nothing else asserted lockfile
// consistency, so v0.1.19 stranded 0.1.18 workspace entries and a stale
// website pin until an unrelated PR reconciled them.
test("keeps bun.lock synchronized with the workspace manifests", () => {
  const lock = readLockfile();

  for (const name of PACKAGES) {
    expect(
      lock.workspaces[`packages/${name}`]?.version,
      `bun.lock workspace entry for packages/${name} is stale`,
    ).toBe(readJson(join(ROOT, "packages", name, "package.json")).version);
  }

  const website = readJson(join(ROOT, "website", "package.json"));
  expect(
    lock.workspaces.website?.dependencies?.["@atlante/cli"],
    "bun.lock website @atlante/cli pin is stale",
  ).toBe((website.dependencies as Record<string, string>)["@atlante/cli"]);
});

test("keeps only pack, CLI, and OpenCode publishable", () => {
  const publishable = new Set<string>();
  for (const name of PACKAGES) {
    const manifest = readJson(join(ROOT, "packages", name, "package.json"));
    if (manifest.publishConfig) publishable.add(name);
  }
  expect([...publishable].sort()).toEqual(["cli", "opencode", "pack"]);

  const publish = readFileSync(
    join(ROOT, "scripts", "publish-packages.ts"),
    "utf8",
  );
  expect(publish).toContain('const PACKAGES = ["pack", "cli", "opencode"]');
  expect(publish).not.toContain("bundled");
});

test("publishes a static first-party pack with no executable API", async () => {
  const pack = readJson(join(ROOT, "packages", "pack", "package.json"));
  expect(pack.main).toBeUndefined();
  expect(pack.module).toBeUndefined();
  expect(pack.exports).toBeUndefined();
  expect(pack.bin).toBeUndefined();
  expect(pack.atlante).toEqual({ format: 1 });

  const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: join(ROOT, "packages", "pack"),
    encoding: "utf8",
  });

  const report = JSON.parse(stdout) as Array<{
    files: Array<{ path: string }>;
  }>;
  const files = report[0]?.files.map(({ path }) => path) ?? [];
  expect(files).toContain("package.json");
  expect(files).toContain("atlante.jsonc");
  expect(files).toContain("agent/template.jsonc");
  expect(files).toContain("agent/template.md");
  expect(files).toContain("architect/instance.jsonc");
  expect(files.some((file) => /\.(?:c|m)?js$|\.ts$/.test(file))).toBe(false);
}, 15_000);

test("keeps the first-party pack as a CLI runtime dependency in source", () => {
  const cli = readJson(join(ROOT, "packages", "cli", "package.json"));
  const dependencies = cli.dependencies as Record<string, unknown>;
  expect(dependencies["@atlante/pack"]).toBe("workspace:*");
});

// build.ts once deliberately documented itself as the only caller of the
// publisher: bypassing it would skip the fail-closed prepare-then-publish
// ordering. Native materialization replaced the publisher, and nothing in a
// package source may resurrect `publishArtifacts`.
test("keeps publishArtifacts out of every package source", () => {
  const offenders: string[] = [];
  for (const name of PACKAGES) {
    const packageRoot = join(ROOT, "packages", name);
    for (const file of filesUnder(join(packageRoot, "src"))) {
      if (readFileSync(file, "utf8").includes("publishArtifacts")) {
        offenders.push(file);
      }
    }
  }
  expect(offenders).toEqual([]);
});

test("orders release packages pack, CLI, then OpenCode adapter", () => {
  const publish = readFileSync(
    join(ROOT, "scripts", "publish-packages.ts"),
    "utf8",
  );
  expect(publish.indexOf('"pack"')).toBeLessThan(publish.indexOf('"cli"'));
  expect(publish.indexOf('"cli"')).toBeLessThan(publish.indexOf('"opencode"'));
});
