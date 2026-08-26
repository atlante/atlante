import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { withStagedPublishManifest } from "./publish-manifest.js";

test("staged CLI publishing rewrites the pack workspace dependency", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-publish-manifest-"));
  const path = join(directory, "package.json");
  const original = `{
  "name": "@atlante/cli",
  "dependencies": {
    "@atlante/pack": "workspace:*"
  },
  "devDependencies": {
    "commander": "^12.1.0"
  }
}
`;
  writeFileSync(path, original);

  try {
    await withStagedPublishManifest(path, "1.2.3", async () => {
      const staged = JSON.parse(readFileSync(path, "utf8")) as {
        dependencies: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      expect(staged.dependencies["@atlante/pack"]).toBe("^1.2.3");
      expect(staged.devDependencies).toBeUndefined();
    });

    expect(readFileSync(path, "utf8")).toBe(original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("staged publishing rejects unpublished workspace runtime dependencies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-publish-manifest-"));
  const path = join(directory, "package.json");
  const original =
    '{"name":"@atlante/cli","dependencies":{"@atlante/schema":"workspace:*","@atlante/pack":"workspace:*"}}\n';
  writeFileSync(path, original);

  try {
    let failure: unknown;
    try {
      await withStagedPublishManifest(path, "1.2.3", async () => {});
    } catch (cause) {
      failure = cause;
    }

    expect(String(failure)).toContain("@atlante/schema");
    expect(readFileSync(path, "utf8")).toBe(original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("staged publishing restores the source manifest when publishing fails", async () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-publish-manifest-"));
  const path = join(directory, "package.json");
  const original =
    '{"name":"@atlante/cli","dependencies":{"@atlante/pack":"workspace:*"}}\n';
  writeFileSync(path, original);

  try {
    let failure: unknown;
    try {
      await withStagedPublishManifest(path, "1.2.3", async () => {
        throw new Error("publish failed");
      });
    } catch (cause) {
      failure = cause;
    }

    expect(String(failure)).toContain("publish failed");
    expect(readFileSync(path, "utf8")).toBe(original);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
