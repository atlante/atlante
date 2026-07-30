import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";
import { loadBundledTemplates, loadTemplates } from "@atlante/templates";
import { loadProject, prepareProject, validateProject } from "../src/index.js";

const created: string[] = [];

const valid = `{
  "$schema": "${SCHEMA_URI}",
  "agents": {
    "reviewer": {
      "description": "Reviews changes.",
      "identity": "You review.",
      "mission": "Find defects."
    }
  }
}`;

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function project(contents: string): { directory: string; config: string } {
  const directory = mkdtempSync(join(tmpdir(), "atlante-builder-"));
  created.push(directory);
  const config = join(directory, "atlante.jsonc");
  writeFileSync(config, contents);
  return { directory, config };
}

describe("loadProject", () => {
  test("discovers a config and returns its canonical project root", () => {
    const { directory, config } = project(valid);

    const loaded = loadProject(directory);

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.configPath).toBe(config);
    expect(loaded.projectRoot).toBe(directory);
    expect(loaded.document?.agents?.reviewer?.description).toBe(
      "Reviews changes.",
    );
    expect(loaded.registry?.get("atlante/agent")).toBeDefined();
  });

  test("accepts an explicit config target", () => {
    const { directory, config } = project(valid);

    const loaded = loadProject(config);

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.projectRoot).toBe(directory);
    expect(loaded.configPath).toBe(config);
  });

  test("reports ambiguous discovered configuration files", () => {
    const { directory } = project(valid);
    writeFileSync(join(directory, "atlante.json"), valid);

    const loaded = loadProject(directory);

    expect(loaded.document).toBeUndefined();
    expect(loaded.registry).toBeUndefined();
    expect(loaded.diagnostics[0]?.code).toBe("ambiguous-config");
  });

  test("reports preset expansion failures", () => {
    const { directory } = project(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "atlante/missing",
      "agents": {}
    }`);

    const loaded = loadProject(directory);

    expect(loaded.document).toBeUndefined();
    expect(loaded.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-preset" }),
      ]),
    );
  });

  test("turns bundled template loader failures into diagnostics", () => {
    const { directory } = project(valid);
    const loaded = loadProject(directory, {
      loadTemplates: () => ({
        registry: { get: () => undefined, ids: () => [] },
        errors: [{ directory: "bundled", message: "injected failure" }],
      }),
    });

    expect(loaded.document).toBeUndefined();
    expect(loaded.registry).toBeUndefined();
    expect(loaded.diagnostics[0]?.code).toBe("template-load-failed");
  });
});

describe("validateProject", () => {
  test("validates without rendering template source", () => {
    const { directory } = project(`{
      "$schema": "${SCHEMA_URI}",
      "agents": {
        "reviewer": {
          "description": "Reviews changes.",
          "template": "test/broken"
        }
      }
    }`);
    const brokenRoot = new URL(
      "../../templates/test/fixtures/undeclared-partial",
      import.meta.url,
    ).pathname;
    const { registry: brokenRegistry } = loadTemplates(brokenRoot, "test");
    const { registry: bundledRegistry } = loadBundledTemplates();

    const validated = validateProject(directory, {
      loadTemplates: () => ({
        registry: {
          get: (id: string) =>
            brokenRegistry.get(id) ?? bundledRegistry.get(id),
          ids: () => [
            ...new Set([...brokenRegistry.ids(), ...bundledRegistry.ids()]),
          ],
        },
        errors: [],
      }),
    });

    expect(validated.diagnostics).toEqual([]);
    expect(validated.document).toBeDefined();
  });

  test("fails closed on missing configuration", () => {
    const directory = mkdtempSync(join(tmpdir(), "atlante-builder-empty-"));
    created.push(directory);

    const validated = validateProject(directory);

    expect(validated.document).toBeUndefined();
    expect(validated.diagnostics[0]?.code).toBe("config-not-found");
  });
});

describe("prepareProject", () => {
  test("prepares a loaded project without returning partial descriptors", () => {
    const { directory } = project(valid);

    const prepared = prepareProject(directory);

    expect(prepared.diagnostics).toEqual([]);
    expect(prepared.agents).toHaveLength(1);
    expect(prepared.agents[0]?.hostAgentId).toBe("reviewer");
  });

  test("returns no descriptors when preparation fails", () => {
    const { directory } = project(`{
      "$schema": "${SCHEMA_URI}",
      "agents": {
        "reviewer": {
          "description": "Reviews {{values.missing}}.",
          "identity": "You review.",
          "mission": "Find defects."
        }
      }
    }`);

    const prepared = prepareProject(directory);

    expect(prepared.agents).toEqual([]);
    expect(prepared.skills).toEqual([]);
    expect(prepared.diagnostics[0]?.code).toBe("missing-value");
  });
});
