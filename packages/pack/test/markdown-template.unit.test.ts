import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import type { JsonObject } from "@atlante/resources";
import {
  createProjectResourcePack,
  renderResolvedTemplate,
  resolveResourceDocument,
  resolveResourceTemplate,
} from "@atlante/resources";
import { validateResolvedDocument } from "@atlante/validator";
import {
  cleanupPackResourceFixtures,
  packResourceFixture,
} from "./selection-fixture.js";

type MarkdownBlockContent = JsonObject;
type MarkdownListItem = JsonObject;
type MarkdownPhrasingContent = JsonObject;

const text = (value: string): MarkdownPhrasingContent => ({
  type: "text",
  value,
});

const paragraph = (value: string): MarkdownBlockContent => ({
  type: "paragraph",
  children: [text(value)],
});

const listItem = (value: string, checked?: boolean): MarkdownListItem => ({
  type: "listItem",
  ...(checked === undefined ? {} : { checked }),
  children: [paragraph(value)],
});

function renderMarkdown(input: readonly MarkdownBlockContent[]): string {
  const { root, config } = packResourceFixture();
  const template = resolveResourceTemplate(
    createProjectResourcePack(root),
    "@atlante/pack/markdown",
    config,
  );
  return renderResolvedTemplate({ template, input });
}

function validateMarkdownInput(input: unknown): readonly string[] {
  const { root, config } = packResourceFixture();
  const pack = createProjectResourcePack(root);
  const source = JSON.stringify({
    extends: "@atlante/pack",
    agents: {
      reviewer: {
        $template: "@atlante/pack/agent",
        description: "Reviews the change.",
        identity: "You review the change.",
        mission: "Find defects.",
        sections: [{ markdown: input }],
      },
    },
  });
  writeFileSync(config, `${source}\n`);
  const document = resolveResourceDocument({
    pack,
    rootFile: config,
    bindingCollections: [
      {
        key: "agents",
        subject: "agent",
        defaultTemplate: "@atlante/pack/agent",
      },
    ],
  });
  return validateResolvedDocument(document).map(({ code }) => code);
}

