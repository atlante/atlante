import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_URI } from "@atlante/schema";
import { afterEach, describe, expect, test } from "vitest";
import { loadProject, prepareProject, validateProject } from "../src/index.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

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
  cpSync(
    firstPartyPackRoot,
    join(directory, "node_modules", "@atlante", "pack"),
    { recursive: true },
  );
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({
      name: "atlante-builder-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
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
    expect(loaded.resources?.templates.length).toBeGreaterThan(0);
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
    expect(loaded.resources).toBeUndefined();
    expect(loaded.diagnostics[0]?.code).toBe("ambiguous-config");
  });

  test("reports package preset expansion failures", () => {
    const { directory } = project(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "@atlante/pack/missing",
      "agents": {}
    }`);

    const loaded = loadProject(directory);

    expect(loaded.document).toBeUndefined();
    expect(loaded.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-package-subpath" }),
      ]),
    );
  });
});

describe("validateProject", () => {
  test("validates without rendering template source", () => {
    const { directory } = project(`{
      "$schema": "${SCHEMA_URI}",
      "agents": {
        "reviewer": {
          "description": "Reviews changes.",
          "$template": "./agent",
          "identity": "You review."
        }
      }
    }`);
    const resourceDirectory = join(directory, "agent");
    mkdirSync(resourceDirectory);
    writeFileSync(
      join(resourceDirectory, "template.jsonc"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { identity: { type: "string" } },
        required: ["identity"],
        additionalProperties: false,
      }),
    );
    // Validation must not render source; rendering remains a T7 concern.
    writeFileSync(join(resourceDirectory, "template.md"), "{{#if");

    const validated = validateProject(directory);

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
    expect(prepared.agents[0]?.templateId).toBe("@atlante/pack/agent");
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
