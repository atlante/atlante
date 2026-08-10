import { describe, expect, test } from "bun:test";
import { isCompositionMarker, type JsonObject, slotsOf } from "../src/index.js";

describe("resource template composition", () => {
  test("finds a top-level slot marker", () => {
    expect(
      slotsOf({
        type: "object",
        properties: { child: { template: "atlante/markdown" } },
      }),
    ).toEqual([{ property: "child", templateId: "atlante/markdown" }]);
  });

  test("finds nested object, array, and composition-branch slots", () => {
    expect(
      slotsOf({
        type: "object",
        properties: {
          outer: {
            type: "object",
            properties: { inner: { template: "atlante/markdown" } },
          },
          sections: { type: "array", items: { template: "atlante/markdown" } },
          choice: {
            oneOf: [
              {
                type: "object",
                properties: {
                  markdown: { template: "atlante/markdown" },
                },
              },
              {
                type: "object",
                properties: {
                  instructions: { template: "atlante/instructions" },
                },
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        property: "inner",
        templateId: "atlante/markdown",
        path: ["outer", "inner"],
        dataPath: ["outer", "inner"],
      },
      {
        property: "sections",
        templateId: "atlante/markdown",
        path: ["sections", "items"],
        dataPath: ["sections"],
        arrayItems: true,
      },
      {
        property: "markdown",
        templateId: "atlante/markdown",
        path: ["choice", "oneOf", "0", "markdown"],
        dataPath: ["choice", "markdown"],
      },
      {
        property: "instructions",
        templateId: "atlante/instructions",
        path: ["choice", "oneOf", "1", "instructions"],
        dataPath: ["choice", "instructions"],
      },
    ]);
  });

  test("tracks slots beneath nested array items without losing data paths", () => {
    const slots = slotsOf({
      type: "object",
      properties: {
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              rows: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    detail: { template: "atlante/markdown" },
                  },
                },
              },
            },
          },
        },
      },
    });

    expect(slots).toEqual([
      {
        property: "detail",
        templateId: "atlante/markdown",
        path: ["groups", "items", "rows", "items", "detail"],
        dataPath: ["groups", "rows", "detail"],
        arrayItems: true,
      },
    ]);
  });

  test("recognizes only an exact template marker object", () => {
    expect(isCompositionMarker({ template: "atlante/markdown" })).toBe(true);
    expect(
      isCompositionMarker({ template: "atlante/markdown", description: "x" }),
    ).toBe(false);
    expect(isCompositionMarker({ template: "" })).toBe(true);
    expect(isCompositionMarker({ type: "string", template: "atlante/x" })).toBe(
      false,
    );
    expect(isCompositionMarker(["template"])).toBe(false);
  });

  test("does not treat a JSON Schema property named template as a slot", () => {
    const schema: JsonObject = {
      type: "object",
      properties: {
        settings: {
          type: "object",
          properties: {
            template: {
              type: "string",
              template: "not-a-slot",
            },
          },
        },
      },
    };

    expect(slotsOf(schema)).toEqual([]);
  });

  test("accepts local and bundled locators but ignores malformed markers", () => {
    expect(
      slotsOf({
        type: "object",
        properties: {
          local: { template: "../shared" },
          bundled: { template: "atlante/markdown" },
          empty: { template: "" },
          unnamespaced: { template: "markdown" },
          nonString: { template: 42 },
        },
      }),
    ).toEqual([
      { property: "local", templateId: "../shared" },
      { property: "bundled", templateId: "atlante/markdown" },
    ]);
  });
});
