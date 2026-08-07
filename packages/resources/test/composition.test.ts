import { describe, expect, test } from "bun:test";
import {
  type JsonObject,
  loadTemplateMigrationRegistry,
  slotsOf,
  type TemplateMigrationRecord,
  type TemplateRegistry,
  walkComposition,
} from "../src/index.js";

const cyclicRoot = new URL("./fixtures/cyclic", import.meta.url).pathname;
const validRoot = new URL("./fixtures/valid", import.meta.url).pathname;
const danglingSlotRoot = new URL("./fixtures/dangling-slot", import.meta.url)
  .pathname;
const diamondRoot = new URL("./fixtures/diamond", import.meta.url).pathname;
const nestedSlotRoot = new URL("./fixtures/nested-slot", import.meta.url)
  .pathname;
const malformedSlotRoot = new URL("./fixtures/malformed-slot", import.meta.url)
  .pathname;

function registryOf(
  definitions: Record<string, { inputSchema: JsonObject; source?: string }>,
): TemplateRegistry {
  const entries = new Map<string, TemplateMigrationRecord>(
    Object.entries(definitions).map(([id, definition]) => [
      id,
      {
        id,
        directory: "<memory>",
        locator: id,
        origin: { kind: "project", path: `<memory>/${id}/template.jsonc` },
        kind: "template" as const,
        source: definition.source ?? "",
        inputSchema: definition.inputSchema,
      },
    ]),
  );

  return {
    get: (id: string) => entries.get(id),
    ids: () => [...entries.keys()],
  };
}

