import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";
import {
  loadDocument,
  parseDocumentOverlay,
  sortDiagnostics,
  validateDocumentText,
} from "../src/index.js";

const valid = `{
  // a comment, because this is JSONC
  "$schema": "${SCHEMA_URI}",
   "agents": { "reviewer": { "description": "Agent", "identity": "x", "mission": "y" } }
}`;

describe("validateDocumentText", () => {
  test("accepts a JSONC document with comments", () => {
    const result = validateDocumentText(valid, "atlante.jsonc");
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.agents?.reviewer?.identity).toBe("x");
  });

  test("accepts a strict JSON document, per acceptance criterion 1", () => {
    const strict = JSON.stringify({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: { description: "Agent", identity: "x", mission: "y" },
      },
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

  test("sanitizes unsupported $schema diagnostics", () => {
    const rawSchema = "/private/user/project/secret-schema.json";
    const result = validateDocumentText(
      `{ "$schema": ${JSON.stringify(rawSchema)} }`,
      "/private/user/project/atlante.jsonc",
    );
    const diagnostic = result.diagnostics[0];

    expect(diagnostic).toEqual({
      severity: "error",
      code: "unsupported-schema",
      message:
        "atlante.jsonc: unsupported $schema; expected the Atlante document schema",
      path: "/$schema",
      pointer: "/$schema",
      source: "atlante.jsonc",
      location: { line: 1, column: 14 },
    });
    expect(JSON.stringify(diagnostic)).not.toContain(rawSchema);
    expect(JSON.stringify(diagnostic)).not.toContain("/private/user/project");
  });

  test("routes text validation through resource resolution and semantic validation", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-document-text-"));
    const sourcePath = join(root, "atlante.jsonc");
    const base = join(root, "base");
    const derived = join(root, "derived");
    mkdirSync(base);
    mkdirSync(derived);
    writeFileSync(
      join(base, "atlante.jsonc"),
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          inherited: {
            description: "Inherited",
            identity: "Base identity",
            mission: "Base mission",
          },
        },
      }),
    );
    writeFileSync(
      join(derived, "instance.jsonc"),
      JSON.stringify({
        $template: "atlante/agent",
        identity: "Derived identity",
        mission: "Derived mission",
      }),
    );

    try {
      const result = validateDocumentText(
        JSON.stringify({
          $schema: SCHEMA_URI,
          extends: "./base",
          agents: {
            derived: { $instance: "./derived", description: "Derived" },
          },
        }),
        sourcePath,
      );

      expect(result.diagnostics).toEqual([]);
      expect(result.document?.agents).toHaveProperty("inherited");
      expect(result.document?.agents).toHaveProperty("derived");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects unknown system values instead of accepting structurally valid text", () => {
    const result = validateDocumentText(
      `{ "$schema": "${SCHEMA_URI}", "values": { "unknown": "{{sys.not-real}}" } }`,
      "atlante.jsonc",
    );

    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unknown-system-variable",
        path: "/values/unknown",
        pointer: "/values/unknown",
        source: "atlante.jsonc",
      }),
    );
  });

  test("accepts a document without agents or skills and normalizes both maps", () => {
    const result = validateDocumentText(
      `{ "$schema": "${SCHEMA_URI}" }`,
      "atlante.jsonc",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.agents).toEqual({});
    expect(result.document?.skills).toEqual({});
  });

  test("accepts a skill-only document", () => {
    const result = validateDocumentText(
      `{ "$schema": "${SCHEMA_URI}", "skills": { "testing": { "description": "Run tests", "title": "Testing", "overview": "Run tests.", "sections": [{ "markdown": "Run tests." }] } } }`,
      "atlante.jsonc",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.agents).toEqual({});
    expect(result.document?.skills?.testing?.description).toBe("Run tests");
  });

  test("rejects an unknown root field and names its path", () => {
    const text = `{ "$schema": "${SCHEMA_URI}", "agents": {}, "rules": [] }`;
    const result = validateDocumentText(text, "atlante.jsonc");
    expect(result.diagnostics[0]?.code).toBe("invalid-document");
    expect(result.diagnostics[0]?.message).toContain("rules");
  });

  test("sorts validateDocumentText diagnostics independently of input order", () => {
    const result = validateDocumentText(
      `{
        "$schema": "${SCHEMA_URI}",
        "values": { "count": 1 },
        "agents": { "reviewer": { "template": "atlante/agent", "description": "Review" } }
      }`,
      "atlante.jsonc",
    );

    expect(result.diagnostics.map(({ path }) => path)).toEqual([
      "/agents/reviewer/template",
      "/values/count",
    ]);
  });

  test("round-trips dangerous-looking JSONC keys without prototype pollution", () => {
    const result = validateDocumentText(
      `{
        "$schema": "${SCHEMA_URI}",
        "values": { "__proto__": "safe" },
        "agents": { "__proto__": { "description": "Agent", "identity": "x", "mission": "y" } }
      }`,
      "atlante.jsonc",
    );

    expect(result.diagnostics).toEqual([]);
    if (!result.document) throw new Error("document missing");
    expect(Object.hasOwn(result.document.values ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(result.document.agents ?? {}, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("requires an own root $schema instead of accepting a nested __proto__ value", () => {
    const result = validateDocumentText(
      `{"__proto__":{"$schema":"${SCHEMA_URI}"}}`,
      "atlante.jsonc",
    );

    expect(result.document).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("unsupported-schema");
  });

  test("rejects values that are not an object", () => {
    const text = `{ "$schema": "${SCHEMA_URI}", "agents": {}, "values": 1 }`;
    const result = validateDocumentText(text, "atlante.jsonc");
    expect(result.diagnostics[0]?.code).toBe("invalid-document");
  });

  test("accepts a valid root skills map", () => {
    const result = validateDocumentText(
      `{ "$schema": "${SCHEMA_URI}", "agents": {}, "skills": { "testing": { "description": "Run tests", "title": "Testing", "overview": "Run tests.", "sections": [{ "markdown": "Run tests." }] } } }`,
      "atlante.jsonc",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.skills?.testing?.description).toBe("Run tests");
  });

  test("accepts agent and skill bindings together", () => {
    const result = validateDocumentText(
      `{ "$schema": "${SCHEMA_URI}", "agents": { "reviewer": { "description": "Agent", "identity": "x", "mission": "y" } }, "skills": { "testing": { "description": "Run tests", "title": "Testing", "overview": "Run tests.", "sections": [{ "markdown": "Run tests." }] } } }`,
      "atlante.jsonc",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.document?.agents?.reviewer?.mission).toBe("y");
    expect(result.document?.skills?.testing?.title).toBe("Testing");
  });

  test("rejects invalid raw overlays before resource resolution", () => {
    const text = `{
      "$schema": "${SCHEMA_URI}",
      "values": { "count": 1 },
      "agents": { "reviewer": { "template": "atlante/agent" } }
    }`;
    const parsed = parseDocumentOverlay(text, "atlante.jsonc");

    expect(parsed.overlay).toBeUndefined();
    expect(parsed.diagnostics.map(({ path }) => path)).toEqual([
      "/agents/reviewer/template",
      "/values/count",
    ]);
    expect(
      parsed.diagnostics.every(({ source }) => source === "atlante.jsonc"),
    ).toBe(true);
    expect(
      parsed.diagnostics.every(
        ({ location }) => location?.line === 4 || location?.line === 3,
      ),
    ).toBe(true);

    expect(parsed.diagnostics).toHaveLength(2);
    expect(JSON.stringify(parsed.diagnostics)).not.toContain("atlante/agent");
  });
});

describe("diagnostic ordering", () => {
  test("sorts by source, pointer, location, and code using code-unit order", () => {
    const diagnostics = sortDiagnostics([
      {
        severity: "error",
        code: "a",
        message: "lowercase code",
        source: "Z-source",
        path: "/z",
        location: { line: 2, column: 1 },
      },
      {
        severity: "error",
        code: "Z",
        message: "uppercase code",
        source: "a-source",
        path: "/z",
        location: { line: 2, column: 1 },
      },
      {
        severity: "error",
        code: "b",
        message: "later pointer",
        source: "a-source",
        path: "/z",
        location: { line: 3, column: 1 },
      },
      {
        severity: "error",
        code: "c",
        message: "earlier pointer",
        source: "a-source",
        path: "/a",
        location: { line: 9, column: 1 },
      },
    ]);

    expect(
      diagnostics.map(({ source, path, location, code }) => [
        source,
        path,
        location?.line,
        code,
      ]),
    ).toEqual([
      ["Z-source", "/z", 2, "a"],
      ["a-source", "/a", 9, "c"],
      ["a-source", "/z", 2, "Z"],
      ["a-source", "/z", 3, "b"],
    ]);
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
      expect(result.document?.agents?.reviewer?.identity).toBe("x");
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
    const root = mkdtempSync(join(tmpdir(), "atlante-document-unreadable-"));
    try {
      const result = loadDocument(join(root, "atlante.jsonc"), {
        statSync: () => {
          throw new Error("injected stat failure");
        },
      });
      expect(result.document).toBeUndefined();
      expect(result.diagnostics[0]?.code).toBe("config-unreadable");
      expect(result.diagnostics[0]?.message).toBe(
        "cannot inspect atlante.jsonc: configuration target is unreadable",
      );
      expect(JSON.stringify(result.diagnostics)).not.toContain(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("normalizes explicit and discovered paths before resource resolution", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-document-relative-"));
    const previous = process.cwd();
    writeFileSync(
      join(root, "atlante.jsonc"),
      `{ "$schema": "${SCHEMA_URI}" }`,
    );
    try {
      process.chdir(root);
      const explicit = loadDocument("atlante.jsonc");
      const discovered = loadDocument(".");

      expect(explicit.path).toBeDefined();
      expect(explicit.path && isAbsolute(explicit.path)).toBe(true);
      expect(explicit.projectRoot && isAbsolute(explicit.projectRoot)).toBe(
        true,
      );
      expect(discovered.path).toBe(explicit.path);
      expect(discovered.projectRoot).toBe(explicit.projectRoot);
    } finally {
      process.chdir(previous);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
