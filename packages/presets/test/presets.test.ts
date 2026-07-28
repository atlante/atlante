import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPresets, readPreset } from "../src/index.js";

const created: string[] = [];

function presetsRootWith(
  entry: string,
  filename = "atlante.jsonc",
  contents = "{}",
): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-presets-"));
  created.push(root);
  const directory = join(root, entry);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, filename), contents);
  return root;
}

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("bundled presets", () => {
  test("derives full logical ids from the registry namespace and directory", () => {
    expect(listPresets()).toEqual({
      presets: ["atlante/starter"],
      errors: [],
    });
  });

  test("reads a preset document by its full logical id", () => {
    expect(readPreset("atlante/starter")).toContain("$schema");
  });

  test("starter exposes the workflow as a skill with ordered phases", () => {
    const preset = readPreset("atlante/starter");
    if (!preset) throw new Error("starter preset is missing");
    expect(preset).toContain('"skills": {');
    expect(preset).toContain('"brainstorming": {');
    expect(preset).toContain('"workflow": {');
    expect(preset).toContain('"title": "Process"');
    expect(preset).not.toContain('"name": "create-issue"');
    expect(preset).toContain('"title": "Brainstorming"');
    expect(preset).toContain("Ask one clarifying question at a time");
    expect(preset).toContain('"name": "plan"');
    expect(preset).toContain('"name": "execute"');
    expect(preset).toContain('"name": "final-review"');
    expect(preset).toContain('"name": "write-tests"');
    expect(preset).toContain('"name": "implement-to-pass-tests"');
    expect(preset).toContain('"name": "review-result"');
    expect(preset).toContain('"title": "Execution workflow"');
    expect(preset).toContain(
      '"overview": "Plan and execute the approved issue with explicit dependencies."',
    );
  });

  test("returns raw preset text containing skills without filtering it", () => {
    const contents = `{
      "$schema": "https://atlante.sh/schema/v0.1/schema.json",
      "agents": {},
      "skills": { "testing": { "description": "Run tests", "content": "bun test" } }
    }`;
    const root = presetsRootWith("skills", "atlante.jsonc", contents);

    expect(readPreset("atlante/skills", root)).toBe(contents);
  });

  test("does not accept short names or path traversal as ids", () => {
    expect(readPreset("starter")).toBeUndefined();
    expect(readPreset("atlante/../../../etc/passwd")).toBeUndefined();
  });
});

describe("listPresets", () => {
  test("accepts atlante.json without parsing the preset document", () => {
    const root = presetsRootWith("minimal", "atlante.json", "not-json");

    expect(listPresets(root)).toEqual({
      presets: ["atlante/minimal"],
      errors: [],
    });
    expect(readPreset("atlante/minimal", root)).toBe("not-json");
  });

  test("reports a directory without a preset document", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-presets-"));
    created.push(root);
    mkdirSync(join(root, "missing"));

    const result = listPresets(root);

    expect(result.presets).toEqual([]);
    expect(result.errors[0]?.message).toBe(
      "missing atlante.jsonc or atlante.json",
    );
  });

  test("reports ambiguous document forms", () => {
    const root = presetsRootWith("ambiguous");
    writeFileSync(join(root, "ambiguous", "atlante.json"), "{}");

    const result = listPresets(root);

    expect(result.presets).toEqual([]);
    expect(result.errors[0]?.message).toBe(
      "both atlante.jsonc and atlante.json exist",
    );
    expect(readPreset("atlante/ambiguous", root)).toBeUndefined();
  });

  test("reports a directory name that cannot form a logical id", () => {
    const root = presetsRootWith("Bad Name");

    const result = listPresets(root);

    expect(result.presets).toEqual([]);
    expect(result.errors[0]?.message).toContain("invalid preset name");
  });

  test("ignores unrelated non-directory entries", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-presets-"));
    created.push(root);
    writeFileSync(join(root, "README.txt"), "not a preset");

    expect(listPresets(root)).toEqual({ presets: [], errors: [] });
  });

  test("collects root and per-entry filesystem failures", () => {
    expect(listPresets("/definitely/not/a/preset/root").errors).toHaveLength(1);

    const root = presetsRootWith("broken");
    const result = listPresets(root, {
      statSync: () => {
        throw new Error("injected stat failure");
      },
    });

    expect(result.presets).toEqual([]);
    expect(result.errors[0]?.message).toContain("injected stat failure");
  });

  test("returns undefined when the selected document cannot be read", () => {
    const root = presetsRootWith("unreadable");

    expect(
      readPreset("atlante/unreadable", root, {
        readFileSync: () => {
          throw new Error("injected read failure");
        },
      }),
    ).toBeUndefined();
  });
});
