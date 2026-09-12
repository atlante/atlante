import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { lockSyncIssues, syncLockToManifests } from "./package-graph";

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
  expect(rootManifest.workspaces).toEqual([
    "packages/*",
    "website",
    "docs",
    "packs",
  ]);
  expect(rootManifest.name).toBe("@atlante/repo");

  const lockfile = readFileSync(join(ROOT, "bun.lock"), "utf8");
  expect(lockfile).toContain('"name": "@atlante/repo"');
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

// The release flow refreshes bun.lock, and release.ts asserts this same
// invariant through the shared helper before committing a release (v0.1.21
// shipped a stale lock because nothing gate-checked it there).
test("keeps bun.lock synchronized with the workspace manifests", () => {
  expect(
    lockSyncIssues({
      packages: PACKAGES,
      pins: [{ manifest: "website/package.json", dependency: "atlante" }],
    }),
  ).toEqual([]);
});

test("repairs a stale root workspace name", () => {
  const root = mkdtempSync(join(tmpdir(), "package-graph-root-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "@atlante/repo", private: true }),
    );
    writeFileSync(
      join(root, "bun.lock"),
      `{
  "workspaces": {
    "": {
      "name": "atlante",
    },
  },
}`,
    );

    expect(lockSyncIssues({ packages: [] }, root)).toEqual([
      "root workspace has name atlante in bun.lock but package.json declares @atlante/repo",
    ]);
    expect(syncLockToManifests({ packages: [] }, root)).toEqual({
      synced: 1,
      remaining: [],
    });
    expect(readFileSync(join(root, "bun.lock"), "utf8")).toContain(
      '"name": "@atlante/repo"',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function writeLockFixture(root: string, lock: string) {
  writeFileSync(join(root, "bun.lock"), lock);
  mkdirSync(join(root, "packages", "cli"), { recursive: true });
  writeFileSync(
    join(root, "packages", "cli", "package.json"),
    JSON.stringify({ name: "atlante", version: "0.2.0" }),
  );
  mkdirSync(join(root, "website"), { recursive: true });
  writeFileSync(
    join(root, "website", "package.json"),
    JSON.stringify({
      name: "website",
      dependencies: { atlante: "0.2.0" },
    }),
  );
}

function fixtureIssues(root: string, lock: string) {
  writeLockFixture(root, lock);
  return lockSyncIssues(
    {
      packages: ["cli"],
      pins: [{ manifest: "website/package.json", dependency: "atlante" }],
    },
    root,
  );
}

test("reports stale workspace versions and pins", () => {
  const root = mkdtempSync(join(tmpdir(), "package-graph-"));
  try {
    expect(
      fixtureIssues(
        root,
        `{
  "workspaces": {
    "packages/cli": { "version": "0.1.0", },
    "website": { "dependencies": { "atlante": "0.1.0", }, },
  },
}`,
      ),
    ).toEqual([
      "packages/cli has version 0.1.0 in bun.lock but packages/cli/package.json declares 0.2.0",
      "website pins atlante to 0.1.0 in bun.lock but website/package.json declares 0.2.0",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports missing workspace entries and accepts JSONC trailing commas", () => {
  const root = mkdtempSync(join(tmpdir(), "package-graph-"));
  try {
    expect(
      fixtureIssues(
        root,
        `{
  "workspaces": {
    "website": { "dependencies": { "atlante": "0.2.0" } },
  },
}`,
      ),
    ).toEqual([
      "packages/cli has version <missing> in bun.lock but packages/cli/package.json declares 0.2.0",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("accepts a synchronized lock", () => {
  const root = mkdtempSync(join(tmpdir(), "package-graph-"));
  try {
    expect(
      fixtureIssues(
        root,
        `{
  "workspaces": {
    "packages/cli": { "version": "0.2.0" },
    "website": { "dependencies": { "atlante": "0.2.0" } },
  },
}`,
      ),
    ).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const SYNC_PINS = [
  { manifest: "website/package.json", dependency: "atlante" },
] as const;

test("syncs stale entries in a bun-shaped lock, leaving all other bytes alone", () => {
  const root = mkdtempSync(join(tmpdir(), "package-graph-sync-"));
  try {
    writeLockFixture(
      root,
      `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "@atlante/repo",
      "version": "0.1.0",
    },
    "packages/cli": {
      "name": "atlante",
      "version": "0.1.0",
      "bin": { "atlante": "./dist/bin/atlante.js" },
      "dependencies": {
        "@atlante/pack": "workspace:*",
      },
    },
    "packages/schema": {
      "name": "@atlante/schema",
      "version": "0.1.0",
    },
    "website": {
      "name": "website",
      "version": "0.1.0",
      "dependencies": {
        "atlante": "0.1.0",
        "astro": "^5.0.0",
      },
    },
  },
  "packages": {
    "atlante": ["atlante@workspace:packages/cli", "", {}, "sha"],
    "some-pkg": ["some-pkg@0.1.0", "", {}, "sha"],
  },
}`,
    );
    const { synced, remaining } = syncLockToManifests(
      { packages: ["cli"], pins: SYNC_PINS },
      root,
    );

    expect(synced).toBe(2);
    expect(remaining).toEqual([]);
    // The un-synced schema stanza keeps its stale 0.1.0 and its trailing
    // comma; workspace:* and astro are untouched; formatting is preserved;
    // the root stanza and the single-line resolution entries (which embed
    // the same 0.1.0 string) are byte-identical.
    expect(readFileSync(join(root, "bun.lock"), "utf8")).toBe(`{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "@atlante/repo",
      "version": "0.1.0",
    },
    "packages/cli": {
      "name": "atlante",
      "version": "0.2.0",
      "bin": { "atlante": "./dist/bin/atlante.js" },
      "dependencies": {
        "@atlante/pack": "workspace:*",
      },
    },
    "packages/schema": {
      "name": "@atlante/schema",
      "version": "0.1.0",
    },
    "website": {
      "name": "website",
      "version": "0.1.0",
      "dependencies": {
        "atlante": "0.2.0",
        "astro": "^5.0.0",
      },
    },
  },
  "packages": {
    "atlante": ["atlante@workspace:packages/cli", "", {}, "sha"],
    "some-pkg": ["some-pkg@0.1.0", "", {}, "sha"],
  },
}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("leaves an in-sync lock byte-identical", () => {
  const root = mkdtempSync(join(tmpdir(), "package-graph-sync-"));
  try {
    writeLockFixture(
      root,
      `{
  "workspaces": {
    "packages/cli": { "version": "0.2.0" },
    "website": { "dependencies": { "atlante": "0.2.0" } },
  },
}`,
    );
    const before = readFileSync(join(root, "bun.lock"), "utf8");
    const { synced, remaining } = syncLockToManifests(
      { packages: ["cli"], pins: SYNC_PINS },
      root,
    );

    expect(synced).toBe(0);
    expect(remaining).toEqual([]);
    expect(readFileSync(join(root, "bun.lock"), "utf8")).toBe(before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reports entries it cannot repair and leaves them stale", () => {
  const root = mkdtempSync(join(tmpdir(), "package-graph-sync-"));
  try {
    writeLockFixture(
      root,
      `{
  "workspaces": {
    "packages/cli": { "name": "atlante" },
    "website": {
      "dependencies": {
        "atlante": "0.1.0",
      },
    },
  },
}`,
    );
    const { synced, remaining } = syncLockToManifests(
      { packages: ["cli"], pins: SYNC_PINS },
      root,
    );

    // The pin is repaired; the missing version key has no textual anchor and
    // is left for the release script to hard-fail on.
    expect(synced).toBe(1);
    expect(remaining).toEqual([
      "packages/cli has version <missing> in bun.lock but packages/cli/package.json declares 0.2.0",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps only pack and CLI publishable", () => {
  const publishable = new Set<string>();
  for (const name of PACKAGES) {
    const manifest = readJson(join(ROOT, "packages", name, "package.json"));
    if (manifest.publishConfig) publishable.add(name);
  }
  expect([...publishable].sort()).toEqual(["cli", "pack"]);

  const publish = readFileSync(
    join(ROOT, "scripts", "publish-packages.ts"),
    "utf8",
  );
  expect(publish).toContain('const PACKAGES = ["pack", "cli"]');
  expect(publish).not.toContain('"opencode"');
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

  // npm ≤11 emits an array of pack results; npm ≥12 emits an object keyed by
  // package name. Normalize both so the test follows the ambient npm.
  const parsed = JSON.parse(stdout) as
    | Array<{ files: Array<{ path: string }> }>
    | Record<string, { files: Array<{ path: string }> }>;
  const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
  const files = entry?.files.map(({ path }) => path) ?? [];
  expect(files).toContain("package.json");
  expect(files).toContain("atlante.jsonc");
  expect(files).toContain("agent/template.jsonc");
  expect(files).toContain("agent/template.md");
  expect(files).toContain("architect/instance.jsonc");
  const executableFiles = files.filter((file) =>
    /\.(?:c|m)?js$|\.ts$/.test(file),
  );
  // Eval fixtures are intentionally executable input, but the static pack has
  // no runtime API outside its declared eval suite.
  expect(executableFiles.every((file) => file.startsWith("eval/"))).toBe(true);
}, 15_000);

test("keeps the first-party pack as a CLI runtime dependency in source", () => {
  const cli = readJson(join(ROOT, "packages", "cli", "package.json"));
  const dependencies = cli.dependencies as Record<string, unknown>;
  expect(dependencies["@atlante/pack"]).toBe("workspace:*");
});

test("uses the unscoped canonical CLI package name", () => {
  const cli = readJson(join(ROOT, "packages", "cli", "package.json"));
  expect(cli.name).toBe("atlante");
  expect(cli.bin).toEqual({ atlante: "./dist/bin/atlante.js" });
});

test("orders public packages pack before CLI", () => {
  const publish = readFileSync(
    join(ROOT, "scripts", "publish-packages.ts"),
    "utf8",
  );
  expect(publish.indexOf('"pack"')).toBeLessThan(publish.indexOf('"cli"'));
});
