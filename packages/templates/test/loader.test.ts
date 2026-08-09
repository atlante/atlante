import { describe, expect, test } from "bun:test";
import { loadTemplates } from "../src/index.js";

const validRoot = new URL("./fixtures/valid", import.meta.url).pathname;
const brokenRoot = new URL("./fixtures/broken", import.meta.url).pathname;
const missingInputDialectRoot = new URL(
  "./fixtures/missing-input-dialect",
  import.meta.url,
).pathname;

describe("loadTemplates", () => {
  test("derives template ids from the namespace and directory", () => {
    const { registry, errors } = loadTemplates(validRoot, "test");

    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual(["test/greeting"]);
    expect(registry.get("test/greeting")?.source.trim()).toBe(
      "Hello {{name}}.",
    );
  });

  test("exposes template.json directly as the input schema", () => {
    const { registry } = loadTemplates(validRoot, "test");

    expect(registry.get("test/greeting")?.inputSchema.type).toBe("object");
  });

  test("returns undefined for an unknown id", () => {
    const { registry } = loadTemplates(validRoot, "test");
    expect(registry.get("test/nope")).toBeUndefined();
  });

  test("requires template.json to declare Draft 2020-12", () => {
    for (const root of [brokenRoot, missingInputDialectRoot]) {
      const { registry, errors } = loadTemplates(root, "test");
      expect(registry.ids()).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain("$schema");
      expect(errors[0]?.message).toContain("Draft 2020-12");
    }
  });

  test("rejects a namespace that cannot form logical ids", () => {
    const { registry, errors } = loadTemplates(validRoot, "Bad Namespace");

    expect(registry.ids()).toEqual([]);
    expect(errors[0]?.message).toContain("invalid template namespace");
  });

  test("collects a per-entry stat failure instead of throwing", () => {
    const result = loadTemplates(validRoot, "test", {
      statSync: () => {
        throw new Error("injected stat failure");
      },
    });

    expect(result.registry.ids()).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toBe("unreadable template entry");
  });
});
