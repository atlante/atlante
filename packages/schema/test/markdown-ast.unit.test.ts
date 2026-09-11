import { test } from "bun:test";
import type {
  MarkdownBlockContent,
  MarkdownBlockquote,
  MarkdownCode,
  MarkdownDelete,
  MarkdownEmphasis,
  MarkdownHeading,
  MarkdownImage,
  MarkdownInlineCode,
  MarkdownLink,
  MarkdownList,
  MarkdownListItem,
  MarkdownParagraph,
  MarkdownPhrasingContent,
  MarkdownStrong,
  MarkdownTable,
  MarkdownTableCell,
  MarkdownTableRow,
  MarkdownText,
  MarkdownThematicBreak,
} from "../src/index.js";

test("type assertions compile", () => {});

const text: MarkdownText = { type: "text", value: "Run the tests." };

const emphasis: MarkdownEmphasis = {
  type: "emphasis",
  children: [text],
};

const strong: MarkdownStrong = {
  type: "strong",
  children: [text, emphasis],
};

const inlineCode: MarkdownInlineCode = {
  type: "inlineCode",
  value: "bun install",
};

const link: MarkdownLink = {
  type: "link",
  url: "https://atlante.sh",
  children: [text],
};

const linkWithTitle: MarkdownLink = {
  type: "link",
  url: "https://atlante.sh",
  title: "Atlante",
  children: [text],
};

const image: MarkdownImage = { type: "image", url: "./logo.png", alt: "Logo" };

const imageWithTitle: MarkdownImage = {
  type: "image",
  url: "./logo.png",
  alt: "Logo",
  title: "Title",
};

const hardBreak: MarkdownPhrasingContent = { type: "break" };

const strikethrough: MarkdownDelete = {
  type: "delete",
  children: [text],
};

const paragraph: MarkdownParagraph = {
  type: "paragraph",
  children: [
    text,
    inlineCode,
    link,
    linkWithTitle,
    image,
    emphasis,
    strong,
    hardBreak,
    strikethrough,
  ],
};

const heading: MarkdownHeading = {
  type: "heading",
  depth: 2,
  children: [text],
};

const code: MarkdownCode = {
  type: "code",
  lang: "ts",
  meta: 'title="example"',
  value: "const value = 1;",
};

const codeWithoutLang: MarkdownCode = { type: "code", value: "plain" };

const taskItem: MarkdownListItem = {
  type: "listItem",
  checked: true,
  children: [paragraph],
};

const nestedList: MarkdownList = {
  type: "list",
  ordered: false,
  children: [taskItem],
};

const orderedList: MarkdownList = {
  type: "list",
  ordered: true,
  start: 2,
  children: [
    {
      type: "listItem",
      children: [paragraph, nestedList],
    },
  ],
};

const blockquote: MarkdownBlockquote = {
  type: "blockquote",
  children: [paragraph, heading, code, orderedList],
};

const table: MarkdownTable = {
  type: "table",
  align: ["left", null, "center"],
  children: [
    {
      type: "tableRow",
      children: [
        { type: "tableCell", children: [text] },
        { type: "tableCell", children: [inlineCode] },
        { type: "tableCell", children: [] },
      ],
    },
  ],
};

const thematicBreak: MarkdownThematicBreak = { type: "thematicBreak" };

const blocks: MarkdownBlockContent[] = [
  paragraph,
  heading,
  code,
  codeWithoutLang,
  blockquote,
  orderedList,
  table,
  thematicBreak,
];

// Every block kind is admitted where block content is expected.
const allBlocks: MarkdownBlockContent[] = blocks;

// Phrasing content never appears where blocks are required.
// @ts-expect-error Phrasing content is not block content.
const phraseAsBlock: MarkdownBlockContent = text;

// @ts-expect-error Headings are limited to depths 1-6.
const tooDeep: MarkdownHeading = { type: "heading", depth: 7, children: [] };

// @ts-expect-error Table alignment only allows left, right, center, or null.
const badAlign: MarkdownTable = { type: "table", align: ["up"], children: [] };

// @ts-expect-error Lists require the ordered discriminator field.
const noOrdered: MarkdownList = { type: "list", children: [] };

// @ts-expect-error Unknown node types are not part of the contract.
const unknown: MarkdownPhrasingContent = { type: "embed", value: "x" };

const blockInCell: MarkdownTableCell = {
  type: "tableCell",
  // @ts-expect-error Table cells hold phrasing content, not blocks.
  children: [paragraph],
};

const rowRequiresCells: MarkdownTableRow = {
  type: "tableRow",
  children: [{ type: "tableCell", children: [] }],
};

void imageWithTitle;
void allBlocks;
void phraseAsBlock;
void tooDeep;
void badAlign;
void noOrdered;
void unknown;
void blockInCell;
void rowRequiresCells;
