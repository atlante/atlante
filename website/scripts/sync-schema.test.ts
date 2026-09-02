import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncSchema } from "./sync-schema";

const repoRoot = join(import.meta.dirname, "..", "..");
const sourceDir = join(repoRoot, "packages", "schema", "schema", "v0.1");
const schemaIdBase = "https://atlante.sh/schema/v0.1";
let temporaryWebsiteRoot: string;

afterEach(() => {
  if (temporaryWebsiteRoot) {
    rmSync(temporaryWebsiteRoot, { recursive: true, force: true });
  }
});

describe("syncSchema", () => {
  it("copies every authoritative schema to the website public path unchanged", () => {
    temporaryWebsiteRoot = mkdtempSync(
      join(tmpdir(), "atlante-website-schema-"),
    );

    const results = syncSchema({
      repoRoot,
      websiteRoot: temporaryWebsiteRoot,
    });
    const sourceNames = readdirSync(sourceDir)
      .filter((name) => name.endsWith(".json"))
      .sort();

    // Every generated schema (the configuration document contract and the
    // eval-scenario document contract, today) must be published: scenario
    // documents name their matching atlante.sh URL in `$schema`, and a gap
    // here would 404 in production.
    expect(sourceNames).toEqual(["eval-scenario.json", "schema.json"]);
    expect(results).toEqual(
      sourceNames.map((name) => ({
        sourcePath: join(sourceDir, name),
        destinationPath: join(
          temporaryWebsiteRoot,
          "public",
          "schema",
          "v0.1",
          name,
        ),
      })),
    );
    for (const name of sourceNames) {
      const destinationPath = join(
        temporaryWebsiteRoot,
        "public",
        "schema",
        "v0.1",
        name,
      );
      expect(JSON.parse(readFileSync(destinationPath, "utf8")).$id).toBe(
        `${schemaIdBase}/${name}`,
      );
      expect(readFileSync(destinationPath)).toEqual(
        readFileSync(join(sourceDir, name)),
      );
    }
  });

  it("fails when the authoritative schema directory is unavailable", () => {
    temporaryWebsiteRoot = mkdtempSync(
      join(tmpdir(), "atlante-website-schema-"),
    );

    expect(() =>
      syncSchema({
        repoRoot: temporaryWebsiteRoot,
        websiteRoot: temporaryWebsiteRoot,
      }),
    ).toThrow("Authoritative schema is unavailable:");
  });

  it("fails when an authoritative schema has the wrong identity", () => {
    temporaryWebsiteRoot = mkdtempSync(
      join(tmpdir(), "atlante-website-schema-"),
    );
    const fakeSourceDir = join(
      temporaryWebsiteRoot,
      "packages",
      "schema",
      "schema",
      "v0.1",
    );
    mkdirSync(fakeSourceDir, { recursive: true });
    writeFileSync(
      join(fakeSourceDir, "schema.json"),
      JSON.stringify({ $id: "https://example.com/schema.json" }),
    );

    expect(() =>
      syncSchema({
        repoRoot: temporaryWebsiteRoot,
        websiteRoot: temporaryWebsiteRoot,
      }),
    ).toThrow("Authoritative schema has unexpected $id");
  });
});
