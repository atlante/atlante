import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";
import { loadDocument, validateDocumentText } from "../src/index.js";

const valid = `{
  // a comment, because this is JSONC
  "$schema": "${SCHEMA_URI}",
  "agents": { "reviewer": { "identity": "x", "mission": "y" } }
}`;

describe("validateDocumentText", () => {
  test("accepts a JSONC document with comments", () => {
    const result = validateDocumentText(valid, "atlante.jsonc");
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.agents.reviewer?.identity).toBe("x");
  });

  test("accepts a strict JSON document, per acceptance criterion 1", () => {
    const strict = JSON.stringify({
      $schema: SCHEMA_URI,
      agents: { reviewer: { identity: "x", mission: "y" } },
    });
    const result = validateDocumentText(strict, "atlante.json");
    expect(result.diagnostics).toEqual([]);
    expect(result.document).toBeDefined();
  });

  test("rejects comments and trailing commas in atlante.json", () => {
    const result = validateDocumentText(
      `{
        // comments belong only in JSONC
        "$schema": "${SCHEMA_URI}",
        "agents": {},
      }`,
      "atlante.json",
    );
    expect(result.document).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("invalid-json");
  });

  test("rejects explicit config paths with non-canonical basenames", () => {
    const result = validateDocumentText("{}", "project-config.jsonc");
    expect(result.document).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("invalid-config-filename");
  });

  test("rejects malformed JSON with a position", () => {
    const result = validateDocumentText("{ nope", "atlante.jsonc");
    expect(result.document).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("invalid-json");
    expect(result.diagnostics[0]?.location?.line).toBeGreaterThan(0);
  });

  test("rejects an unsupported $schema URI", () => {
    const text = valid.replace(
      SCHEMA_URI,
      "https://atlante.sh/schema/v9/x.json",
    );
    const result = validateDocumentText(text, "atlante.jsonc");
    expect(result.diagnostics[0]?.code).toBe("unsupported-schema");
  });

  test("rejects a missing agents object", () => {
    const result = validateDocumentText(
      `{ "$schema": "${SCHEMA_URI}" }`,
      "atlante.jsonc",
    );
    expect(result.diagnostics[0]?.code).toBe("invalid-document");
  });

  test("rejects an unknown root field and names its path", () => {
    const text = `{ "$schema": "${SCHEMA_URI}", "agents": {}, "rules": [] }`;
    const result = validateDocumentText(text, "atlante.jsonc");
    expect(result.diagnostics[0]?.code).toBe("invalid-document");
    expect(result.diagnostics[0]?.message).toContain("rules");
  });

  test("rejects values that are not an object", () => {
    const text = `{ "$schema": "${SCHEMA_URI}", "agents": {}, "values": 1 }`;
    const result = validateDocumentText(text, "atlante.jsonc");
    expect(result.diagnostics[0]?.code).toBe("invalid-document");
  });
});

describe("loadDocument", () => {
  test("loads an explicit file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlante-document-"));
    const path = join(dir, "atlante.jsonc");
    writeFileSync(path, valid);
    try {
      const result = loadDocument(path);
      expect(result.path).toBe(path);
      expect(result.diagnostics).toEqual([]);
      expect(result.document?.agents.reviewer?.identity).toBe("x");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects an explicit file path with a non-canonical basename", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlante-document-"));
    const path = join(dir, "config.jsonc");
    writeFileSync(path, valid);
    try {
      const result = loadDocument(path);
      expect(result.document).toBeUndefined();
      expect(result.diagnostics[0]?.code).toBe("invalid-config-filename");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("turns a stat failure into a diagnostic", () => {
    const result = loadDocument("/unreadable/config", {
      statSync: () => {
        throw new Error("injected stat failure");
      },
    });
    expect(result.document).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("config-unreadable");
    expect(result.diagnostics[0]?.message).toContain("injected stat failure");
  });
});
