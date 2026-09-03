import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withStagedPublishManifest } from "./publish-manifest.js";

// The CLI is the composition root that injects the internal OpenCode
// materializer. The materializer is bundled into the CLI, so only the
// first-party pack is staged for registry resolution.
test("staging rewrites the published pack dependency", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-publish-manifest-"));
  try {
    const manifestPath = join(directory, "package.json");
    const manifest = {
      name: "@atlante/cli",
      version: "0.1.21",
      bin: { atlante: "./dist/bin/atlante.js" },
      dependencies: { "@atlante/pack": "workspace:*" },
      devDependencies: {
        "@atlante/eval": "workspace:*",
        "@atlante/opencode": "workspace:*",
      },
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
      "@atlante/pack": "^0.1.21",
    });
    expect(staged).not.toHaveProperty("devDependencies");
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
      dependencies: {
        "@atlante/opencode": "workspace:*",
        "@atlante/pack": "workspace:*",
      },
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
    ).toThrow("@atlante/opencode");

    // Nothing was staged, so the manifest keeps its original content.
    expect(staged).toBeUndefined();
    expect(JSON.parse(readFileSync(manifestPath, "utf8"))).toEqual(manifest);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
