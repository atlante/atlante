import { describe, expect, test } from "bun:test";
import { loadTemplates, slotsOf, walkComposition } from "../src/index.js";

const cyclicRoot = new URL("./fixtures/cyclic", import.meta.url).pathname;
const validRoot = new URL("./fixtures/valid", import.meta.url).pathname;
const danglingSlotRoot = new URL("./fixtures/dangling-slot", import.meta.url)
  .pathname;
const diamondRoot = new URL("./fixtures/diamond", import.meta.url).pathname;
const nestedSlotRoot = new URL("./fixtures/nested-slot", import.meta.url)
  .pathname;
const malformedSlotRoot = new URL("./fixtures/malformed-slot", import.meta.url)
  .pathname;

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

  test("does not treat a nested template reference as a slot", () => {
    const { registry } = loadTemplates(nestedSlotRoot, "test");
    const template = registry.get("test/holder");
    if (!template) throw new Error("fixture missing");
    expect(slotsOf(template.inputSchema)).toEqual([]);
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

  test("rejects a slot reference nested below the top level of inputSchema", () => {
    const { registry } = loadTemplates(nestedSlotRoot, "test");
    const issues = walkComposition(registry, "test/holder");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("invalid-input-schema");
    expect(issues[0]?.message).toContain("test/does-not-exist");
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
