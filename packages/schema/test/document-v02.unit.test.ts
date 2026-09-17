import { describe, expect, test } from "bun:test";
import { buildDocumentV02JsonSchema } from "../scripts/generate.js";
import {
  atlanteDocumentOverlayV02Schema,
  atlanteDocumentV02Schema,
  documentV02JsonSchema,
  hostTargetV02Schema,
  SCHEMA_URI,
  SCHEMA_URI_V02,
} from "../src/index.js";

// Focused red-green seed for issue #207 Task 1: v0.2 admits opencode +
// claude-code, defaults to opencode, keeps v0.1 frozen.
describe("v0.2 document contract", () => {
  test("keeps v0.1 URI frozen", () => {
    expect(SCHEMA_URI).toBe("https://atlante.sh/schema/v0.1/schema.json");
    expect(SCHEMA_URI_V02).toBe("https://atlante.sh/schema/v0.2/schema.json");
  });

  test("admits both host targets", () => {
    expect(hostTargetV02Schema.safeParse("opencode").success).toBe(true);
    expect(hostTargetV02Schema.safeParse("claude-code").success).toBe(true);
    expect(hostTargetV02Schema.safeParse("claude").success).toBe(false);
  });

  test("defaults v0.2 hosts to opencode", () => {
    const result = atlanteDocumentV02Schema.safeParse({
      $schema: SCHEMA_URI_V02,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.hosts).toEqual(["opencode"]);
  });

  test("accepts claude-only and mixed selections", () => {
    for (const hosts of [["claude-code"], ["opencode", "claude-code"]]) {
      const result = atlanteDocumentV02Schema.safeParse({
        $schema: SCHEMA_URI_V02,
        hosts,
      });
      expect(result.success).toBe(true);
    }
  });

  test("rejects empty and duplicate v0.2 hosts", () => {
    for (const hosts of [[], ["claude-code", "claude-code"]]) {
      const result = atlanteDocumentV02Schema.safeParse({
        $schema: SCHEMA_URI_V02,
        hosts,
      });
      expect(result.success).toBe(false);
    }
  });

  test("v0.2 overlay keeps hosts optional", () => {
    const result = atlanteDocumentOverlayV02Schema.safeParse({
      $schema: SCHEMA_URI_V02,
      hosts: ["claude-code"],
    });
    expect(result.success).toBe(true);
  });

  test("the committed v0.2 file matches the generated output", () => {
    expect(documentV02JsonSchema.$id).toBe(SCHEMA_URI_V02);
    const properties = documentV02JsonSchema.properties as Record<
      string,
      unknown
    >;
    expect(properties.hosts).toEqual({
      type: "array",
      items: { enum: ["opencode", "claude-code"] },
      minItems: 1,
      uniqueItems: true,
    });
    expect(documentV02JsonSchema).toEqual(buildDocumentV02JsonSchema());
  });
});
