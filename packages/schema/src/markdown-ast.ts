/**
 * Canonical Markdown AST distributed as the `@atlante/pack/markdown` template
 * input contract. The union is intentionally close to MDAST so parser output
 * lowers structurally, but it is a stable Atlante contract: parser-only fields
 * such as `position` and plugin `data` are absent, and fields that are absent
 * in MDAST as `null` are omitted here instead.
 */

/**
 * Literal text. The value is the literal characters with entity references and
 * character escapes resolved.
 */
export interface MarkdownText {
  type: "text";
  value: string;
}

/** Emphasized phrasing, rendered with one asterisk on each side. */
export interface MarkdownEmphasis {
  type: "emphasis";
  children: MarkdownPhrasingContent[];
}

/** Strong phrasing, rendered with two asterisks on each side. */
export interface MarkdownStrong {
  type: "strong";
  children: MarkdownPhrasingContent[];
}

/** Inline code span. The value excludes the delimiting backticks. */
export interface MarkdownInlineCode {
  type: "inlineCode";
  value: string;
}

/** Hyperlink. Omit `title` when the source has no title. */
export interface MarkdownLink {
  type: "link";
  url: string;
  title?: string;
  children: MarkdownPhrasingContent[];
}

/** Image. Omit `title` when the source has no title. */
export interface MarkdownImage {
  type: "image";
  url: string;
  alt?: string;
  title?: string;
}

/** Hard line break within a paragraph or table cell. */
export interface MarkdownBreak {
  type: "break";
}

/** GFM strikethrough phrasing. */
export interface MarkdownDelete {
  type: "delete";
  children: MarkdownPhrasingContent[];
}

/** Inline content that flows inside paragraphs, headings, and cells. */
export type MarkdownPhrasingContent =
  | MarkdownText
  | MarkdownEmphasis
  | MarkdownStrong
  | MarkdownInlineCode
  | MarkdownLink
  | MarkdownImage
  | MarkdownBreak
  | MarkdownDelete;

/** Section heading. The depth is the number of `#` characters, one to six. */
export interface MarkdownHeading {
  type: "heading";
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: MarkdownPhrasingContent[];
}

/** Flow paragraph. */
export interface MarkdownParagraph {
  type: "paragraph";
  children: MarkdownPhrasingContent[];
}

/**
 * Fenced or indented code block. The value preserves line breaks. Omit `lang`
 * and `meta` when the fence carries no info string.
 */
export interface MarkdownCode {
  type: "code";
  value: string;
  lang?: string;
  meta?: string;
}

/** Block quote containing block content. */
export interface MarkdownBlockquote {
  type: "blockquote";
  children: MarkdownBlockContent[];
}

/**
 * Ordered or unordered list. Items always render tight. Omit `start` unless an
 * ordered list begins at a number other than one.
 */
export interface MarkdownList {
  type: "list";
  ordered: boolean;
  start?: number;
  children: MarkdownListItem[];
}

/** List item. Omit `checked` unless the item is a GFM task list item. */
export interface MarkdownListItem {
  type: "listItem";
  checked?: boolean;
  children: MarkdownBlockContent[];
}

/** GFM table. Alignment is positional per column; `null` means default. */
export interface MarkdownTable {
  type: "table";
  align: Array<"left" | "right" | "center" | null>;
  children: MarkdownTableRow[];
}

/** One table row. */
export interface MarkdownTableRow {
  type: "tableRow";
  children: MarkdownTableCell[];
}

/** One table cell holding phrasing content. */
export interface MarkdownTableCell {
  type: "tableCell";
  children: MarkdownPhrasingContent[];
}

/** Horizontal rule. */
export interface MarkdownThematicBreak {
  type: "thematicBreak";
}

/** Flow content allowed at the top level of a Markdown document body. */
export type MarkdownBlockContent =
  | MarkdownParagraph
  | MarkdownHeading
  | MarkdownCode
  | MarkdownBlockquote
  | MarkdownList
  | MarkdownTable
  | MarkdownThematicBreak;

/** Any node of the canonical Markdown AST. */
export type MarkdownNode = MarkdownBlockContent | MarkdownPhrasingContent;
