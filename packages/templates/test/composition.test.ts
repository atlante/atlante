import { describe, expect, test } from "bun:test";
import { loadTemplates, slotsOf, walkComposition } from "../src/index.ts";

const cyclicRoot = new URL("./fixtures/cyclic", import.meta.url).pathname;
const validRoot = new URL("./fixtures/valid", import.meta.url).pathname;
const danglingSlotRoot = new URL("./fixtures/dangling-slot", import.meta.url)
  .pathname;
const diamondRoot = new URL("./fixtures/diamond", import.meta.url).pathname;
const nestedSlotRoot = new URL("./fixtures/nested-slot", import.meta.url)
  .pathname;

describe("slotsOf", () => {
  test("finds a top-level slot property", () => {
    const { registry } = loadTemplates(cyclicRoot);
    const manifest = registry.get("test/a");
    if (!manifest) throw new Error("fixture missing");
    expect(slotsOf(manifest.manifest)).toEqual([
      { property: "child", templateId: "test/b" },
    ]);
  });

  test("returns no slots for a template without them", () => {
    const { registry } = loadTemplates(validRoot);
    const manifest = registry.get("test/greeting");
    if (!manifest) throw new Error("fixture missing");
    expect(slotsOf(manifest.manifest)).toEqual([]);
  });

  test("does not treat a nested template reference as a slot", () => {
    const { registry } = loadTemplates(nestedSlotRoot);
    const manifest = registry.get("test/nested-slot");
    if (!manifest) throw new Error("fixture missing");
    expect(slotsOf(manifest.manifest)).toEqual([]);
  });
});

describe("walkComposition", () => {
  test("detects a cycle and reports the chain", () => {
    const { registry } = loadTemplates(cyclicRoot);
    const issues = walkComposition(registry, "test/a");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("cyclic-template");
    expect(issues[0]?.chain).toEqual(["test/a", "test/b", "test/a"]);
  });

  test("reports an unknown template id passed as the root", () => {
    const { registry } = loadTemplates(validRoot);
    const issues = walkComposition(registry, "test/missing");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("unknown-template");
  });

  test("reports a slot referencing a template that does not exist, attributed to its property", () => {
    const { registry } = loadTemplates(danglingSlotRoot);
    const issues = walkComposition(registry, "test/dangling-holder");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("unknown-template");
    expect(issues[0]?.templateId).toBe("test/does-not-exist");
    expect(issues[0]?.property).toBe("missingSlot");
  });

  test("returns no issues for a diamond composition (two slots sharing a template)", () => {
    const { registry } = loadTemplates(diamondRoot);
    expect(walkComposition(registry, "test/diamond")).toEqual([]);
  });

  test("returns no issues for a template without slots", () => {
    const { registry } = loadTemplates(validRoot);
    expect(walkComposition(registry, "test/greeting")).toEqual([]);
  });

  test("rejects a slot reference nested below the top level of inputSchema", () => {
    const { registry } = loadTemplates(nestedSlotRoot);
    const issues = walkComposition(registry, "test/nested-slot");
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("invalid-input-schema");
    expect(issues[0]?.message).toContain("test/does-not-exist");
  });
});
