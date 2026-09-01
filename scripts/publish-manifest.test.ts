import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStagedPublishManifest } from "./publish-manifest.js";

// The regression test in packages/opencode asserts the repo manifest is
// server-discoverable; this test guards the publish-side half of the same
// premise: staging for publish must not transform main or exports, so what
// ships is exactly the shape the loader discovers.
test("staging the publish manifest keeps main and exports untouched", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-publish-manifest-"));
  try {
    const manifestPath = join(directory, "package.json");
    const manifest = {
      name: "@atlante/opencode",
      version: "0.1.19",
      main: "dist/index.js",
      exports: {
        ".": "./dist/index.js",
        "./api": "./dist/api.js",
        "./server": "./dist/index.js",
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
