import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVAL_SCENARIO_SCHEMA_URI, SCHEMA_URI } from "@atlante/schema";
import {
  generateDocumentationCatalog,
  loadDocumentationCatalog,
  readDocumentation,
  searchDocumentation,
} from "../src/mcp/catalog.js";
import { getBundledSchema } from "../src/mcp/schema.js";

const created: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-mcp-catalog-"));
  created.push(root);
  mkdirSync(join(root, "docs", "src", "content", "docs", "guides"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "docs", "src", "content", "docs", "introduction.md"),
    `---
title: Introduction
description: Learn the Atlante workflow.
---

Atlante keeps configuration deterministic.

## Build a harness

Build a harness from a validated configuration.

### Repeatable output

The output is repeatable.
`,
  );
  writeFileSync(
    join(root, "docs", "src", "content", "docs", "guides", "mcp.md"),
    `---
title: MCP
---

Use the offline MCP server.
`,
  );
  writeFileSync(
    join(root, "SPECIFICATION.md"),
    `# Atlante Specification

## Contract

The specification defines a validated configuration contract.
`,
  );
  return root;
}

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { force: true, recursive: true });
});

describe("documentation catalog", () => {
  test("generates stable documents, headings, sections, and source hash", () => {
    const root = fixtureRoot();
    const catalog = generateDocumentationCatalog(root);

    expect(catalog.schema_version).toBe("atlante-docs/v1");
    expect(catalog.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(catalog.documents.map(({ id }) => id)).toEqual([
      "guides/mcp",
      "introduction",
      "specification",
    ]);
    expect(catalog.documents[1]).toMatchObject({
      id: "introduction",
      kind: "documentation",
      title: "Introduction",
      description: "Learn the Atlante workflow.",
      source_url: "https://docs.atlante.sh/introduction",
    });
    expect(catalog.documents[1]?.headings).toEqual([
      { id: "build-a-harness", level: 2, title: "Build a harness" },
      { id: "repeatable-output", level: 3, title: "Repeatable output" },
    ]);
  });

  test("searches deterministically and reads known sections", () => {
    const catalog = generateDocumentationCatalog(fixtureRoot());
    expect(searchDocumentation(catalog, "Introduction")[0]).toMatchObject({
      document_id: "introduction",
    });
    const matches = searchDocumentation(catalog, "validated configuration", {
      limit: 10,
    });

    expect(
      matches.map(({ document_id, section_id }) => [document_id, section_id]),
    ).toEqual([
      ["introduction", "build-a-harness"],
      ["specification", "contract"],
    ]);
    expect(matches[0]).toMatchObject({
      source_kind: "documentation",
      title: "Introduction",
      heading: "Build a harness",
    });
    expect(matches[0]?.excerpt).toContain("validated configuration");

    const section = readDocumentation(
      catalog,
      "introduction",
      "build-a-harness",
      2048,
    );
    expect(section).toMatchObject({
      status: "ok",
      document_id: "introduction",
      section_id: "build-a-harness",
    });
    if (section.status === "ok")
      expect(section.content).toContain("Repeatable output");
  });

  test("returns structured diagnostics for unknown or oversized reads", () => {
    const catalog = generateDocumentationCatalog(fixtureRoot());
    expect(readDocumentation(catalog, "missing").diagnostic?.code).toBe(
      "doc-not-found",
    );
    expect(
      readDocumentation(catalog, "introduction", undefined, 8).diagnostic?.code,
    ).toBe("doc-response-too-large");
  });

  test("loads a source-tree catalog when no bundled artifact is present", () => {
    const loaded = loadDocumentationCatalog(fixtureRoot());
    expect(loaded).toMatchObject({ status: "available" });
    if (loaded.status === "available")
      expect(loaded.catalog.documents.map(({ id }) => id)).toContain(
        "specification",
      );
  });
});

describe("bundled schemas", () => {
  test("returns supported schemas and rejects unknown schema URIs", () => {
    expect(getBundledSchema(SCHEMA_URI)).toMatchObject({
      status: "ok",
      uri: SCHEMA_URI,
    });
    expect(
      getBundledSchema("https://atlante.sh/schema/v9/schema.json"),
    ).toEqual(
      expect.objectContaining({
        status: "diagnostic",
        diagnostic: expect.objectContaining({ code: "schema-not-supported" }),
      }),
    );
    expect(getBundledSchema(EVAL_SCENARIO_SCHEMA_URI)).toMatchObject({
      status: "ok",
      uri: EVAL_SCENARIO_SCHEMA_URI,
    });
  });
});
