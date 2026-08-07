import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadTemplateMigrationRegistry,
  type RawResourceLocator,
  type RawResourceOrigin,
  type ResourceLocator,
  type ResourceOrigin,
  type TemplateMigrationRecord,
} from "../src/index.js";

const created: string[] = [];
const validRoot = new URL("./fixtures/valid", import.meta.url).pathname;
const brokenRoot = new URL("./fixtures/broken", import.meta.url).pathname;
const missingInputDialectRoot = new URL(
  "./fixtures/missing-input-dialect",
  import.meta.url,
).pathname;

function templateRoot(
  schema: string,
  source = "Hello {{name}}.",
  directory = "greeting",
): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-resources-"));
  created.push(root);
  const facetDirectory = join(root, directory);
  mkdirSync(facetDirectory, { recursive: true });
  writeFileSync(join(facetDirectory, "template.jsonc"), schema);
  writeFileSync(join(facetDirectory, "template.md"), source);
  return root;
}

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function compileTimeMigrationContracts(
  template: TemplateMigrationRecord,
): void {
  const rawLocator: RawResourceLocator = template.locator;
  const rawOrigin: RawResourceOrigin = template.origin;
  // @ts-expect-error T2 migration records must not expose validated identities.
  const validatedLocator: ResourceLocator = template.locator;
  // @ts-expect-error T2 migration records must not expose validated identities.
  const validatedOrigin: ResourceOrigin = template.origin;
  void rawLocator;
  void rawOrigin;
  void validatedLocator;
  void validatedOrigin;
}

void compileTimeMigrationContracts;

describe("template facet loader", () => {
  test("does not construct validated identities in T2 migration loaders", () => {
    const source = [
      readFileSync(new URL("../src/loader.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../src/bundled.ts", import.meta.url), "utf8"),
    ].join("\n");

    expect(source).not.toContain("trusted<ResourceLocator>");
    expect(source).not.toContain("trusted<ResourceOrigin>");
    expect(source).not.toContain("as ResourceLocator");
    expect(source).not.toContain("as ResourceOrigin");
  });

  test("derives raw migration ids from the namespace and directory", () => {
    const { registry, errors } = loadTemplateMigrationRegistry(
      validRoot,
      "test",
    );
    const template = registry.get("test/greeting");

    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual(["test/greeting"]);
    expect(template?.locator).toBe("test/greeting");
    expect(template?.origin).toEqual({
      kind: "project",
      path: "test/greeting/template.jsonc",
    });
    expect(template?.source.trim()).toBe("Hello {{name}}.");
  });

  test("exposes template.jsonc directly as the input schema", () => {
    const { registry } = loadTemplateMigrationRegistry(validRoot, "test");

    expect(registry.get("test/greeting")?.inputSchema.type).toBe("object");
  });

  test("returns undefined for an unknown id", () => {
    const { registry } = loadTemplateMigrationRegistry(validRoot, "test");

    expect(registry.get("test/nope")).toBeUndefined();
  });

  test("loads template.jsonc with comments and trailing commas", () => {
    const root = templateRoot(`{
      // JSONC is the resource facet format.
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "name": { "type": "string" },
      },
    }`);

    const { registry, errors } = loadTemplateMigrationRegistry(root, "test");

    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual(["test/greeting"]);
    expect(registry.get("test/greeting")?.inputSchema).toMatchObject({
      type: "object",
    });
    expect(registry.get("test/greeting")?.source).toBe("Hello {{name}}.");
  });

  test("requires the exact template.jsonc and template.md facets", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-resources-"));
    created.push(root);
    const directory = join(root, "legacy");
    mkdirSync(directory);
    writeFileSync(
      join(directory, "template.json"),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema" }',
    );

    const result = loadTemplateMigrationRegistry(root, "test");

    expect(result.registry.ids()).toEqual([]);
    expect(result.errors[0]?.message).toContain("template.jsonc");
  });

  test("rejects malformed JSONC and a missing Draft 2020-12 dialect", () => {
    const malformedRoot = templateRoot("{ not-jsonc", "source", "malformed");
    const missingDialectRoot = templateRoot(
      '{ "type": "object" }',
      "source",
      "missing",
    );

    expect(
      loadTemplateMigrationRegistry(malformedRoot, "test").errors[0]?.message,
    ).toContain("malformed template.jsonc");
    expect(
      loadTemplateMigrationRegistry(missingDialectRoot, "test").errors[0]
        ?.message,
    ).toContain("Draft 2020-12");

    for (const root of [brokenRoot, missingInputDialectRoot]) {
      const { registry, errors } = loadTemplateMigrationRegistry(root, "test");
      expect(registry.ids()).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain("$schema");
      expect(errors[0]?.message).toContain("Draft 2020-12");
    }
  });

  test("rejects invalid namespaces without reading entries", () => {
    const root = templateRoot(
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema" }',
    );

    const result = loadTemplateMigrationRegistry(root, "Bad Namespace");

    expect(result.registry.ids()).toEqual([]);
    expect(result.errors[0]?.message).toContain("invalid template namespace");
  });

  test("collects a per-entry stat failure instead of throwing", () => {
    const result = loadTemplateMigrationRegistry(validRoot, "test", {
      statSync: () => {
        throw new Error("injected stat failure");
      },
    });

    expect(result.registry.ids()).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("injected stat failure");
  });

  test("reports a missing template facet without throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-resources-"));
    created.push(root);
    const directory = join(root, "missing-source");
    mkdirSync(directory);
    writeFileSync(
      join(directory, "template.jsonc"),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema" }',
    );

    const result = loadTemplateMigrationRegistry(root, "test");

    expect(result.registry.ids()).toEqual([]);
    expect(result.errors[0]?.message).toContain("unreadable template facets");
  });

  test("reports an unreadable template root", () => {
    const result = loadTemplateMigrationRegistry(
      "/definitely/not/a/template/root",
      "test",
    );

    expect(result.registry.ids()).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });
});
