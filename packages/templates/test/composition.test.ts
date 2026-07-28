import { describe, expect, test } from "bun:test";
import {
  loadTemplates,
  slotsOf,
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
  definitions: Record<
    string,
    { inputSchema: Record<string, unknown>; source?: string }
  >,
): TemplateRegistry {
  const entries = new Map(
    Object.entries(definitions).map(([id, definition]) => [
      id,
      {
        id,
        source: definition.source ?? "",
        directory: "<memory>",
        inputSchema: definition.inputSchema,
      },
    ]),
  );
  return {
    get: (id) => entries.get(id),
    ids: () => [...entries.keys()],
  };
}

describe("slotsOf", () => {
  test("finds a top-level slot property", () => {
    const { registry } = loadTemplates(cyclicRoot, "test");
    const template = registry.get("test/a");
    if (!template) throw new Error("fixture missing");
    expect(slotsOf(template.inputSchema)).toEqual([
      { property: "child", templateId: "test/b" },
    ]);
  });

  test("returns no slots for a template without them", () => {
    const { registry } = loadTemplates(validRoot, "test");
    const template = registry.get("test/greeting");
    if (!template) throw new Error("fixture missing");
    expect(slotsOf(template.inputSchema)).toEqual([]);
  });

  test("finds a template reference at a nested object path", () => {
    const { registry } = loadTemplates(nestedSlotRoot, "test");
    const template = registry.get("test/holder");
    if (!template) throw new Error("fixture missing");
    const slots = slotsOf(template.inputSchema);
    expect(slots).toHaveLength(1);
    expect(slots[0]?.templateId).toBe("test/does-not-exist");
    expect(slots[0] as unknown).toMatchObject({
      path: ["outer", "inner"],
    });
  });

  test("finds slots declared in array items and oneOf branches", () => {
    const slots = slotsOf({
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: { template: "test/section" },
        },
        choice: {
          oneOf: [
            {
              type: "object",
              properties: { markdown: { template: "test/markdown" } },
            },
            {
              type: "object",
              properties: { instructions: { template: "test/instructions" } },
            },
          ],
        },
      },
    });

    expect(slots).toHaveLength(3);
    expect(slots.map(({ templateId }) => templateId)).toEqual([
      "test/section",
      "test/markdown",
      "test/instructions",
    ]);
  });
});

describe("walkComposition", () => {
  test("detects a cycle and reports the chain", () => {
    const { registry } = loadTemplates(cyclicRoot, "test");
    const issues = walkComposition(registry, "test/a");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("cyclic-template");
    expect(issues[0]?.chain).toEqual(["test/a", "test/b", "test/a"]);
  });

  test("reports an unknown template id passed as the root", () => {
    const { registry } = loadTemplates(validRoot, "test");
    const issues = walkComposition(registry, "test/missing");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("unknown-template");
  });

  test("reports a slot referencing a template that does not exist, attributed to its property", () => {
    const { registry } = loadTemplates(danglingSlotRoot, "test");
    const issues = walkComposition(registry, "test/holder");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("unknown-template");
    expect(issues[0]?.templateId).toBe("test/does-not-exist");
    expect(issues[0]?.property).toBe("missingSlot");
  });

  test("returns no issues for a diamond composition (two slots sharing a template)", () => {
    const { registry } = loadTemplates(diamondRoot, "test");
    expect(walkComposition(registry, "test/diamond")).toEqual([]);
  });

  test("returns no issues for a template without slots", () => {
    const { registry } = loadTemplates(validRoot, "test");
    expect(walkComposition(registry, "test/greeting")).toEqual([]);
  });

  test("reports an unknown template at its nested slot path", () => {
    const { registry } = loadTemplates(nestedSlotRoot, "test");
    const issues = walkComposition(registry, "test/holder");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("unknown-template");
    expect(issues[0]?.property).toBe("inner");
    expect(issues[0]?.slotPath).toEqual(["outer", "inner"]);
    expect(issues[0]?.message).toContain("test/does-not-exist");
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
    expect(issues[0]?.code).toBe("cyclic-template");
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

  test("reports malformed markers at nested object, array, and oneOf paths", () => {
    const issues = walkComposition(
      registryOf({
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
                        type: "object",
                        properties: { branch: { template: "not-namespaced" } },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      }),
      "test/root",
    );

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

  test("rejects malformed slot markers explicitly", () => {
    const { registry } = loadTemplates(malformedSlotRoot, "test");
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
