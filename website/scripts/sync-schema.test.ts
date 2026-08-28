import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncSchema } from "./sync-schema";

const repoRoot = join(import.meta.dirname, "..", "..");
const sourcePath = join(
  repoRoot,
  "packages",
  "schema",
  "schema",
  "v0.1",
  "schema.json",
);
const expectedSchemaId = "https://atlante.sh/schema/v0.1/schema.json";
let temporaryWebsiteRoot: string;

afterEach(() => {
  if (temporaryWebsiteRoot) {
    rmSync(temporaryWebsiteRoot, { recursive: true, force: true });
  }
});

describe("syncSchema", () => {
  it("copies the authoritative schema to the website public path unchanged", () => {
    temporaryWebsiteRoot = mkdtempSync(
      join(tmpdir(), "atlante-website-schema-"),
    );

    const result = syncSchema({ repoRoot, websiteRoot: temporaryWebsiteRoot });
    const destinationPath = join(
      temporaryWebsiteRoot,
      "public",
      "schema",
      "v0.1",
      "schema.json",
    );

    expect(result.sourcePath).toBe(sourcePath);
    expect(result.destinationPath).toBe(destinationPath);
    expect(JSON.parse(readFileSync(sourcePath, "utf8")).$id).toBe(
      expectedSchemaId,
    );
    expect(readFileSync(destinationPath)).toEqual(readFileSync(sourcePath));
  });

  it("fails when the authoritative schema is unavailable", () => {
    temporaryWebsiteRoot = mkdtempSync(
      join(tmpdir(), "atlante-website-schema-"),
    );

    expect(() =>
      syncSchema({
        repoRoot: temporaryWebsiteRoot,
        websiteRoot: temporaryWebsiteRoot,
      }),
    ).toThrow(`Authoritative schema is unavailable:`);
  });

  it("fails when the authoritative schema has the wrong identity", () => {
    temporaryWebsiteRoot = mkdtempSync(
      join(tmpdir(), "atlante-website-schema-"),
    );
    const fakeSourcePath = join(
      temporaryWebsiteRoot,
      "packages",
      "schema",
      "schema",
      "v0.1",
      "schema.json",
    );
    mkdirSync(dirname(fakeSourcePath), { recursive: true });
    writeFileSync(
      fakeSourcePath,
      JSON.stringify({ $id: "https://example.com/schema.json" }),
    );

    expect(() =>
      syncSchema({
        repoRoot: temporaryWebsiteRoot,
        websiteRoot: temporaryWebsiteRoot,
      }),
    ).toThrow(`Authoritative schema has unexpected $id`);
  });
});
