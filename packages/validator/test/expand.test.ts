import { describe, expect, test } from "bun:test";
import type { SkillsOverlay } from "@atlante/schema";
import { SCHEMA_URI } from "@atlante/schema";
import {
  expandDocument,
  MAX_PRESET_DEPTH,
  type PresetLoader,
} from "../src/index.js";

describe("expandDocument", () => {
  test("merges, overrides, and tombstones inherited skills", () => {
    const loader: PresetLoader = {
      load: (id) => ({
        document:
          id === "test/base"
            ? {
                $schema: SCHEMA_URI,
                values: { project: "base", removeMe: "gone" },
                agents: {
                  inherited: {
                    description: "Inherited agent",
                    identity: "x",
                    mission: "y",
                  },
                },
                skills: {
                  inherited: { description: "base", content: "base content" },
                  removed: { description: "remove", content: "remove" },
                },
              }
            : undefined,
        diagnostics: [],
      }),
    };
    const result = expandDocument(
      {
        $schema: SCHEMA_URI,
        extends: "test/base",
        values: { project: "local", removeMe: null },
        skills: {
          inherited: { description: "local", content: "local content" },
          removed: null,
          added: { description: "added", content: "added content" },
        },
      },
      loader,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.values).toEqual({ project: "local" });
    expect(result.document?.skills).toEqual({
      inherited: { description: "local", content: "local content" },
      added: { description: "added", content: "added content" },
    });
  });

  test("preserves malformed root fields for canonical diagnostics", () => {
    const result = expandDocument(
      {
        $schema: SCHEMA_URI,
        extends: "test/base",
        skills: "not an object" as unknown as SkillsOverlay,
      },
      {
        load: () => ({
          document: { $schema: SCHEMA_URI, agents: {} },
          diagnostics: [],
        }),
      },
    );

    expect(result.document).toBeUndefined();
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.path === "/skills"),
    ).toBe(true);
  });

  test("rejects a null skills root instead of treating it as absent", () => {
    const result = expandDocument(
      {
        $schema: SCHEMA_URI,
        skills: null as unknown as SkillsOverlay,
      },
      { load: () => ({ document: undefined, diagnostics: [] }) },
    );

    expect(result.document).toBeUndefined();
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.path === "/skills"),
    ).toBe(true);
  });

  test("rejects a null value tombstone with an invalid key", () => {
    const result = expandDocument(
      {
        $schema: SCHEMA_URI,
        values: { "bad key": null },
      },
      { load: () => ({ document: undefined, diagnostics: [] }) },
    );

    expect(result.document).toBeUndefined();
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.path === "/values/bad key",
      ),
    ).toBe(true);
  });

  test("rejects an empty value tombstone key", () => {
    const result = expandDocument(
      {
        $schema: SCHEMA_URI,
        values: { "": null },
      },
      { load: () => ({ document: undefined, diagnostics: [] }) },
    );

    expect(result.document).toBeUndefined();
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.path === "/values/"),
    ).toBe(true);
  });

  test("rejects a null binding value tombstone with an invalid key", () => {
    const result = expandDocument(
      {
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            description: "Reviewer",
            identity: "x",
            mission: "y",
            values: { "bad key": null },
          },
        },
      },
      { load: () => ({ document: undefined, diagnostics: [] }) },
    );

    expect(result.document).toBeUndefined();
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.path === "/agents/reviewer/values/bad key",
      ),
    ).toBe(true);
  });

  test("rejects an empty skill key tombstone", () => {
    const result = expandDocument(
      {
        $schema: SCHEMA_URI,
        skills: { "": null } as unknown as SkillsOverlay,
      },
      { load: () => ({ document: undefined, diagnostics: [] }) },
    );

    expect(result.document).toBeUndefined();
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.path === "/skills/"),
    ).toBe(true);
  });

  test("reports unknown presets with a local path and chain", () => {
    const result = expandDocument(
      { $schema: SCHEMA_URI, extends: "missing/base" },
      { load: () => ({ document: undefined, diagnostics: [] }) },
    );

    expect(result.diagnostics[0]?.code).toBe("unknown-preset");
    expect(result.diagnostics[0]?.path).toBe("/extends");
    expect(result.diagnostics[0]?.message).toContain("missing/base");
  });

  test("reports a preset cycle with the complete chain", () => {
    const loader: PresetLoader = {
      load: (id) => ({
        document:
          id === "test/a"
            ? { $schema: SCHEMA_URI, extends: "test/b", agents: {} }
            : { $schema: SCHEMA_URI, extends: "test/a", agents: {} },
        diagnostics: [],
      }),
    };
    const result = expandDocument(
      { $schema: SCHEMA_URI, extends: "test/a" },
      loader,
    );

    expect(result.diagnostics[0]?.code).toBe("preset-cycle");
    expect(result.diagnostics[0]?.path).toBe("/extends");
    expect(result.diagnostics[0]?.message).toContain(
      "test/a -> test/b -> test/a",
    );
  });

  test("reports the complete chain when preset depth is exceeded", () => {
    const loader: PresetLoader = {
      load: (id) => {
        const number = Number(id.slice("test/".length));
        return {
          document: {
            $schema: SCHEMA_URI,
            extends: `test/${number + 1}`,
            agents: {},
          },
          diagnostics: [],
        };
      },
    };
    const result = expandDocument(
      { $schema: SCHEMA_URI, extends: "test/0" },
      loader,
    );

    expect(result.diagnostics[0]?.code).toBe("preset-depth-exceeded");
    expect(result.diagnostics[0]?.path).toBe("/extends");
    expect(result.diagnostics[0]?.message).toContain(String(MAX_PRESET_DEPTH));
    expect(result.diagnostics[0]?.message).toContain(
      "test/0 -> test/1 -> test/2",
    );
  });
});
