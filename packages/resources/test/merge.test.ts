import { describe, expect, test } from "vitest";
import type { ResourceOrigin } from "../src/index.js";
import {
  mergeResourceValues,
  resourceTemplateSelection,
} from "../src/index.js";
import { resolvedSelectionFixture } from "./selection-fixture.js";

const inheritedOrigin = {
  kind: "package",
  path: "@atlante/pack@0.1.6/atlante.jsonc",
} as unknown as ResourceOrigin;
const localOrigin = {
  kind: "project",
  path: "atlante.jsonc",
} as unknown as ResourceOrigin;

describe("resource merge", () => {
  test("preserves selections while cloning unchanged and recursively merged objects", () => {
    const fixture = resolvedSelectionFixture();
    try {
      const unchanged = fixture.payload;
      const inheritedNested = Object.freeze({ unchanged, inherited: true });
      const inherited = Object.freeze({ unchanged, nested: inheritedNested });
      const local = Object.freeze({
        nested: Object.freeze({ local: true }),
      });

      const result = mergeResourceValues(inherited, local, {
        inheritedOrigin,
        localOrigin,
      });
      const output = result.value as {
        unchanged: object;
        nested: { unchanged: object; inherited: boolean; local: boolean };
      };

      expect(output).not.toBe(inherited);
      expect(output.nested).not.toBe(inheritedNested);
      expect(resourceTemplateSelection(output.unchanged)).toEqual({
        templateId: "../branch-second",
      });
      expect(resourceTemplateSelection(output.nested)).toBeUndefined();
      expect(resourceTemplateSelection(output.nested.unchanged)).toEqual({
        templateId: "../branch-second",
      });
      expect(resourceTemplateSelection(inheritedNested)).toBeUndefined();
    } finally {
      fixture.cleanup();
    }
  });

  test("uses local replacement selections and clears stale deleted or replaced selections", () => {
    const fixture = resolvedSelectionFixture();
    try {
      const selected = fixture.payload;
      const inherited = {
        merged: selected,
        locallySelected: selected,
        replaced: selected,
        replacedWithSelection: selected,
        deleted: selected,
      };
      const local = {
        merged: { local: true },
        locallySelected: selected,
        replaced: ["local"],
        replacedWithSelection: selected,
        deleted: null,
      };

      const result = mergeResourceValues(inherited, local, {
        inheritedOrigin,
        localOrigin,
      });
      const output = result.value as Record<string, unknown>;

      expect(resourceTemplateSelection(output.merged)).toEqual({
        templateId: "../branch-second",
      });
      expect(resourceTemplateSelection(output.locallySelected)).toEqual({
        templateId: "../branch-second",
      });
      expect(resourceTemplateSelection(output.replaced)).toBeUndefined();
      expect(resourceTemplateSelection(output.replacedWithSelection)).toEqual({
        templateId: "../branch-second",
      });
      expect(output).not.toHaveProperty("deleted");
    } finally {
      fixture.cleanup();
    }
  });

  test("merges arrays by replacement", () => {
    const result = mergeResourceValues(
      { values: ["inherited", "array"] },
      { values: ["local"] },
      { inheritedOrigin, localOrigin },
    );

    expect(result.value).toEqual({ values: ["local"] });
    expect(result.provenance["/values"]).toEqual(localOrigin);
    expect(result.provenance["/values/0"]).toEqual(localOrigin);
    expect(result.provenance["/values/1"]).toBeUndefined();
  });

  test("merges objects recursively", () => {
    const result = mergeResourceValues(
      { nested: { inherited: true, shared: "base" } },
      { nested: { local: true, shared: "override" } },
      { inheritedOrigin, localOrigin },
    );

    expect(result.value).toEqual({
      nested: { inherited: true, local: true, shared: "override" },
    });
  });

  test("applies scalar replacement and null tombstones", () => {
    const result = mergeResourceValues(
      { keep: true, remove: "old", replace: "old" },
      { remove: null, replace: 42 },
      { inheritedOrigin, localOrigin },
    );

    expect(result.value).toEqual({ keep: true, replace: 42 });
    expect(result.provenance["/remove"]).toBeUndefined();
    expect(result.provenance["/replace"]).toEqual(localOrigin);
  });

  test("drops a tombstone even when no inherited value exists", () => {
    const result = mergeResourceValues(
      undefined,
      { absent: null, present: true },
      { localOrigin },
    );

    expect(result.value).toEqual({ present: true });
    expect(result.provenance["/absent"]).toBeUndefined();
  });

  test("gives local fields precedence without mutating either input", () => {
    const inherited = { nested: { old: true }, array: [{ value: 1 }] };
    const local = { nested: { new: true }, array: [{ value: 2 }] };
    const inheritedBefore = structuredClone(inherited);
    const localBefore = structuredClone(local);

    const result = mergeResourceValues(inherited, local, {
      inheritedOrigin,
      localOrigin,
    });

    expect(result.value).toEqual({
      nested: { old: true, new: true },
      array: [{ value: 2 }],
    });
    expect(inherited).toEqual(inheritedBefore);
    expect(local).toEqual(localBefore);
    expect(result.value).not.toBe(inherited);
    expect(result.value).not.toBe(local);
  });

  test("preserves inherited and local node origins", () => {
    const result = mergeResourceValues(
      {
        inherited: { leaf: "base" },
        shared: { inheritedLeaf: true },
      },
      {
        local: { leaf: "new" },
        shared: { localLeaf: true },
      },
      { inheritedOrigin, localOrigin },
    );

    expect(result.provenance[""]).toEqual(localOrigin);
    expect(result.provenance["/inherited"]).toEqual(inheritedOrigin);
    expect(result.provenance["/inherited/leaf"]).toEqual(inheritedOrigin);
    expect(result.provenance["/local"]).toEqual(localOrigin);
    expect(result.provenance["/local/leaf"]).toEqual(localOrigin);
    expect(result.provenance["/shared"]).toEqual(localOrigin);
    expect(result.provenance["/shared/inheritedLeaf"]).toEqual(inheritedOrigin);
    expect(result.provenance["/shared/localLeaf"]).toEqual(localOrigin);
  });

  test("keeps provenance separate from merge data", () => {
    const result = mergeResourceValues(
      { value: "base" },
      { value: "local" },
      { inheritedOrigin, localOrigin },
    );

    expect(Object.keys(result.value as object)).toEqual(["value"]);
    expect(JSON.stringify(result.value)).not.toContain("origin");
    expect(JSON.stringify(result.value)).not.toContain("provenance");
  });
});
