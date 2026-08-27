import { describe, expect, test } from "vitest";
import {
  agentBindingSchema,
  atlanteDocumentOverlaySchema,
  atlanteDocumentSchema,
  authoredExtendsSchema,
  bindingDescriptionSchema,
  rawResourceLocatorSchema,
  resourceSourceSchema,
  SCHEMA_URI,
} from "../src/document.js";

describe("document schema boundaries", () => {
  test.each([{ input: "", label: "empty string" }])(
    "rejects $label locators",
    ({ input }) => {
      expect(rawResourceLocatorSchema.safeParse(input).success).toBe(false);
    },
  );

  test("keeps the published URI and non-empty locator contract", () => {
    expect(SCHEMA_URI).toBe("https://atlante.sh/schema/v0.1/schema.json");
    expect(rawResourceLocatorSchema.safeParse("./resource").success).toBe(true);
    expect(rawResourceLocatorSchema.safeParse("long-locator").success).toBe(
      true,
    );
  });

  test.each([{ input: "", label: "empty string" }])(
    "rejects $label extends values",
    ({ input }) => {
      expect(authoredExtendsSchema.safeParse(input).success).toBe(false);
    },
  );

  test("enforces description and extends boundaries", () => {
    expect(bindingDescriptionSchema.safeParse({}).success).toBe(false);
    expect(
      bindingDescriptionSchema.safeParse({ description: "x" }).success,
    ).toBe(true);
    expect(authoredExtendsSchema.safeParse([]).success).toBe(false);
    expect(authoredExtendsSchema.safeParse(["./a", "./b"]).success).toBe(true);
  });

  test("preserves authored source alternatives and validation", () => {
    expect(resourceSourceSchema.safeParse("./resource").success).toBe(true);
    expect(
      resourceSourceSchema.safeParse({ $template: "./template" }).success,
    ).toBe(true);
    expect(resourceSourceSchema.safeParse({ $instance: "" }).success).toBe(
      false,
    );
    expect(resourceSourceSchema.safeParse({ $instance: 1 }).success).toBe(
      false,
    );
  });

  test("rejects reserved canonical fields and preserves canonical fields", () => {
    for (const field of ["$instance", "$template", "template"]) {
      expect(
        agentBindingSchema.safeParse({
          description: "x",
          [field]: "./resource",
        }).success,
      ).toBe(false);
    }
    expect(
      agentBindingSchema.safeParse({
        description: "x",
        values: { key: "value" },
      }).success,
    ).toBe(true);
  });

  test("enforces strict root document shapes", () => {
    expect(
      atlanteDocumentOverlaySchema.safeParse({ $schema: SCHEMA_URI }).success,
    ).toBe(true);
    expect(
      atlanteDocumentOverlaySchema.safeParse({ unknown: true }).success,
    ).toBe(false);
    expect(
      atlanteDocumentSchema.safeParse({ $schema: SCHEMA_URI }).success,
    ).toBe(true);
    expect(
      atlanteDocumentSchema.safeParse({ $schema: SCHEMA_URI, unknown: true })
        .success,
    ).toBe(false);
  });
});
