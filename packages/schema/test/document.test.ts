import { describe, expect, test } from "bun:test";
import { atlanteDocumentSchema, SCHEMA_URI } from "../src/index.js";

const valid = {
  $schema: SCHEMA_URI,
  values: { project: "atlante", rule: "Never invent requirements." },
  agents: {
    reviewer: {
      template: "atlante/agent",
      values: { rule: "Reviews only." },
      identity: "You are a reviewer.",
      mission: "Review changes.",
    },
  },
};

describe("atlanteDocumentSchema", () => {
  test("accepts a valid document", () => {
    const result = atlanteDocumentSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test("accepts a document without values", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      agents: { a: { identity: "x", mission: "y" } },
    });
    expect(result.success).toBe(true);
  });

  test("rejects an unknown root field", () => {
    const result = atlanteDocumentSchema.safeParse({ ...valid, rules: [] });
    expect(result.success).toBe(false);
  });

  test("rejects a missing agents object", () => {
    const result = atlanteDocumentSchema.safeParse({ $schema: SCHEMA_URI });
    expect(result.success).toBe(false);
  });

  test("rejects an unsupported $schema URI", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      $schema: "https://example.com/other-schema.json",
    });
    expect(result.success).toBe(false);
  });

  test("rejects values that are not an object", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: "nope",
    });
    expect(result.success).toBe(false);
  });

  test("accepts a string-valued entry", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { language: "TypeScript" },
    });
    expect(result.success).toBe(true);
  });

  test("accepts a hyphenated value key supported by reference syntax", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { "project-name": "Atlante" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects a value key that cannot be referenced as a flat key", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { "project.name": "Atlante" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty value and agent keys without rewriting their diagnostics", () => {
    const emptyValue = atlanteDocumentSchema.safeParse(
      JSON.parse(`{"$schema":"${SCHEMA_URI}","values":{"":"x"},"agents":{}}`),
    );
    const emptyAgent = atlanteDocumentSchema.safeParse(
      JSON.parse(
        `{"$schema":"${SCHEMA_URI}","values":{},"agents":{"":{"identity":"x"}}}`,
      ),
    );
    expect(emptyValue.success).toBe(false);
    expect(emptyValue.success ? [] : emptyValue.error.issues[0]?.path).toEqual([
      "values",
      "",
    ]);
    expect(emptyAgent.success).toBe(false);
    expect(emptyAgent.success ? [] : emptyAgent.error.issues[0]?.path).toEqual([
      "agents",
      "",
    ]);
  });

  test("round-trips literal sentinel-like keys", () => {
    const result = atlanteDocumentSchema.safeParse(
      JSON.parse(
        `{"$schema":"${SCHEMA_URI}","values":{"$__atlante_key_61":"value","__proto__":"safe"},"agents":{"$__atlante_unknown_61":{"identity":"x","mission":"y"}}}`,
      ),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(
      Object.getOwnPropertyDescriptor(
        result.data.values ?? {},
        "$__atlante_key_61",
      )?.value,
    ).toBe("value");
    expect(Object.hasOwn(result.data.values ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(result.data.agents, "$__atlante_unknown_61")).toBe(
      true,
    );
  });

  test("rejects an array-valued entry", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { list: ["one", "two"] },
    });
    expect(result.success).toBe(false);
  });

  test("rejects an object-valued entry", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { limits: { maxAgents: 5 } },
    });
    expect(result.success).toBe(false);
  });

  test("rejects a value of an unsupported type", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { count: 3 },
    });
    expect(result.success).toBe(false);
  });

  test("keeps unknown agent fields, because the template owns them", () => {
    const result = atlanteDocumentSchema.safeParse(valid);
    if (!result.success) throw new Error("expected success");
    expect(result.data.agents.reviewer?.identity).toBe("You are a reviewer.");
  });

  test("preserves own __proto__ values and agent IDs without changing prototypes", () => {
    const raw = JSON.parse(
      `{"$schema":"${SCHEMA_URI}","values":{"__proto__":"safe"},"agents":{"__proto__":{"identity":"x","mission":"y"}}}`,
    );
    const result = atlanteDocumentSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.hasOwn(result.data.values ?? {}, "__proto__")).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(result.data.values ?? {}, "__proto__")
        ?.value,
    ).toBe("safe");
    expect(Object.hasOwn(result.data.agents, "__proto__")).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(result.data.agents, "__proto__")?.value
        ?.identity,
    ).toBe("x");
  });
});