describe("canonical Markdown template", () => {
  afterEach(cleanupPackResourceFixtures);

  test("renders every supported node and is byte-deterministic", () => {
    const inlineChildren: MarkdownPhrasingContent[] = [
      text("literal *text* ~~text~~"),
      { type: "emphasis", children: [text("emphasis")] },
      { type: "strong", children: [text("strong")] },
      { type: "inlineCode", value: "bun install" },
      {
        type: "link",
        url: "https://atlante.sh/docs/my guide",
        title: "Guide",
        children: [text("link")],
      },
      {
        type: "link",
        url: "/quoted",
        title: 'say "hi"',
        children: [text("quoted")],
      },
      { type: "image", url: "./logo.png", alt: "logo", title: "Logo" },
      { type: "break" },
      { type: "delete", children: [text("deleted")] },
    ];
    const blocks: MarkdownBlockContent[] = [
      { type: "paragraph", children: inlineChildren },
      { type: "heading", depth: 2, children: [text("Heading")] },
      {
        type: "code",
        lang: "ts",
        meta: 'title="example"',
        value: "const x = 1;",
      },
      {
        type: "blockquote",
        children: [paragraph("quoted"), paragraph("again")],
      },
      {
        type: "list",
        ordered: false,
        children: [
          listItem("open"),
          listItem("done", true),
          listItem("todo", false),
        ],
      },
      {
        type: "list",
        ordered: true,
        start: 3,
        children: [listItem("three"), listItem("four")],
      },
      {
        type: "table",
        align: ["left", "center", "right", null],
        children: [
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [text("Name")] },
              { type: "tableCell", children: [text("Value|Pipe")] },
              {
                type: "tableCell",
                children: [{ type: "inlineCode", value: "x|y" }],
              },
              {
                type: "tableCell",
                children: [
                  {
                    type: "link",
                    url: "a|b",
                    children: [text("url")],
                  },
                ],
              },
            ],
          },
          {
            type: "tableRow",
            children: [
              { type: "tableCell", children: [text("one")] },
              { type: "tableCell", children: [] },
              { type: "tableCell", children: [text("three")] },
              { type: "tableCell", children: [] },
            ],
          },
        ],
      },
      { type: "thematicBreak" },
    ];

    const first = renderMarkdown(blocks);
    const second = renderMarkdown(blocks);

    expect(second).toBe(first);
    expect(first).toContain("literal \\*text\\*");
    expect(first).toContain("\\~\\~text\\~\\~");
    expect(first).toContain("*emphasis*");
    expect(first).toContain("**strong**");
    expect(first).toContain("`bun install`");
    expect(first).toContain(
      '[link](<https://atlante.sh/docs/my guide> "Guide")',
    );
    expect(first).toContain('[quoted](/quoted "say \\"hi\\"")');
    expect(first).toContain('![logo](./logo.png "Logo")');
    expect(first).toContain("~~deleted~~");
    expect(first).toContain("## Heading");
    expect(first).toContain('```ts title="example"');
    expect(first).toContain("> quoted\n> \n> again");
    expect(first).toContain("- open\n- [x] done\n- [ ] todo");
    expect(first).toContain("3. three\n4. four");
    expect(first).toContain(
      "| Name | Value\\|Pipe | `x\\|y` | [url](<a\\|b>) |",
    );
    expect(first).toContain("| :-- | :-: | --: | --- |");
    expect(first).toContain("---");
    expect(first).not.toContain("undefined");
  });

  test("renders nested lists and normalizes table alignment width", () => {
    const nested = renderMarkdown([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [
              paragraph("outer"),
              {
                type: "list",
                ordered: true,
                start: 2,
                children: [listItem("inner")],
              },
            ],
          },
        ],
      },
    ]);
    expect(nested).toBe("- outer\n  \n  2. inner");

    const multiParagraph = renderMarkdown([
      {
        type: "list",
        ordered: false,
        children: [
          {
            type: "listItem",
            children: [paragraph("first"), paragraph("second")],
          },
        ],
      },
    ]);
    expect(multiParagraph).toBe("- first\n  \n  second");

    const mismatchedTable = renderMarkdown([
      {
        type: "table",
        align: ["left", "right"],
        children: [
          {
            type: "tableRow",
            children: [{ type: "tableCell", children: [text("a")] }],
          },
          {
            type: "tableRow",
            children: [{ type: "tableCell", children: [text("b")] }],
          },
        ],
      },
    ]);
    expect(mismatchedTable).toBe("| a |\n| :-- |\n| b |");
  });

  test("rejects unknown nodes and parser-only fields, while defaulting ordered starts", () => {
    expect(
      validateMarkdownInput([
        { type: "paragraph", children: [{ type: "text", value: "ok" }] },
      ]),
    ).toEqual([]);

    const invalidInputs = [
      [{ type: "html", value: "<br>" }],
      [
        {
          type: "paragraph",
          data: {},
          children: [{ type: "text", value: "x" }],
        },
      ],
    ];

    for (const input of invalidInputs)
      expect(validateMarkdownInput(input)).toContain("invalid-prompt-input");

    expect(
      validateMarkdownInput([
        {
          type: "list",
          ordered: true,
          children: [{ type: "listItem", children: [paragraph("x")] }],
        },
      ]),
    ).toEqual([]);
  });

  test("accepts empty nodes emitted by CommonMark", () => {
    expect(
      validateMarkdownInput([
        { type: "heading", depth: 1, children: [] },
        { type: "blockquote", children: [] },
        {
          type: "list",
          ordered: false,
          children: [{ type: "listItem", children: [] }],
        },
        {
          type: "paragraph",
          children: [
            { type: "inlineCode", value: "" },
            { type: "link", url: "/empty", children: [] },
          ],
        },
      ]),
    ).toEqual([]);
    expect(validateMarkdownInput([])).toEqual([]);
  });
});
