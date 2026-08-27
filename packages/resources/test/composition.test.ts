import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ResourceFailureCode } from "../src/index.js";
import {
  createProjectResourcePack,
  isCompositionMarker,
  type JsonObject,
  ResourceResolutionError,
  resolveResourceLocator,
  slotsOf,
} from "../src/index.js";

const created: string[] = [];

function expectFailure(action: () => unknown, code: ResourceFailureCode): void {
  try {
    action();
    throw new Error("expected resource resolution to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceResolutionError);
    if (error instanceof ResourceResolutionError)
      expect(error.failure.code).toBe(code);
  }
}

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("resource template composition", () => {
  test("finds a top-level slot marker", () => {
    expect(
      slotsOf({
        type: "object",
        properties: { child: { template: "@atlante/pack/markdown" } },
      }),
    ).toEqual([{ property: "child", templateId: "@atlante/pack/markdown" }]);
  });

  test("finds nested object, array, and composition-branch slots", () => {
    expect(
      slotsOf({
        type: "object",
        properties: {
          outer: {
            type: "object",
            properties: { inner: { template: "@atlante/pack/markdown" } },
          },
          sections: {
            type: "array",
            items: { template: "@atlante/pack/markdown" },
          },
          choice: {
            oneOf: [
              {
                type: "object",
                properties: {
                  markdown: { template: "@atlante/pack/markdown" },
                },
              },
              {
                type: "object",
                properties: {
                  instructions: { template: "@atlante/pack/instructions" },
                },
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        property: "inner",
        templateId: "@atlante/pack/markdown",
        path: ["outer", "inner"],
        dataPath: ["outer", "inner"],
      },
      {
        property: "sections",
        templateId: "@atlante/pack/markdown",
        path: ["sections", "items"],
        dataPath: ["sections"],
        arrayItems: true,
      },
      {
        property: "markdown",
        templateId: "@atlante/pack/markdown",
        path: ["choice", "oneOf", "0", "markdown"],
        dataPath: ["choice", "markdown"],
      },
      {
        property: "instructions",
        templateId: "@atlante/pack/instructions",
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
                    detail: { template: "@atlante/pack/markdown" },
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
        templateId: "@atlante/pack/markdown",
        path: ["groups", "items", "rows", "items", "detail"],
        dataPath: ["groups", "rows", "detail"],
        arrayItems: true,
      },
    ]);
  });

  test("recognizes only an exact template marker object", () => {
    expect(isCompositionMarker({ template: "@atlante/pack/markdown" })).toBe(
      true,
    );
    expect(
      isCompositionMarker({
        template: "@atlante/pack/markdown",
        description: "x",
      }),
    ).toBe(false);
    expect(isCompositionMarker({ template: "" })).toBe(true);
    expect(
      isCompositionMarker({ type: "string", template: "@atlante/pack/x" }),
    ).toBe(false);
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

  test("accepts local and package locators but ignores malformed markers", () => {
    expect(
      slotsOf({
        type: "object",
        properties: {
          local: { template: "../shared" },
          bundled: { template: "@atlante/pack/markdown" },
          empty: { template: "" },
          unnamespaced: { template: "markdown" },
          nonString: { template: 42 },
        },
      }),
    ).toEqual([
      { property: "local", templateId: "../shared" },
      { property: "bundled", templateId: "@atlante/pack/markdown" },
    ]);
  });

  test("finds invariant section slots across ordered branches", () => {
    expect(
      slotsOf({
        type: "object",
        properties: {
          sections: {
            type: "array",
            items: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    invariants: { template: "@atlante/pack/invariants" },
                  },
                },
              ],
            },
          },
        },
      }),
    ).toEqual([
      {
        property: "invariants",
        templateId: "@atlante/pack/invariants",
        path: ["sections", "items", "oneOf", "0", "invariants"],
        dataPath: ["sections", "invariants"],
        arrayItems: true,
      },
    ]);
  });

  test("accepts legacy built-in ids as package-style markers alongside other locator-backed markers", () => {
    expect(
      slotsOf({
        type: "object",
        properties: {
          agent: { template: "atlante/agent" },
          skill: { template: "atlante/skill" },
          starter: { template: "atlante/starter" },
          local: { template: "../shared" },
          unscoped: { template: "acme-review-pack/reviewer" },
          scoped: { template: "@acme/review-pack/strict/base" },
        },
      }),
    ).toEqual([
      { property: "agent", templateId: "atlante/agent" },
      { property: "skill", templateId: "atlante/skill" },
      { property: "starter", templateId: "atlante/starter" },
      { property: "local", templateId: "../shared" },
      {
        property: "unscoped",
        templateId: "acme-review-pack/reviewer",
      },
      {
        property: "scoped",
        templateId: "@acme/review-pack/strict/base",
      },
    ]);
  });

  test("fails legacy package-style markers through the generic declared-package path", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-composition-"));
    created.push(root);
    const source = join(root, "source.jsonc");
    writeFileSync(source, "{}\n");
    const pack = createProjectResourcePack(root);

    expectFailure(
      () => resolveResourceLocator(pack, "atlante/agent", source),
      "package-not-declared",
    );
  });
});
