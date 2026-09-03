import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStagedPublishManifest } from "./publish-manifest.js";

// No packaged-entry test exists on the adapter side; the repo manifest shape
// itself is pinned in packages/opencode/test/entrypoint.test.ts against the
// package.json exports. This test guards the publish-side half of the same
// premise: staging for publish must not transform main or exports, so what
// ships is exactly the shape the entry resolves through.
test("staging the publish manifest keeps main and exports untouched", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-publish-manifest-"));
  try {
    const manifestPath = join(directory, "package.json");
    const manifest = {
      name: "@atlante/opencode",
      version: "0.1.19",
      main: "dist/index.js",
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          default: "./dist/index.js",
        },
      },
      dependencies: { "@atlante/pack": "workspace:*" },
      devDependencies: { "@atlante/builder": "workspace:*" },
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

    let staged: Record<string, unknown> | undefined;
    await withStagedPublishManifest(manifestPath, "0.1.20", async () => {
      staged = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
        string,
        unknown
      >;
    });

    expect(staged?.main).toBe(manifest.main);
    expect(staged?.exports).toEqual(manifest.exports);
    // The release flow bumps manifest versions itself; staging only
    // rewrites the pack range for registry resolution.
    expect(staged?.version).toBe(manifest.version);
    expect(staged?.dependencies).toEqual({ "@atlante/pack": "^0.1.20" });
    expect(staged).not.toHaveProperty("devDependencies");

    // The original manifest is restored once the publish window closes.
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(manifest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

// The CLI is the composition root that injects the OpenCode materializer, so
// PR #128 moved @atlante/opencode into its runtime dependencies. Both
// published workspace dependencies must resolve from the registry after
// staging.
test("staging rewrites every published workspace dependency to the released range", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-publish-manifest-"));
  try {
    const manifestPath = join(directory, "package.json");
    const manifest = {
      name: "@atlante/cli",
      version: "0.1.21",
      bin: { atlante: "./dist/bin/atlante.js" },
      dependencies: {
        "@atlante/opencode": "workspace:*",
        "@atlante/pack": "workspace:*",
      },
      devDependencies: { "@atlante/eval": "workspace:*" },
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

    let staged: Record<string, unknown> | undefined;
    await withStagedPublishManifest(manifestPath, "0.1.21", async () => {
      staged = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
        string,
        unknown
      >;
    });

    expect(staged?.dependencies).toEqual({
      "@atlante/opencode": "^0.1.21",
      "@atlante/pack": "^0.1.21",
    });
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(manifest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("staging rejects a workspace dependency on an unpublished package", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-publish-manifest-"));
  try {
    const manifestPath = join(directory, "package.json");
    const manifest = {
      name: "@atlante/cli",
      version: "0.1.21",
      dependencies: { "@atlante/eval": "workspace:*" },
    };
    writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

    let staged: Record<string, unknown> | undefined;
    expect(
      async () =>
        await withStagedPublishManifest(manifestPath, "0.1.21", async () => {
          staged = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
            string,
            unknown
          >;
        }),
    ).toThrow("@atlante/eval");

    // Nothing was staged, so the manifest keeps its original content.
    expect(staged).toBeUndefined();
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(manifest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
