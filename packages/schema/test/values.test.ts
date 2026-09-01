import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  safeRecord,
  VALUE_KEY_PATTERN,
  valuesMapOverlaySchema,
  valuesMapSchema,
} from "../src/values.js";

describe("safeRecord", () => {
  test("accepts only plain objects, including null-prototype objects", () => {
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.value = "ok";

    expect(
      safeRecord(z.string(), z.string()).safeParse(nullPrototype).success,
    ).toBe(true);
    const schema = safeRecord(z.string(), z.string());
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse(new Date()).success).toBe(false);
    expect(schema.safeParse([]).success).toBe(false);
    expect(schema.safeParse("value").success).toBe(false);
  });

  test("selects useful union errors for strings, null, and other values", () => {
    const schema = safeRecord(
      z.string(),
      z.union([z.string().min(3), z.number().min(10), z.null()]),
    );

    const stringResult = schema.safeParse({ value: "x" });
    const numberResult = schema.safeParse({ value: 1 });
    const nullResult = schema.safeParse({ value: null });

    expect(stringResult.success).toBe(false);
    expect(numberResult.success).toBe(false);
    expect(nullResult.success).toBe(true);
    if (stringResult.success || numberResult.success) return;
    expect(stringResult.error.issues[0]?.message).toContain("string");
    expect(numberResult.error.issues[0]?.message).toContain("number");
  });

  test("selects a later union branch when the first branch only has a type error", () => {
    const schema = safeRecord(
      z.string(),
      z.union([z.number(), z.string().min(3), z.boolean()]),
    );
    const result = schema.safeParse({ value: "x" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain("Too small");
  });

  test("selects a union branch with any meaningful nested issue", () => {
    const schema = safeRecord(
      z.string(),
      z.union([z.union([z.string().min(3), z.number()]), z.boolean()]),
    );
    const result = schema.safeParse({ value: "x" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain("Too small");
  });

  test("selects the refined null branch when null is rejected semantically", () => {
    const schema = safeRecord(
      z.string(),
      z.union([z.string(), z.null().refine(() => false, "null rejected")]),
    );
    const result = schema.safeParse({ value: null });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toBe("null rejected");
  });

  test("uses the last union branch as the null fallback", () => {
    const schema = safeRecord(z.string(), z.union([z.string(), z.number()]));
    const result = schema.safeParse({ value: null });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain("number");
  });

  test("keeps the last branch distinct from the first for larger unions", () => {
    const schema = safeRecord(
      z.string(),
      z.union([z.string(), z.number(), z.boolean()]),
    );
    const result = schema.safeParse({ value: null });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain("boolean");
  });

  test("reports the original object error instead of throwing", () => {
    const result = safeRecord(z.string(), z.string()).safeParse(null);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual([
      { code: "custom", message: "expected an object", path: [] },
    ]);
  });

  test("reports key and value errors without copying invalid entries", () => {
    const schema = safeRecord(z.string().min(2), z.string().min(2));
    const result = schema.safeParse({ x: "valid", valid: "x", y: 1 });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([
      ["x"],
      ["valid"],
      ["y"],
    ]);
  });

  test("rejects an entry when either its key or value is invalid", () => {
    const schema = safeRecord(z.string().min(2), z.string().min(2));
    const result = schema.safeParse({ x: "valid", valid: "x" });

    expect(result.success).toBe(false);
  });
});

describe("value key grammar", () => {
  test.each([
    { key: "a", label: "a" },
    { key: "_private", label: "_private" },
    { key: "$system", label: "$system" },
    { key: "project-name", label: "project-name" },
    { key: "A1", label: "A1" },
  ])("accepts $label", ({ key }) => {
    expect(VALUE_KEY_PATTERN.test(key)).toBe(true);
  });

  test.each([
    { key: "", label: "empty string" },
    { key: "project.name", label: "project.name" },
    { key: "-project", label: "-project" },
    { key: "1project", label: "1project" },
    { key: "project name", label: "project name" },
  ])("rejects $label", ({ key }) => {
    expect(VALUE_KEY_PATTERN.test(key)).toBe(false);
  });

  test("keeps null overlay values while canonical maps reject them", () => {
    expect(valuesMapOverlaySchema.safeParse({ removed: null }).success).toBe(
      true,
    );
    expect(valuesMapSchema.safeParse({ removed: null }).success).toBe(false);
  });

  test("creates normal writable enumerable properties", () => {
    const result = safeRecord(z.string(), z.string()).safeParse({
      key: "value",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.getOwnPropertyDescriptor(result.data, "key")).toMatchObject({
      configurable: true,
      enumerable: true,
      value: "value",
      writable: true,
    });
    result.data.key = "changed";
    expect(result.data.key).toBe("changed");
  });
});
