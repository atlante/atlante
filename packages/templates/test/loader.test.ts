import { describe, expect, test } from "bun:test";
import { loadTemplates } from "../src/index.js";

const validRoot = new URL("./fixtures/valid", import.meta.url).pathname;
const brokenRoot = new URL("./fixtures/broken", import.meta.url).pathname;
const duplicateRoot = new URL("./fixtures/duplicate", import.meta.url).pathname;
const missingInputDialectRoot = new URL(
  "./fixtures/missing-input-dialect",
  import.meta.url,
).pathname;

describe("loadTemplates", () => {
  test("loads a template keyed by its manifest id", () => {
    const { registry, errors } = loadTemplates(validRoot);
    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual(["test/greeting"]);
    expect(registry.get("test/greeting")?.source.trim()).toBe(
      "Hello {{name}}.",
    );
  });

  test("exposes the manifest inputSchema", () => {
    const { registry } = loadTemplates(validRoot);
    const manifest = registry.get("test/greeting")?.manifest;
    expect(manifest?.inputSchema.type).toBe("object");
  });

  test("returns undefined for an unknown id", () => {
    const { registry } = loadTemplates(validRoot);
    expect(registry.get("test/nope")).toBeUndefined();
  });

  test("reports a manifest missing its $schema instead of throwing", () => {
    const { registry, errors } = loadTemplates(brokenRoot);
    expect(registry.ids()).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("$schema");
  });

  test("requires every inputSchema to declare the exact Draft 2020-12 dialect", () => {
    const { registry, errors } = loadTemplates(missingInputDialectRoot);
    expect(registry.ids()).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("inputSchema");
    expect(errors[0]?.message).toContain("$schema");
  });

  test("reports a collision when two directories declare the same manifest id", () => {
    const { registry, errors } = loadTemplates(duplicateRoot);
    expect(registry.ids()).toEqual(["test/dup"]);
    expect(registry.get("test/dup")?.source.trim()).toBe("First.");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("test/dup");
    expect(errors[0]?.message).toContain("first");
    expect(errors[0]?.message).toContain("second");
  });

  test("collects a per-entry stat failure instead of throwing", () => {
    const result = loadTemplates(validRoot, {
      statSync: (directory) => {
        if (directory.endsWith("greeting")) {
          throw new Error("injected stat failure");
        }
        return { isDirectory: () => true };
      },
    });
    expect(result.registry.ids()).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain("injected stat failure");
  });
});
