import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listPresets,
  PRESET_MANIFEST_URI,
  presetName,
  readPreset,
} from "../src/index.ts";

const created: string[] = [];

/** Builds a one-off presets root with a single `<entry>/preset.json`. */
function presetsRootWith(entry: string, contents: string): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-presets-"));
  created.push(root);
  const dir = join(root, entry);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "preset.json"), contents);
  return root;
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("bundled presets", () => {
  test("lists code-review", () => {
    expect(listPresets().presets.map(presetName)).toEqual(["code-review"]);
  });

  test("every manifest declares the versioned schema and a namespaced id", () => {
    for (const manifest of listPresets().presets) {
      expect(manifest.$schema).toBe(PRESET_MANIFEST_URI);
      expect(manifest.id).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/);
      if (manifest.description)
        expect(manifest.description.length).toBeGreaterThan(0);
    }
  });

  test("accepts optional name, description, and version metadata", () => {
    const root = presetsRootWith(
      "minimal",
      JSON.stringify({
        $schema: PRESET_MANIFEST_URI,
        id: "atlante/minimal",
        name: "Minimal",
        version: "0.1.0",
      }),
    );
    const { presets, errors } = listPresets(root);
    expect(errors).toEqual([]);
    expect(presets[0]).toMatchObject({
      id: "atlante/minimal",
      name: "Minimal",
      version: "0.1.0",
    });
  });

  test("reads a preset's document source", () => {
    expect(readPreset("code-review")).toContain("$schema");
  });

  test("returns undefined for an unknown preset", () => {
    expect(readPreset("nope")).toBeUndefined();
  });

  test("returns undefined instead of reading a path traversal outside PRESETS_DIR", () => {
    expect(readPreset("../../../etc/passwd")).toBeUndefined();
  });
});

describe("listPresets error handling", () => {
  test("reports a malformed preset.json instead of throwing", () => {
    const root = presetsRootWith("broken", "{ this is not valid JSON");
    const { presets, errors } = listPresets(root);
    expect(presets).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("malformed preset.json");
  });

  test("reports a preset.json that fails schema validation instead of throwing", () => {
    const root = presetsRootWith(
      "broken",
      JSON.stringify({
        $schema: PRESET_MANIFEST_URI,
        id: "atlante/broken",
        unsupported: true,
      }),
    );
    const { presets, errors } = listPresets(root);
    expect(presets).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("invalid preset.json");
  });

  test("rejects a directory whose name diverges from the manifest id", () => {
    const root = presetsRootWith(
      "wrong-name",
      JSON.stringify({
        $schema: PRESET_MANIFEST_URI,
        id: "atlante/right-name",
        description: "A preset",
      }),
    );
    const { presets, errors } = listPresets(root);
    expect(presets).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("wrong-name");
    expect(errors[0]?.message).toContain("right-name");
  });

  test("reports an immediate preset directory missing preset.json", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-presets-"));
    created.push(root);
    mkdirSync(join(root, "missing"));
    const { presets, errors } = listPresets(root);
    expect(presets).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("missing preset.json");
  });

  test("ignores unrelated non-directory entries", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-presets-"));
    created.push(root);
    writeFileSync(join(root, "README.txt"), "not a preset");
    expect(listPresets(root)).toEqual({ presets: [], errors: [] });
  });

  test("reports a per-entry stat failure instead of throwing", () => {
    const root = presetsRootWith(
      "broken",
      JSON.stringify({ $schema: PRESET_MANIFEST_URI, id: "atlante/broken" }),
    );
    const result = listPresets(root, {
      statSync: () => {
        throw new Error("injected stat failure");
      },
    });
    expect(result.presets).toEqual([]);
    expect(result.errors[0]?.message).toContain("injected stat failure");
  });

  test("reports an unreadable preset manifest instead of throwing", () => {
    const root = presetsRootWith(
      "broken",
      JSON.stringify({ $schema: PRESET_MANIFEST_URI, id: "atlante/broken" }),
    );
    const result = listPresets(root, {
      readFileSync: () => {
        throw new Error("injected read failure");
      },
    });
    expect(result.presets).toEqual([]);
    expect(result.errors[0]?.message).toContain("injected read failure");
  });

  test("reads an atlante.json preset document and rejects both document forms", () => {
    const root = presetsRootWith(
      "json-only",
      JSON.stringify({ $schema: PRESET_MANIFEST_URI, id: "atlante/json-only" }),
    );
    const directory = join(root, "json-only");
    writeFileSync(join(directory, "atlante.json"), '{"agents":{}}');
    expect(readPreset("json-only", root)).toBe('{"agents":{}}');

    writeFileSync(join(directory, "atlante.jsonc"), "{}");
    expect(readPreset("json-only", root)).toBeUndefined();
  });
});
