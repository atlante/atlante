import { describe, expect, test } from "bun:test";
import { join, sep } from "node:path";
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
  runImportWithDependencies,
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

  test("normalizes code-span line endings to spaces", () => {
    expect(lower("`a\nb`").ast).toEqual([
      { type: "paragraph", children: [{ type: "inlineCode", value: "a b" }] },
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

  const whitespaceRoundTripCases: readonly {
    readonly label: string;
    readonly ast: readonly MarkdownBlockContent[];
  }[] = [
    {
      label: "indented continuation line",
      ast: loweredToAst("first line\n  continued with indentation\n\nback"),
    },
    {
      label: "table-delimiter-looking text",
      ast: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "| not | a | table |\n| --- | --- |" },
          ],
        },
      ],
    },
    {
      label: "list look-alike text",
      ast: loweredToAst(
        "leading list look-alike\n\n\\- not a list\n\\| not a table\n\nafter",
      ),
    },
    {
      label: "padded code span and fenced block",
      ast: loweredToAst(
        "padded code span and fence\n\n` spaced `\n\n```ts\nconst a = 1;\n\n```\n\ntail",
      ),
    },
    {
      label: "code with trailing newline and backtick line",
      ast: [{ type: "code", value: "a\n```\nb\n" }],
    },
  ];

  function loweredToAst(source: string): readonly MarkdownBlockContent[] {
    return lowerToAtlanteAst(parseMarkdownSource(source, "in.md").tree, "in.md")
      .ast;
  }

  function renderToMarkdown(
    ast: readonly MarkdownBlockContent[],
  ): ReturnType<typeof renderResolvedTemplate> {
    const pack = resolveFirstPartyPack();
    return renderResolvedTemplate({
      template: resolveResourceTemplate(
        pack,
        "@atlante/pack/markdown",
        join(pack.root, "package.json"),
      ),
      input: ast,
    });
  }

  test.each(whitespaceRoundTripCases)("round-trips $label", ({ ast }) => {
    const rendered = renderToMarkdown(ast);
    const reparsed = parseMarkdownSource(rendered, "out.md");
    const relowered = lowerToAtlanteAst(reparsed.tree, "out.md");
    expect(reparsed.diagnostics).toEqual([]);
    expect(relowered.diagnostics).toEqual([]);
    expect(relowered.ast).toEqual(ast);
  });

  test("renders autolink-reading text so it reparses as an equivalent link", () => {
    // GFM autolink literals cannot be escaped with byte fidelity, so text
    // reading as a URL reparses as a link with the same visible content.
    const lowered = lower(
      "See https://example.com/docs and www.example.com now.",
    ).ast;
    const rendered = renderToMarkdown(lowered);
    const relowered = lowerToAtlanteAst(
      parseMarkdownSource(rendered, "out.md").tree,
      "out.md",
    );

    expect(relowered.diagnostics).toEqual([]);
    expect(rendered).toContain("https://example.com/docs");
    expect(JSON.stringify(relowered.ast)).toContain(
      '"url":"https://example.com/docs"',
    );
    expect(JSON.stringify(relowered.ast)).toContain(
      '"url":"http://www.example.com"',
    );
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

  test("rejects invalid frontmatter names without falling back silently", () => {
    const invalid = mapFrontmatter(
      { name: "!!!", title: "T", overview: "O", description: "D" },
      "skill",
    );
    expect(invalid.metadata.id).toBeUndefined();
    expect(invalid.diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid-import-name",
        severity: "error",
      }),
    ]);

    expect(
      mapFrontmatter(
        { name: 42, title: "T", overview: "O", description: "D" },
        "skill",
      ).diagnostics,
    ).toEqual([
      expect.objectContaining({
        code: "invalid-frontmatter-value",
        message: 'frontmatter key "name" must be a string',
      }),
    ]);
  });

  test("resolves the generated ID from --name, frontmatter name, then the stem", () => {
    const schemas = firstPartyFacetInputSchemas();
    const files = new Map<string, string>();
    const directories = new Set<string>();
    const fileSystem = {
      existsSync: (path: string) => files.has(path) || directories.has(path),
      readFileSync: (path: string) => files.get(path) ?? "",
      mkdtempSync: (prefix: string) => `${prefix}stage`,
      mkdirSync: (path: string) => {
        directories.add(path);
      },
      renameSync: (source: string, destination: string) => {
        directories.delete(source);
        directories.add(destination);
        for (const [path, contents] of [...files])
          if (path.startsWith(`${source}${sep}`)) {
            files.delete(path);
            files.set(
              join(destination, path.slice(source.length + 1)),
              contents,
            );
          }
      },
      writeFileSync: (path: string, contents: string) => {
        files.set(path, contents);
      },
      rmSync: (path: string) => {
        directories.delete(path);
      },
    };
    const dependencies = {
      ...fileSystem,
      packVersion: "0.2.2",
      facetInputSchemas: schemas,
    };
    const importedId = (
      fileName: string,
      frontmatter: string,
      options: { kind: "skill"; name?: string },
    ): string | undefined => {
      const input = join("/input", fileName);
      const output = join("/out", fileName.replace(/\.md$/, ""));
      files.set(input, `---\n${frontmatter}\n---\n\nBody text.\n`);
      expect(
        runImportWithDependencies(input, output, options, dependencies),
      ).toBe(0);
      return directories.has(output)
        ? (
            JSON.parse(files.get(join(output, "package.json")) ?? "{}") as {
              name?: string;
            }
          ).name
        : undefined;
    };

    const fullFrontmatter = "title: T\noverview: O\ndescription: D";

    // Frontmatter name wins over the stem.
    expect(
      importedId("guide.md", `name: My Skill\n${fullFrontmatter}`, {
        kind: "skill",
      }),
    ).toBe("my-skill");
    // --name wins over everything.
    expect(
      importedId("named.md", `name: My Skill\n${fullFrontmatter}`, {
        kind: "skill",
        name: "custom",
      }),
    ).toBe("custom");
    // The stem is the last fallback.
    expect(importedId("plain.md", fullFrontmatter, { kind: "skill" })).toBe(
      "plain",
    );
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
