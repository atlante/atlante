import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listPresets, readPreset } from "@atlante/presets";
import { SCHEMA_URI } from "@atlante/schema";
import {
  expandDocument,
  parseDocumentOverlay,
  validateDocumentText,
} from "@atlante/validator";
import { loadCliResources } from "../src/commands/load.js";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("bundled presets as user configurations", () => {
  test("every preset validates against the same schema as a user config", () => {
    for (const id of listPresets().presets) {
      const source = readPreset(id);
      if (!source) throw new Error(`preset ${id} missing`);
      const { document, diagnostics } = validateDocumentText(
        source,
        `${id}/atlante.jsonc`,
      );
      expect(diagnostics).toEqual([]);
      expect(document).toBeDefined();
    }
  });

  test("CLI loading returns a canonical document and bundled skill template", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlante-cli-preset-"));
    created.push(dir);
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "agents": {
          "reviewer": { "description": "Reviews changes.", "identity": "Review", "mission": "Find defects" }
        },
        "skills": {
          "testing": { "description": "Testing guidance", "content": "Run tests." }
        }
      }`,
    );

    const loaded = loadCliResources(dir);

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.document?.skills?.testing?.description).toBe(
      "Testing guidance",
    );
    expect(loaded.registry?.get("atlante/skill")).toBeDefined();
  });

  test("expands inherited preset skills through the shared overlay path", () => {
    const source = `{
      "$schema": "${SCHEMA_URI}",
      "extends": "atlante/with-skills",
      "agents": {}
    }`;
    const parsed = parseDocumentOverlay(source, "project/atlante.jsonc");
    expect(parsed.diagnostics).toEqual([]);
    if (!parsed.overlay) throw new Error("expected a valid overlay");

    const expanded = expandDocument(parsed.overlay, {
      load(id) {
        expect(id).toBe("atlante/with-skills");
        return {
          document: {
            $schema: SCHEMA_URI,
            agents: {},
            skills: {
              inherited: {
                description: "Inherited guidance",
                content: "Use tests.",
              },
            },
          },
          diagnostics: [],
        };
      },
    });

    expect(expanded.diagnostics).toEqual([]);
    expect(expanded.document?.skills?.inherited?.description).toBe(
      "Inherited guidance",
    );
    expect(expanded.document?.skills?.inherited?.content).toBe("Use tests.");
  });
});
