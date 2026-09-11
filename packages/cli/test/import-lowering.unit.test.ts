import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  renderResolvedTemplate,
  resolveResourceTemplate,
} from "@atlante/resources";
import type { MarkdownBlockContent } from "@atlante/schema";
import type { Root } from "mdast";
import {
  firstPartyFacetInputSchemas,
  lowerToAtlanteAst,
  mapFrontmatter,
  parseMarkdownSource,
  planLocalPack,
  sanitizeResourceId,
  validateImportedInputs,
  writeLocalPack,
} from "../src/commands/import-internal.js";
import { resolveFirstPartyPack } from "../src/first-party-pack.js";

function lower(source: string, path = "source.md") {
  const parsed = parseMarkdownSource(source, path);
  expect(parsed.diagnostics).toEqual([]);
  return lowerToAtlanteAst(parsed.tree, path);
}

describe("Markdown importer lowering", () => {
  test("parses YAML frontmatter while retaining source positions", () => {
    const parsed = parseMarkdownSource(
      "---\ntitle: Example\noverview: Overview\ndescription: Description\n---\n\n# Hello",
      "example.md",
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.frontmatter).toEqual({
      description: "Description",
      overview: "Overview",
      title: "Example",
    });
    expect(parsed.frontmatterLocation).toEqual({ line: 1, column: 1 });
    expect(parsed.tree.children[0]?.type).toBe("yaml");
    expect(parsed.tree.children[1]?.position?.start).toEqual({
      line: 7,
      column: 1,
      offset: 68,
    });
  });

  test("reports malformed YAML with a source-aware diagnostic", () => {
    const parsed = parseMarkdownSource(
      "---\ntitle: [\n---\n\nBody",
      "invalid.md",
    );

    expect(parsed.frontmatter).toEqual({});
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid-frontmatter",
        source: "invalid.md",
        location: { line: 2, column: 9 },
      }),
    ]);
  });

  test("parses YAML frontmatter with bare CR line endings", () => {
    const parsed = parseMarkdownSource(
      "---\rtitle: Example\roverview: Overview\rdescription: Description\r---\r\nBody",
      "bare-cr.md",
    );

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.frontmatter).toEqual({
      description: "Description",
      overview: "Overview",
      title: "Example",
    });
  });

  test("lowers headings, paragraphs, and inline phrasing", () => {
    const lowered = lower(
      '# Hello\n\nRun *em* **strong** `code` [link](/docs "Docs") ![alt](/image "Image")  \nnext ~~old~~.',
    );

    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.ast).toEqual([
      {
        type: "heading",
        depth: 1,
        children: [{ type: "text", value: "Hello" }],
      },
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Run " },
          { type: "emphasis", children: [{ type: "text", value: "em" }] },
          { type: "text", value: " " },
          {
            type: "strong",
            children: [{ type: "text", value: "strong" }],
          },
          { type: "text", value: " " },
          { type: "inlineCode", value: "code" },
          { type: "text", value: " " },
          {
            type: "link",
            url: "/docs",
            title: "Docs",
            children: [{ type: "text", value: "link" }],
          },
          { type: "text", value: " " },
          { type: "image", url: "/image", alt: "alt", title: "Image" },
          { type: "break" },
          { type: "text", value: "next " },
          { type: "delete", children: [{ type: "text", value: "old" }] },
          { type: "text", value: "." },
        ],
      },
    ]);
  });

  test("lowers code, blockquotes, and thematic breaks", () => {
    expect(
      lower("> A quote\n>\n> ```ts options\n> const value = 1;\n> ```\n\n---")
        .ast,
    ).toEqual([
      {
        type: "blockquote",
        children: [
          { type: "paragraph", children: [{ type: "text", value: "A quote" }] },
          {
            type: "code",
            lang: "ts",
            meta: "options",
            value: "const value = 1;",
          },
        ],
      },
      { type: "thematicBreak" },
    ]);
    expect(lower("    const value = 1;").ast).toEqual([
      { type: "code", value: "const value = 1;" },
    ]);
  });

  test("lowers nested ordered, unordered, and task lists", () => {
    const lowered = lower(
      "- [x] done\n  - nested\n- [ ] todo\n\n3. third\n4. fourth",
    );

    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.ast).toEqual([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            checked: true,
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "done" }],
              },
              {
                type: "list",
                ordered: false,
                children: [
                  {
                    type: "listItem",
                    children: [
                      {
                        type: "paragraph",
                        children: [{ type: "text", value: "nested" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            type: "listItem",
            checked: false,
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "todo" }],
              },
            ],
          },
        ],
      },
      {
        type: "list",
        ordered: true,
        start: 3,
        children: [
          {
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "third" }],
              },
            ],
          },
          {
            type: "listItem",
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "fourth" }],
              },
            ],
          },
        ],
      },
    ]);

    expect(lower("1. first\n2. second").ast[0]).toEqual({
      type: "list",
      ordered: true,
      children: [
        {
          type: "listItem",
          children: [
            { type: "paragraph", children: [{ type: "text", value: "first" }] },
          ],
        },
        {
          type: "listItem",
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", value: "second" }],
            },
          ],
        },
      ],
    });
  });

  test("lowers GFM tables and preserves column alignment", () => {
    expect(
      lower(
        "| Left | Center | Right |\n| :--- | :----: | ---: |\n| a | b | c |",
      ).ast,
    ).toEqual([
      {
        type: "table",
        align: ["left", "center", "right"],
        children: [
          {
            type: "tableRow",
            children: [
              {
                type: "tableCell",
                children: [{ type: "text", value: "Left" }],
              },
              {
                type: "tableCell",
                children: [{ type: "text", value: "Center" }],
              },
              {
                type: "tableCell",
                children: [{ type: "text", value: "Right" }],
              },
            ],
          },
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [{ type: "text", value: "a" }] },
              { type: "tableCell", children: [{ type: "text", value: "b" }] },
              { type: "tableCell", children: [{ type: "text", value: "c" }] },
            ],
          },
        ],
      },
    ]);
  });

  test("resolves case-insensitive references and keeps the first definition", () => {
    const lowered = lower(
      'See [docs][DOCS] and ![logo][docs].\n\n[Docs]: /first "Docs"\n[docs]: /second',
    );

    expect(lowered.diagnostics).toEqual([]);
    expect(lowered.ast).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "text", value: "See " },
          {
            type: "link",
            url: "/first",
            title: "Docs",
            children: [{ type: "text", value: "docs" }],
          },
          { type: "text", value: " and " },
          { type: "image", url: "/first", alt: "logo", title: "Docs" },
          { type: "text", value: "." },
        ],
      },
    ]);

    expect(lower("[docs][] [docs]\n\n[Docs]: /docs").ast).toEqual([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: "/docs",
            children: [{ type: "text", value: "docs" }],
          },
          { type: "text", value: " " },
          {
            type: "link",
            url: "/docs",
            children: [{ type: "text", value: "docs" }],
          },
        ],
      },
    ]);
  });

  test("reports unresolved references with the reference source location", () => {
    const lowered = lower("[missing][target]\n\n![image][missing]", "refs.md");

    expect(lowered.ast).toEqual([
      {
        type: "paragraph",
        children: [{ type: "text", value: "[missing][target]" }],
      },
      {
        type: "paragraph",
        children: [{ type: "text", value: "![image][missing]" }],
      },
    ]);
    expect(lowered.diagnostics).toEqual([
      expect.objectContaining({
        code: "unresolved-reference",
        source: "refs.md",
        location: { line: 1, column: 1 },
      }),
      expect.objectContaining({
        code: "unresolved-reference",
        source: "refs.md",
        location: { line: 3, column: 1 },
      }),
    ]);
  });

  test("finds unresolved nested and multiline link and image references", () => {
    const lowered = lower(
      "[a [b]][missing]\n\n![a\nb][missing-image]",
      "nested-refs.md",
    );

    expect(lowered.diagnostics).toEqual([
      expect.objectContaining({
        code: "unresolved-reference",
        source: "nested-refs.md",
        location: { line: 1, column: 1 },
      }),
      expect.objectContaining({
        code: "unresolved-reference",
        source: "nested-refs.md",
        location: { line: 3, column: 1 },
      }),
    ]);

    expect(
      lower(
        "[a [b]][target]\n\n![a\nb][image]\n\n[target]: /target\n[image]: /image",
      ).diagnostics,
    ).toEqual([]);

    expect(
      lower("[a *b*][missing]\n\n![a *b*][missing-image]", "formatted-refs.md")
        .diagnostics,
    ).toEqual([
      expect.objectContaining({
        code: "unresolved-reference",
        source: "formatted-refs.md",
        location: { line: 1, column: 1 },
      }),
      expect.objectContaining({
        code: "unresolved-reference",
        source: "formatted-refs.md",
        location: { line: 3, column: 1 },
      }),
    ]);

    expect(
      lower(
        "[outer [literal][missing]](/url) and <https://example.com/[missing]> and `[code][missing]`",
      ).diagnostics,
    ).toEqual([]);
  });

  test("reports correct locations for unresolved references in CR-only input", () => {
    const lowered = lower(
      "before\r\r[missing][target]\r\r![image][missing-image]",
      "cr-only.md",
    );

    expect(lowered.diagnostics).toEqual([
      expect.objectContaining({
        code: "unresolved-reference",
        source: "cr-only.md",
        location: { line: 3, column: 1 },
      }),
      expect.objectContaining({
        code: "unresolved-reference",
        source: "cr-only.md",
        location: { line: 5, column: 1 },
      }),
    ]);
  });

  test("strips parser-only fields and consumes definitions and frontmatter", () => {
    const parsed = parseMarkdownSource(
      "---\ntitle: Title\n---\n\n[link][ref]\n\n[ref]: /url",
      "fields.md",
    );
    const lowered = lowerToAtlanteAst(parsed.tree, "fields.md");
    expect(lowered.diagnostics).toEqual([]);
    expect(JSON.stringify(lowered.ast)).not.toContain("position");
    expect(JSON.stringify(lowered.ast)).not.toContain("identifier");
    expect(JSON.stringify(lowered.ast)).not.toContain("spread");
    expect(lowered.ast).toEqual([
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            url: "/url",
            children: [{ type: "text", value: "link" }],
          },
        ],
      },
    ]);
  });

  test("round-trips a normalized CommonMark and GFM corpus", () => {
    const parsed = parseMarkdownSource(
      "# Heading\n\nRun *em* **strong** `code` [link](/docs) ![alt](/image)  \nnext ~~old~~.\n\n- [x] done\n  - nested\n\n3. third\n4. fourth\n\n| Left | Center | Right |\n| :--- | :----: | ---: |\n| a | b | c |",
      "round-trip.md",
    );
    const lowered = lowerToAtlanteAst(parsed.tree, "round-trip.md");
    expect(lowered.diagnostics).toEqual([]);

    const pack = resolveFirstPartyPack();
    const rendered = renderResolvedTemplate({
      template: resolveResourceTemplate(
        pack,
        "@atlante/pack/markdown",
        join(pack.root, "package.json"),
      ),
      input: lowered.ast,
    });
    const reparsed = parseMarkdownSource(rendered, "rendered.md");
    const relowered = lowerToAtlanteAst(reparsed.tree, "rendered.md");

    expect(reparsed.diagnostics).toEqual([]);
    expect(relowered.diagnostics).toEqual([]);
    expect(relowered.ast).toEqual(lowered.ast);
  });

  test("fails closed for HTML and footnotes with source-aware diagnostics", () => {
    const html = lower("before\n\n<span>raw</span>", "html.md");
    expect(html.diagnostics).toHaveLength(2);
    expect(html.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unsupported-markdown",
        source: "html.md",
        location: { line: 3, column: 1 },
      }),
    );

    const footnotes = lower(
      "note[^one]\n\n[^one]: [missing][target]",
      "footnote.md",
    );
    expect(footnotes.diagnostics).toHaveLength(2);
    expect(
      footnotes.diagnostics.some(
        (diagnostic) => diagnostic.code === "unresolved-reference",
      ),
    ).toBe(false);
    expect(
      footnotes.diagnostics.every(
        (diagnostic) => diagnostic.severity === "error",
      ),
    ).toBe(true);
    expect(
      footnotes.diagnostics.map((diagnostic) => diagnostic.location),
    ).toEqual([
      { line: 1, column: 5 },
      { line: 3, column: 1 },
    ]);
  });

  test("fails closed for an unknown node type", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "futureNode",
          position: {
            start: { line: 4, column: 2 },
            end: { line: 4, column: 8 },
          },
        },
      ],
    } as unknown as Root;
    const lowered = lowerToAtlanteAst(tree, "future.md");

    expect(lowered.ast).toEqual([]);
    expect(lowered.diagnostics).toEqual([
      expect.objectContaining({
        code: "unsupported-markdown",
        message: 'unsupported Markdown node type "futureNode"',
        source: "future.md",
        location: { line: 4, column: 2 },
      }),
    ]);
  });

  test("maps only metadata supported by the selected kind", () => {
    const mapped = mapFrontmatter(
      {
        description: "Description",
        identity: "Agent identity",
        name: "My Skill",
        overview: "Overview",
        title: "Title",
      },
      "skill",
      "skill.md",
      { line: 1, column: 1 },
    );

    expect(mapped.metadata).toEqual({
      description: "Description",
      id: "my-skill",
      overview: "Overview",
      title: "Title",
    });
    expect(mapped.diagnostics).toHaveLength(1);
    expect(mapped.diagnostics[0]?.message).toContain('"identity"');
    expect(mapped.diagnostics[0]?.severity).toBe("warning");

    expect(
      mapFrontmatter(
        {
          description: "Description",
          identity: "Identity",
          mission: "Mission",
          name: "Agent Name",
        },
        "agent",
      ),
    ).toEqual({
      metadata: {
        description: "Description",
        id: "agent-name",
        identity: "Identity",
        mission: "Mission",
      },
      diagnostics: [],
    });
  });

  test("reports unknown and missing metadata without inferring values", () => {
    const mapped = mapFrontmatter(
      { model: "gpt", title: "" },
      "skill",
      "missing.md",
      { line: 1, column: 1 },
    );

    expect(
      mapped.diagnostics.filter(({ severity }) => severity === "warning"),
    ).toHaveLength(1);
    expect(
      mapped.diagnostics.filter(({ code }) => code === "missing-metadata"),
    ).toHaveLength(3);
    expect(
      mapped.diagnostics.filter(({ code }) => code === "missing-metadata")[0]
        ?.message,
    ).toContain('"title"');
    expect(
      mapped.diagnostics.filter(({ code }) => code === "missing-metadata"),
    ).toContainEqual(
      expect.objectContaining({
        location: { line: 1, column: 1 },
        source: "missing.md",
      }),
    );

    expect(mapFrontmatter({}, "skill").diagnostics).toHaveLength(3);
    expect(mapFrontmatter({}, "agent").diagnostics).toHaveLength(3);
    expect(
      mapFrontmatter(
        { description: 42, identity: "identity", mission: "mission" },
        "agent",
      ).diagnostics,
    ).toEqual([
      expect.objectContaining({
        code: "invalid-frontmatter-value",
        message: 'frontmatter key "description" must be a string',
      }),
    ]);
  });

  test("sanitizes explicit identifiers and rejects punctuation-only names", () => {
    expect(sanitizeResourceId(" My Skill_v2 ")).toBe("my-skill-v2");
    expect(sanitizeResourceId("!!!")).toBeUndefined();
    expect(sanitizeResourceId("a".repeat(65))).toBeUndefined();
    expect(sanitizeResourceId("a".repeat(64))).toBe("a".repeat(64));
  });

  test("uses validator-owned schemas for AST and instance validation", () => {
    const metadata = {
      description: "Description",
      overview: "Overview",
      title: "Title",
    };
    const ast: MarkdownBlockContent[] = [
      { type: "paragraph", children: [{ type: "text", value: "Body" }] },
    ];

    expect(
      validateImportedInputs(
        metadata,
        ast,
        "skill",
        firstPartyFacetInputSchemas(),
      ),
    ).toEqual([]);
    expect(
      validateImportedInputs(
        metadata,
        [{ type: "future" } as unknown as MarkdownBlockContent],
        "skill",
        firstPartyFacetInputSchemas(),
      ).map(({ code }) => code),
    ).toContain("invalid-prompt-input");
  });

  test("plans deterministic source files for skills and agents", () => {
    const input = {
      outputDirectory: "/tmp/imported",
      id: "example",
      kind: "skill" as const,
      metadata: {
        description: "Description",
        id: "example",
        overview: "Overview",
        title: "Title",
      },
      ast: [{ type: "paragraph", children: [{ type: "text", value: "Body" }] }],
      packVersion: "0.2.2",
    };
    const first = planLocalPack(input);
    const second = planLocalPack(input);
    expect(first).toEqual(second);
    expect(first.files.map(({ path }) => path)).toEqual([
      "/tmp/imported/package.json",
      "/tmp/imported/atlante.jsonc",
      "/tmp/imported/example/instance.jsonc",
    ]);
    expect(JSON.parse(first.files[0]?.contents ?? "{}")).toEqual({
      name: "example",
      version: "0.0.0",
      atlante: { format: 1 },
      dependencies: { "@atlante/pack": "0.2.2" },
    });
  });

  test("removes staged files when a pack write fails", () => {
    const plan = planLocalPack({
      outputDirectory: "/tmp/imported",
      id: "example",
      kind: "skill",
      metadata: {
        description: "Description",
        overview: "Overview",
        title: "Title",
      },
      ast: [{ type: "paragraph", children: [{ type: "text", value: "Body" }] }],
      packVersion: "0.2.2",
    });
    const removed: string[] = [];
    let writes = 0;
    const result = writeLocalPack(plan, {
      existsSync: () => false,
      readFileSync: () => "",
      mkdtempSync: () => "/tmp/imported.tmp",
      mkdirSync: () => undefined,
      renameSync: () => undefined,
      writeFileSync: () => {
        writes++;
        if (writes === 2) throw new Error("disk full");
      },
      rmSync: (path) => removed.push(path),
    });

    expect(result.writtenPaths).toEqual([]);
    expect(result.error).toBe("disk full");
    expect(removed).toEqual(["/tmp/imported.tmp"]);
  });

  test("renames the complete staged pack into place", () => {
    const plan = planLocalPack({
      outputDirectory: "/tmp/imported",
      id: "example",
      kind: "skill",
      metadata: {
        description: "Description",
        overview: "Overview",
        title: "Title",
      },
      ast: [{ type: "paragraph", children: [{ type: "text", value: "Body" }] }],
      packVersion: "0.2.2",
    });
    const writes: string[] = [];
    let rename: [string, string] | undefined;
    const result = writeLocalPack(plan, {
      existsSync: () => false,
      readFileSync: () => "",
      mkdtempSync: () => "/tmp/imported.tmp",
      mkdirSync: () => undefined,
      renameSync: (source, destination) => {
        rename = [source, destination];
      },
      writeFileSync: (path) => writes.push(path),
      rmSync: () => undefined,
    });

    expect(result.error).toBeUndefined();
    expect(result.writtenPaths).toEqual(plan.files.map(({ path }) => path));
    expect(writes).toEqual([
      "/tmp/imported.tmp/package.json",
      "/tmp/imported.tmp/atlante.jsonc",
      "/tmp/imported.tmp/example/instance.jsonc",
    ]);
    expect(rename).toEqual(["/tmp/imported.tmp", "/tmp/imported"]);
  });

  test("reports staging cleanup failures instead of swallowing them", () => {
    const plan = planLocalPack({
      outputDirectory: "/tmp/imported",
      id: "example",
      kind: "skill",
      metadata: {
        description: "Description",
        overview: "Overview",
        title: "Title",
      },
      ast: [{ type: "paragraph", children: [{ type: "text", value: "Body" }] }],
      packVersion: "0.2.2",
    });
    let writes = 0;
    const result = writeLocalPack(plan, {
      existsSync: () => false,
      readFileSync: () => "",
      mkdtempSync: () => "/tmp/imported.tmp",
      mkdirSync: () => undefined,
      renameSync: () => undefined,
      writeFileSync: () => {
        writes++;
        if (writes === 2) throw new Error("disk full");
      },
      rmSync: () => {
        throw new Error("permission denied");
      },
    });

    expect(result.writtenPaths).toEqual([]);
    expect(result.error).toBe("disk full; cleanup failed: permission denied");
  });
});