describe("template composition", () => {
  test("finds a top-level slot from a JSONC template facet", () => {
    const { registry } = loadTemplateMigrationRegistry(cyclicRoot, "test");
    const template = registry.get("test/a");
    if (!template) throw new Error("fixture missing");

    expect(slotsOf(template.inputSchema)).toEqual([
      { property: "child", templateId: "test/b" },
    ]);
  });

  test("finds a top-level slot property", () => {
    expect(
      slotsOf({
        type: "object",
        properties: { child: { template: "test/child" } },
      }),
    ).toEqual([{ property: "child", templateId: "test/child" }]);
  });

  test("returns no slots for a template without them", () => {
    const { registry } = loadTemplateMigrationRegistry(validRoot, "test");
    const template = registry.get("test/greeting");
    if (!template) throw new Error("fixture missing");

    expect(slotsOf(template.inputSchema)).toEqual([]);
  });

  test("finds a template reference at a nested object path", () => {
    const { registry } = loadTemplateMigrationRegistry(nestedSlotRoot, "test");
    const template = registry.get("test/holder");
    if (!template) throw new Error("fixture missing");

    const slots = slotsOf(template.inputSchema);
    expect(slots).toHaveLength(1);
    expect(slots[0]?.templateId).toBe("test/does-not-exist");
    expect(slots[0]).toMatchObject({ path: ["outer", "inner"] });
  });

  test("finds nested object, array, and oneOf branch slots", () => {
    expect(
      slotsOf({
        type: "object",
        properties: {
          outer: {
            type: "object",
            properties: { inner: { template: "test/inner" } },
          },
          sections: { type: "array", items: { template: "test/section" } },
          choice: {
            oneOf: [
              { properties: { markdown: { template: "test/markdown" } } },
              {
                properties: {
                  instructions: { template: "test/instructions" },
                },
              },
            ],
          },
        },
      }),
    ).toEqual([
      {
        property: "inner",
        templateId: "test/inner",
        path: ["outer", "inner"],
        dataPath: ["outer", "inner"],
      },
      {
        property: "sections",
        templateId: "test/section",
        path: ["sections", "items"],
        dataPath: ["sections"],
        arrayItems: true,
      },
      {
        property: "markdown",
        templateId: "test/markdown",
        path: ["choice", "oneOf", "0", "markdown"],
        dataPath: ["choice", "markdown"],
      },
      {
        property: "instructions",
        templateId: "test/instructions",
        path: ["choice", "oneOf", "1", "instructions"],
        dataPath: ["choice", "instructions"],
      },
    ]);
  });

  test("detects a cycle and reports the complete chain", () => {
    const registry = registryOf({
      "test/a": {
        inputSchema: {
          type: "object",
          properties: { child: { template: "test/b" } },
        },
      },
      "test/b": {
        inputSchema: {
          type: "object",
          properties: { child: { template: "test/a" } },
        },
      },
    });

    const issues = walkComposition(registry, "test/a");

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("cyclic-template");
    expect(issues[0]?.chain).toEqual(["test/a", "test/b", "test/a"]);
  });

  test("detects a cycle from JSONC fixtures and reports the chain", () => {
    const { registry } = loadTemplateMigrationRegistry(cyclicRoot, "test");
    const issues = walkComposition(registry, "test/a");

    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("cyclic-template");
    expect(issues[0]?.chain).toEqual(["test/a", "test/b", "test/a"]);
  });

  test("reports an unknown template id passed as the root", () => {
    const { registry } = loadTemplateMigrationRegistry(validRoot, "test");

    expect(walkComposition(registry, "test/missing")).toMatchObject([
      { code: "unknown-template" },
    ]);
  });

  test("reports a missing slot and attributes it to the property", () => {
    const { registry } = loadTemplateMigrationRegistry(
      danglingSlotRoot,
      "test",
    );
    const issues = walkComposition(registry, "test/holder");

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "unknown-template",
      templateId: "test/does-not-exist",
      property: "missingSlot",
    });
  });

  test("reports an unknown template at its nested slot path", () => {
    const { registry } = loadTemplateMigrationRegistry(nestedSlotRoot, "test");
    const issues = walkComposition(registry, "test/holder");

    expect(issues[0]).toMatchObject({
      code: "unknown-template",
      property: "inner",
      slotPath: ["outer", "inner"],
    });
    expect(issues[0]?.message).toContain("test/does-not-exist");
  });

  test("reports unknown roots and nested slot paths", () => {
    const registry = registryOf({
      "test/root": {
        inputSchema: {
          type: "object",
          properties: {
            envelope: {
              type: "object",
              properties: { child: { template: "test/missing" } },
            },
          },
        },
      },
    });

    expect(walkComposition(registry, "test/nope")[0]?.code).toBe(
      "unknown-template",
    );
    expect(walkComposition(registry, "test/root")[0]).toMatchObject({
      code: "unknown-template",
      templateId: "test/missing",
      property: "child",
      slotPath: ["envelope", "child"],
    });
  });

  test("returns no issues for a diamond composition", () => {
    const registry = registryOf({
      "test/diamond": {
        inputSchema: {
          type: "object",
          properties: {
            left: { template: "test/leaf" },
            right: { template: "test/leaf" },
          },
        },
      },
      "test/leaf": { inputSchema: { type: "object" } },
    });

    expect(walkComposition(registry, "test/diamond")).toEqual([]);
  });

  test("returns no issues for a diamond fixture", () => {
    const { registry } = loadTemplateMigrationRegistry(diamondRoot, "test");

    expect(walkComposition(registry, "test/diamond")).toEqual([]);
  });

  test("returns no issues for a template without slots", () => {
    const { registry } = loadTemplateMigrationRegistry(validRoot, "test");

    expect(walkComposition(registry, "test/greeting")).toEqual([]);
  });

  test("detects cycles reached through nested object slots", () => {
    const registry = registryOf({
      "test/root": {
        inputSchema: {
          type: "object",
          properties: {
            envelope: {
              type: "object",
              properties: { child: { template: "test/a" } },
            },
          },
        },
      },
      "test/a": {
        inputSchema: {
          type: "object",
          properties: { payload: { template: "test/b" } },
        },
      },
      "test/b": {
        inputSchema: {
          type: "object",
          properties: { payload: { template: "test/a" } },
        },
      },
    });

    const issues = walkComposition(registry, "test/root");

    expect(issues).toHaveLength(1);
    expect(issues[0]?.chain).toEqual([
      "test/root",
      "test/a",
      "test/b",
      "test/a",
    ]);
    expect(issues[0]?.slotPath).toEqual([
      "envelope",
      "child",
      "payload",
      "payload",
    ]);
  });

  test("reports every malformed marker at its branch path", () => {
    const registry = registryOf({
      "test/root": {
        inputSchema: {
          type: "object",
          properties: {
            metadata: {
              type: "object",
              properties: {
                invalid: { template: 42 },
                sections: { type: "array", items: { template: "" } },
                choice: {
                  oneOf: [
                    {
                      properties: {
                        branch: { template: "not-namespaced" },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });

    const issues = walkComposition(registry, "test/root");

    expect(issues).toHaveLength(3);
    expect(issues.every((issue) => issue.code === "invalid-input-schema")).toBe(
      true,
    );
    expect(issues.map((issue) => issue.slotPath)).toEqual([
      ["metadata", "invalid"],
      ["metadata", "sections", "items"],
      ["metadata", "choice", "oneOf", "0", "branch"],
    ]);
  });

  test("reports malformed markers from the JSONC fixture", () => {
    const { registry } = loadTemplateMigrationRegistry(
      malformedSlotRoot,
      "test",
    );
    const issues = walkComposition(registry, "test/broken");

    expect(issues).toHaveLength(3);
    expect(issues.every((issue) => issue.code === "invalid-input-schema")).toBe(
      true,
    );
    expect(issues.map((issue) => issue.property)).toEqual([
      "notString",
      "empty",
      "notNamespaced",
    ]);
    expect(issues[0]?.message).toContain("invalid template marker");
  });
});
