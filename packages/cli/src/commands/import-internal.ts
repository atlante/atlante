import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";
import { loadTemplateFacet, type ResourcePack } from "@atlante/resources";
import type {
  MarkdownBlockContent,
  MarkdownPhrasingContent,
} from "@atlante/schema";
import { SCHEMA_URI } from "@atlante/schema";
import {
  type Diagnostic,
  error,
  hasErrors,
  sortDiagnostics,
  validateTemplateFacetInput,
  warning,
} from "@atlante/validator";
import { type ParseError, parse as parseJsonc } from "jsonc-parser";
import type { AlignType, PhrasingContent, Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { frontmatter } from "micromark-extension-frontmatter";
import { gfm } from "micromark-extension-gfm";
import { parse as parseYaml } from "yaml";
import {
  FIRST_PARTY_PACKAGE,
  firstPartyPackVersion,
  resolveFirstPartyPack,
} from "../first-party-pack.js";
import { printDiagnostics } from "../report.js";
import { createStyler } from "../style.js";

const MARKDOWN_TEMPLATE = "@atlante/pack/markdown";
const AGENT_TEMPLATE = "@atlante/pack/agent";
const SKILL_TEMPLATE = "@atlante/pack/skill";

export type ImportKind = "agent" | "skill";

export type SourceLocation = Readonly<{
  line: number;
  column: number;
}>;

export type ParsedMarkdownSource = Readonly<{
  tree: Root;
  frontmatter: Record<string, unknown>;
  frontmatterLocation?: SourceLocation;
  diagnostics: Diagnostic[];
}>;

export type LoweredMarkdown = Readonly<{
  ast: MarkdownBlockContent[];
  diagnostics: Diagnostic[];
}>;

const markdownSourceByTree = new WeakMap<Root, string>();

export type MappedFrontmatter = Readonly<{
  id?: string;
  title?: string;
  overview?: string;
  identity?: string;
  mission?: string;
  description?: string;
}>;

export type FrontmatterMapping = Readonly<{
  metadata: MappedFrontmatter;
  diagnostics: Diagnostic[];
}>;

type LocatedNode = Readonly<{
  type?: string;
  position?: Readonly<{
    start?: SourcePoint;
    end?: SourcePoint;
  }>;
}>;

type SourcePoint = SourceLocation & {
  offset?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function locationOf(node: LocatedNode): SourceLocation | undefined {
  const start = node.position?.start;
  if (!start) return undefined;
  if (!Number.isInteger(start.line) || !Number.isInteger(start.column))
    return undefined;
  return { line: start.line, column: start.column };
}

function diagnosticLocation(
  source: string,
  node: LocatedNode,
): Pick<Diagnostic, "source" | "location"> {
  const location = locationOf(node);
  return location ? { source, location } : { source };
}

function parseDiagnostic(
  source: string,
  node: LocatedNode,
  code: string,
  message: string,
  cause?: unknown,
): Diagnostic {
  return error(code, message, {
    ...diagnosticLocation(source, node),
    ...(cause === undefined
      ? {}
      : { cause: cause instanceof Error ? cause.message : String(cause) }),
  });
}

function normalizeLabel(value: string): string {
  return value
    .replace(/[\t\n\r ]+/g, " ")
    .trim()
    .toLowerCase();
}

function referenceIdentifier(value: {
  identifier?: string | null;
  label?: string | null;
}): string {
  return normalizeLabel(value.identifier || value.label || "");
}

function yamlErrorLocation(
  cause: unknown,
  fallback: SourceLocation | undefined,
  sourceText: string,
  yamlNode: LocatedNode & { value: string },
): SourceLocation | undefined {
  if (isRecord(cause) && Array.isArray(cause.linePos)) {
    const first = cause.linePos[0];
    if (isRecord(first)) {
      const line = first.line;
      const column = first.col;
      const nodeStartOffset = yamlNode.position?.start?.offset;
      const valueOffset =
        nodeStartOffset === undefined
          ? -1
          : sourceText.indexOf(yamlNode.value, nodeStartOffset);
      if (
        typeof line === "number" &&
        typeof column === "number" &&
        nodeStartOffset !== undefined &&
        valueOffset >= nodeStartOffset &&
        valueOffset >= 0
      ) {
        const lineStart = offsetAtLineColumn(yamlNode.value, line, column);
        return sourceLocationAtOffset(sourceText, valueOffset + lineStart);
      }
      if (typeof line === "number" && typeof column === "number")
        return { line, column };
    }
  }
  return fallback;
}

function offsetAtLineColumn(
  source: string,
  targetLine: number,
  targetColumn: number,
): number {
  let line = 1;
  let column = 1;
  for (let offset = 0; offset < source.length; offset++) {
    if (line === targetLine && column === targetColumn) return offset;
    if (source[offset] === "\r") {
      line++;
      column = 1;
      if (source[offset + 1] === "\n") offset++;
    } else if (source[offset] === "\n") {
      line++;
      column = 1;
    } else column++;
  }
  return source.length;
}

/**
 * Parses the supported Markdown profile while retaining the parser tree and
 * its source positions. Frontmatter is parsed separately and never becomes
 * body content.
 */
export function parseMarkdownSource(
  sourceText: string,
  source = "<markdown>",
): ParsedMarkdownSource {
  let tree: Root;
  try {
    tree = fromMarkdown(sourceText, {
      extensions: [gfm(), frontmatter()],
      mdastExtensions: [gfmFromMarkdown(), frontmatterFromMarkdown()],
    });
  } catch (cause) {
    const tree: Root = { type: "root", children: [] };
    markdownSourceByTree.set(tree, sourceText);
    return {
      tree,
      frontmatter: {},
      diagnostics: [
        error("markdown-parse-failed", "could not parse Markdown source", {
          source,
          cause: cause instanceof Error ? cause.message : String(cause),
        }),
      ],
    };
  }

  markdownSourceByTree.set(tree, sourceText);

  const yamlNode = tree.children.find((node) => node.type === "yaml");
  if (!yamlNode) return { tree, frontmatter: {}, diagnostics: [] };

  const frontmatterLocation = locationOf(yamlNode);
  if (yamlNode.value.trim().length === 0)
    return {
      tree,
      frontmatter: {},
      frontmatterLocation,
      diagnostics: [],
    };

  let parsed: unknown;
  const normalizedYaml = yamlNode.value.replace(/\r\n?/g, "\n");
  try {
    parsed = parseYaml(normalizedYaml);
  } catch (cause) {
    const location = yamlErrorLocation(
      cause,
      frontmatterLocation,
      sourceText,
      yamlNode,
    );
    return {
      tree,
      frontmatter: {},
      ...(location ? { frontmatterLocation: location } : {}),
      diagnostics: [
        parseDiagnostic(
          source,
          location ? { position: { start: location } } : yamlNode,
          "invalid-frontmatter",
          "frontmatter is not valid YAML",
          cause,
        ),
      ],
    };
  }

  if (!isRecord(parsed))
    return {
      tree,
      frontmatter: {},
      frontmatterLocation,
      diagnostics: [
        parseDiagnostic(
          source,
          yamlNode,
          "invalid-frontmatter",
          "frontmatter must be a YAML mapping",
        ),
      ],
    };

  return {
    tree,
    frontmatter: parsed,
    frontmatterLocation,
    diagnostics: [],
  };
}

function unsupportedDiagnostic(
  source: string,
  node: LocatedNode,
  message: string,
): Diagnostic {
  return error("unsupported-markdown", message, {
    ...diagnosticLocation(source, node),
    next: "rewrite the construct using the supported CommonMark + GFM profile and run the import again",
  });
}

function unknownNodeDiagnostic(source: string, node: LocatedNode): Diagnostic {
  return unsupportedDiagnostic(
    source,
    node,
    `unsupported Markdown node type "${node.type ?? "<unknown>"}"`,
  );
}

function footnoteDiagnostic(source: string, node: LocatedNode): Diagnostic {
  return unsupportedDiagnostic(
    source,
    node,
    "footnotes are not part of the supported Markdown import profile",
  );
}

function htmlDiagnostic(source: string, node: LocatedNode): Diagnostic {
  return unsupportedDiagnostic(
    source,
    node,
    "raw HTML is not part of the supported Markdown import profile",
  );
}

type LoweringContext = Readonly<{
  source: string;
  sourceText?: string;
  definitions: Map<string, { url: string; title?: string | null }>;
  diagnostics: Diagnostic[];
}>;

function childrenOf(node: RootContent): readonly RootContent[] {
  if ("children" in node && Array.isArray(node.children)) return node.children;
  return [];
}

function collectDefinitions(
  nodes: readonly RootContent[],
  definitions: Map<string, { url: string; title?: string | null }>,
): void {
  for (const node of nodes) {
    if (node.type === "definition") {
      const key = referenceIdentifier(node);
      if (key.length > 0 && !definitions.has(key))
        definitions.set(key, { url: node.url, title: node.title });
    }
    collectDefinitions(childrenOf(node), definitions);
  }
}

function optionalTitle(
  title: string | null | undefined,
): { title: string } | Record<string, never> {
  return typeof title === "string" && title.length > 0 ? { title } : {};
}

function lowerPhrasing(
  nodes: readonly PhrasingContent[],
  context: LoweringContext,
): MarkdownPhrasingContent[] {
  const lowered: MarkdownPhrasingContent[] = [];
  for (const node of nodes) {
    const value = lowerPhrasingNode(node, context);
    if (value) lowered.push(value);
  }
  return lowered;
}

function unresolvedReferenceDiagnostic(
  context: LoweringContext,
  node: LocatedNode & { label?: string | null; identifier?: string | null },
  kind: "link" | "image",
): void {
  const label = node.label ?? node.identifier ?? "";
  context.diagnostics.push(
    error(
      "unresolved-reference",
      `no definition found for ${kind} reference "${label}"`,
      {
        ...diagnosticLocation(context.source, node),
        next: "add a definition for the reference or use a direct link/image URL",
      },
    ),
  );
}

function sourceLocationAtOffset(
  source: string,
  offset: number,
): SourceLocation {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index++) {
    if (source[index] === "\r") {
      line++;
      column = 1;
      if (source[index + 1] === "\n" && index + 1 < offset) index++;
    } else if (source[index] === "\n") {
      line++;
      column = 1;
    } else column++;
  }
  return { line, column };
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor--)
    slashes++;
  return slashes % 2 === 1;
}

type ReferenceCandidate = Readonly<{
  index: number;
  end: number;
  kind: "link" | "image";
  label: string;
}>;

function matchingBracket(
  value: string,
  openingIndex: number,
): number | undefined {
  let depth = 0;
  for (let index = openingIndex; index < value.length; index++) {
    const character = value[index];
    if (character === "\\") {
      index++;
      continue;
    }
    if (character === "[") depth++;
    else if (character === "]") {
      depth--;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function unresolvedReferenceCandidates(value: string): ReferenceCandidate[] {
  const candidates: ReferenceCandidate[] = [];
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const isImage =
      character === "!" && value[index + 1] === "[" && !isEscaped(value, index);
    const openingIndex = isImage ? index + 1 : index;
    if (
      value[openingIndex] !== "[" ||
      (!isImage && isEscaped(value, openingIndex))
    )
      continue;

    const textEnd = matchingBracket(value, openingIndex);
    if (textEnd === undefined || value[textEnd + 1] !== "[") continue;
    const labelEnd = matchingBracket(value, textEnd + 1);
    if (labelEnd === undefined) continue;

    candidates.push({
      index: isImage ? index : openingIndex,
      end: labelEnd + 1,
      kind: isImage ? "image" : "link",
      label:
        value.slice(textEnd + 2, labelEnd) ||
        value.slice(openingIndex + 1, textEnd),
    });
    index = labelEnd;
  }
  return candidates;
}

type PositionedTreeNode = LocatedNode & {
  children?: readonly PositionedTreeNode[];
};

type SourceSpan = Readonly<{ start: number; end: number }>;

function treeChildren(node: unknown): readonly PositionedTreeNode[] {
  if (!isRecord(node) || !Array.isArray(node.children)) return [];
  return node.children as PositionedTreeNode[];
}

const referenceProtectedNodeTypes = new Set([
  "code",
  "definition",
  "footnoteDefinition",
  "footnoteReference",
  "html",
  "image",
  "imageReference",
  "inlineCode",
  "link",
  "linkReference",
  "yaml",
]);

function nodeSourceSpan(node: LocatedNode): SourceSpan | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number"
    ? { start, end }
    : undefined;
}

function collectReferenceProtectedSpans(
  node: PositionedTreeNode,
  spans: SourceSpan[],
): void {
  if (node.type && referenceProtectedNodeTypes.has(node.type)) {
    const span = nodeSourceSpan(node);
    if (span) spans.push(span);
    return;
  }
  for (const child of treeChildren(node))
    collectReferenceProtectedSpans(child, spans);
}

/*
 * Reference-like text can be split across MDAST phrasing nodes when the
 * reference label contains formatting. Scan each phrasing container's source
 * span, but protect constructs that the parser already recognized as links,
 * code, HTML, or footnotes so literal brackets are not misclassified.
 */
function reportUnresolvedContainerReferences(
  node: PositionedTreeNode,
  context: LoweringContext,
): void {
  const containerSpan = nodeSourceSpan(node);
  if (!context.sourceText || !containerSpan) return;

  const protectedSpans: SourceSpan[] = [];
  for (const child of treeChildren(node))
    collectReferenceProtectedSpans(child, protectedSpans);

  const raw = context.sourceText.slice(containerSpan.start, containerSpan.end);
  for (const candidate of unresolvedReferenceCandidates(raw)) {
    const candidateStart = containerSpan.start + candidate.index;
    const candidateEnd = containerSpan.start + candidate.end;
    if (
      protectedSpans.some(
        (span) => candidateStart < span.end && candidateEnd > span.start,
      )
    )
      continue;
    const label = candidate.label;
    const identifier = normalizeLabel(label);
    if (!identifier || context.definitions.has(identifier)) continue;
    const location = sourceLocationAtOffset(context.sourceText, candidateStart);
    context.diagnostics.push(
      error(
        "unresolved-reference",
        `no definition found for ${candidate.kind} reference "${label}"`,
        {
          source: context.source,
          location,
          next: "add a definition for the reference or use a direct link/image URL",
        },
      ),
    );
  }
}

function reportUnresolvedReferencesInTree(
  nodes: readonly PositionedTreeNode[],
  context: LoweringContext,
): void {
  for (const node of nodes) {
    if (node.type && referenceProtectedNodeTypes.has(node.type)) continue;
    if (
      node.type === "heading" ||
      node.type === "paragraph" ||
      node.type === "tableCell"
    )
      reportUnresolvedContainerReferences(node, context);
    reportUnresolvedReferencesInTree(treeChildren(node), context);
  }
}

function lowerPhrasingNode(
  node: PhrasingContent,
  context: LoweringContext,
): MarkdownPhrasingContent | undefined {
  switch (node.type) {
    case "text":
      return { type: "text", value: node.value };
    case "emphasis":
      return {
        type: "emphasis",
        children: lowerPhrasing(node.children, context),
      };
    case "strong":
      return {
        type: "strong",
        children: lowerPhrasing(node.children, context),
      };
    case "inlineCode":
      // CommonMark renders code-span line endings as spaces, so the persisted
      // value stores the space directly (the schema forbids line endings).
      return {
        type: "inlineCode",
        value: node.value.replace(/\r\n?|\n/g, " "),
      };
    case "link":
      return {
        type: "link",
        url: node.url,
        ...optionalTitle(node.title),
        children: lowerPhrasing(node.children, context),
      };
    case "image":
      return {
        type: "image",
        url: node.url,
        ...(node.alt === null || node.alt === undefined
          ? {}
          : { alt: node.alt }),
        ...optionalTitle(node.title),
      };
    case "break":
      return { type: "break" };
    case "delete":
      return {
        type: "delete",
        children: lowerPhrasing(node.children, context),
      };
    case "linkReference": {
      const definition = context.definitions.get(referenceIdentifier(node));
      if (!definition) {
        unresolvedReferenceDiagnostic(context, node, "link");
        return undefined;
      }
      return {
        type: "link",
        url: definition.url,
        ...optionalTitle(definition.title),
        children: lowerPhrasing(node.children, context),
      };
    }
    case "imageReference": {
      const definition = context.definitions.get(referenceIdentifier(node));
      if (!definition) {
        unresolvedReferenceDiagnostic(context, node, "image");
        return undefined;
      }
      return {
        type: "image",
        url: definition.url,
        ...(node.alt === null || node.alt === undefined
          ? {}
          : { alt: node.alt }),
        ...optionalTitle(definition.title),
      };
    }
    case "html":
      context.diagnostics.push(htmlDiagnostic(context.source, node));
      return undefined;
    case "footnoteReference":
      context.diagnostics.push(footnoteDiagnostic(context.source, node));
      return undefined;
    default:
      context.diagnostics.push(unknownNodeDiagnostic(context.source, node));
      return undefined;
  }
}

function lowerBlocks(
  nodes: readonly RootContent[],
  context: LoweringContext,
): MarkdownBlockContent[] {
  const lowered: MarkdownBlockContent[] = [];
  for (const node of nodes) {
    const value = lowerBlockNode(node, context);
    if (value) lowered.push(value);
  }
  return lowered;
}

function lowerBlockNode(
  node: RootContent,
  context: LoweringContext,
): MarkdownBlockContent | undefined {
  switch (node.type) {
    case "paragraph":
      return {
        type: "paragraph",
        children: lowerPhrasing(node.children, context),
      };
    case "heading":
      return {
        type: "heading",
        depth: node.depth,
        children: lowerPhrasing(node.children, context),
      };
    case "code":
      return {
        type: "code",
        value: node.value,
        ...(typeof node.lang === "string" && node.lang.length > 0
          ? { lang: node.lang }
          : {}),
        ...(typeof node.meta === "string" && node.meta.length > 0
          ? { meta: node.meta }
          : {}),
      };
    case "blockquote":
      return {
        type: "blockquote",
        children: lowerBlocks(node.children, context),
      };
    case "list": {
      const children = node.children.map((item) => ({
        type: "listItem" as const,
        ...(item.checked === null || item.checked === undefined
          ? {}
          : { checked: item.checked }),
        children: lowerBlocks(item.children, context),
      }));
      return {
        type: "list",
        ordered: node.ordered === true,
        ...(node.ordered === true &&
        typeof node.start === "number" &&
        node.start !== 1
          ? { start: node.start }
          : {}),
        children,
      };
    }
    case "table": {
      const align: AlignType[] = [...(node.align ?? [])];
      return {
        type: "table",
        align,
        children: node.children.map((row) => ({
          type: "tableRow" as const,
          children: row.children.map((cell) => ({
            type: "tableCell" as const,
            children: lowerPhrasing(cell.children, context),
          })),
        })),
      };
    }
    case "thematicBreak":
      return { type: "thematicBreak" };
    case "definition":
    case "yaml":
      return undefined;
    case "html":
      context.diagnostics.push(htmlDiagnostic(context.source, node));
      return undefined;
    case "footnoteDefinition":
      context.diagnostics.push(footnoteDiagnostic(context.source, node));
      return undefined;
    case "break":
    case "delete":
    case "emphasis":
    case "footnoteReference":
    case "image":
    case "imageReference":
    case "inlineCode":
    case "link":
    case "linkReference":
    case "strong":
    case "text":
      context.diagnostics.push(
        unsupportedDiagnostic(
          context.source,
          node,
          `Markdown node type "${node.type}" is not valid block content`,
        ),
      );
      return undefined;
    default:
      context.diagnostics.push(unknownNodeDiagnostic(context.source, node));
      return undefined;
  }
}

/** Lowers a positioned MDAST tree to the parser-independent Atlante AST. */
export function lowerToAtlanteAst(
  tree: Root,
  source = "<markdown>",
): LoweredMarkdown {
  const definitions = new Map<string, { url: string; title?: string | null }>();
  collectDefinitions(tree.children, definitions);
  const context: LoweringContext = {
    source,
    sourceText: markdownSourceByTree.get(tree),
    definitions,
    diagnostics: [],
  };
  reportUnresolvedReferencesInTree(tree.children, context);
  return {
    ast: lowerBlocks(tree.children, context),
    diagnostics: context.diagnostics,
  };
}

const MAX_RESOURCE_ID_LENGTH = 64;

export function sanitizeResourceId(value: string): string | undefined {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized.length > 0 && sanitized.length <= MAX_RESOURCE_ID_LENGTH
    ? sanitized
    : undefined;
}

function metadataValue(
  metadata: Record<string, string | undefined>,
  key: string,
  value: string,
): void {
  if (key === "title") metadata.title = value;
  else if (key === "overview") metadata.overview = value;
  else if (key === "identity") metadata.identity = value;
  else if (key === "mission") metadata.mission = value;
  else if (key === "description") metadata.description = value;
}

/** Applies only the explicit frontmatter mappings for the selected host kind. */
export function mapFrontmatter(
  frontmatter: Readonly<Record<string, unknown>>,
  kind: ImportKind,
  source = "<markdown>",
  frontmatterLocation?: SourceLocation,
): FrontmatterMapping {
  const metadata: Record<string, string | undefined> = {};
  const diagnostics: Diagnostic[] = [];
  const allowed = new Set(
    kind === "skill"
      ? ["name", "description", "title", "overview"]
      : ["name", "description", "identity", "mission"],
  );
  // Description is the only required field: hosts consume it directly
  // (OpenCode skill discovery and binding lookup metadata). The remaining
  // mapped fields are template presentation input and stay optional.
  const required = ["description"] as const;
  const location = frontmatterLocation
    ? { source, location: frontmatterLocation }
    : { source };

  for (const key of Object.keys(frontmatter).sort()) {
    const value = frontmatter[key];
    if (!allowed.has(key)) {
      diagnostics.push(
        warning(
          "unknown-frontmatter-key",
          `frontmatter key "${key}" is not mapped for ${kind} imports`,
          {
            ...location,
            next: "remove the key or map it explicitly before importing",
          },
        ),
      );
      continue;
    }

    if (key === "name") {
      if (typeof value !== "string") {
        diagnostics.push(
          error(
            "invalid-frontmatter-value",
            'frontmatter key "name" must be a string',
            location,
          ),
        );
        continue;
      }
      const id = sanitizeResourceId(value);
      if (!id) {
        diagnostics.push(
          error(
            "invalid-import-name",
            'frontmatter key "name" must contain an ASCII letter or digit and be at most 64 characters after sanitization',
            {
              ...location,
              next: "set name to a filesystem-safe pack identifier",
            },
          ),
        );
        continue;
      }
      metadata.id = id;
      continue;
    }

    if (typeof value !== "string") {
      diagnostics.push(
        error(
          "invalid-frontmatter-value",
          `frontmatter key "${key}" must be a string`,
          location,
        ),
      );
      continue;
    }
    if (value.trim().length === 0) {
      diagnostics.push(
        error(
          "missing-metadata",
          `required frontmatter key "${key}" must not be empty`,
          {
            ...location,
            next: `set ${key} in the frontmatter and run the import again`,
          },
        ),
      );
      continue;
    }
    metadataValue(metadata, key, value);
  }

  for (const key of required) {
    if (Object.hasOwn(frontmatter, key)) continue;
    diagnostics.push(
      error(
        "missing-metadata",
        `missing required ${kind} frontmatter key "${key}"`,
        {
          ...location,
          next: `add ${key} to the frontmatter and run the import again`,
        },
      ),
    );
  }

  // Skills render their title heading from the template input; derive it from
  // the source name when the frontmatter carries no explicit title so common
  // name+description skill files import without editing.
  if (
    kind === "skill" &&
    metadata.title === undefined &&
    typeof frontmatter.name === "string" &&
    frontmatter.name.trim().length > 0
  )
    metadata.title = frontmatter.name.trim();

  return { metadata, diagnostics };
}

export type FacetInputSchemas = Readonly<
  Partial<
    Record<
      typeof MARKDOWN_TEMPLATE | typeof AGENT_TEMPLATE | typeof SKILL_TEMPLATE,
      Record<string, unknown>
    >
  >
>;

function loadedFacetInputSchemas(pack: ResourcePack): FacetInputSchemas {
  const authoringFile = join(pack.root, "atlante.jsonc");
  const templates = [
    MARKDOWN_TEMPLATE,
    AGENT_TEMPLATE,
    SKILL_TEMPLATE,
  ] as const;
  const schemas: Record<string, Record<string, unknown>> = {};
  for (const template of templates)
    schemas[template] = loadTemplateFacet(
      pack,
      template,
      authoringFile,
    ).facet.inputSchema;
  return schemas;
}

export function firstPartyFacetInputSchemas(): FacetInputSchemas {
  return loadedFacetInputSchemas(resolveFirstPartyPack());
}

function instanceInput(
  metadata: MappedFrontmatter,
  ast: readonly MarkdownBlockContent[],
  kind: ImportKind,
): Record<string, unknown> {
  const sections = [{ markdown: ast }];
  const hasTopLevelHeading = ast.some(
    (block) => block.type === "heading" && block.depth === 1,
  );
  return kind === "skill"
    ? {
        ...(metadata.title === undefined || hasTopLevelHeading
          ? {}
          : { title: metadata.title }),
        ...(metadata.overview === undefined
          ? {}
          : { overview: metadata.overview }),
        sections,
      }
    : {
        ...(metadata.identity === undefined
          ? {}
          : { identity: metadata.identity }),
        ...(metadata.mission === undefined
          ? {}
          : { mission: metadata.mission }),
        sections,
      };
}

export function validateImportedInputs(
  metadata: MappedFrontmatter,
  ast: readonly MarkdownBlockContent[],
  kind: ImportKind,
  schemas: FacetInputSchemas = firstPartyFacetInputSchemas(),
): Diagnostic[] {
  const template = kind === "skill" ? SKILL_TEMPLATE : AGENT_TEMPLATE;
  const markdownSchema = schemas[MARKDOWN_TEMPLATE];
  const instanceSchema = schemas[template];
  const diagnostics: Diagnostic[] = [];
  if (!markdownSchema) {
    diagnostics.push(
      error(
        "import-validation-failed",
        `could not load the ${MARKDOWN_TEMPLATE} input schema`,
      ),
    );
  } else {
    diagnostics.push(
      ...validateTemplateFacetInput(MARKDOWN_TEMPLATE, markdownSchema, ast),
    );
  }
  if (!instanceSchema) {
    diagnostics.push(
      error(
        "import-validation-failed",
        `could not load the ${template} input schema`,
      ),
    );
  } else {
    diagnostics.push(
      ...validateTemplateFacetInput(
        template,
        instanceSchema,
        instanceInput(metadata, ast, kind),
      ),
    );
  }
  return diagnostics;
}

export type LocalPackPlan = Readonly<{
  outputDirectory: string;
  id: string;
  files: readonly Readonly<{ path: string; contents: string }>[];
}>;

export type LocalPackPlanInput = Readonly<{
  outputDirectory: string;
  id: string;
  kind: ImportKind;
  metadata: MappedFrontmatter;
  ast: readonly MarkdownBlockContent[];
  packVersion: string;
}>;

function jsonc(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function instanceFacetFor(
  kind: ImportKind,
  metadata: MappedFrontmatter,
  ast: readonly MarkdownBlockContent[],
): Record<string, unknown> {
  return {
    $template: kind === "skill" ? SKILL_TEMPLATE : AGENT_TEMPLATE,
    ...instanceInput(metadata, ast, kind),
  };
}

function collectionFor(kind: ImportKind): "agents" | "skills" {
  return kind === "skill" ? "skills" : "agents";
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function planLocalPack(input: LocalPackPlanInput): LocalPackPlan {
  const collection = collectionFor(input.kind);
  const packageManifest = {
    name: input.id,
    version: "0.0.0",
    atlante: { format: 1 },
    dependencies: { [FIRST_PARTY_PACKAGE]: input.packVersion },
  };
  const preset = {
    $schema: SCHEMA_URI,
    [collection]: {
      [input.id]: {
        $instance: `./${input.id}`,
        description: input.metadata.description,
      },
    },
  };
  return {
    outputDirectory: input.outputDirectory,
    id: input.id,
    files: [
      {
        path: join(input.outputDirectory, "package.json"),
        contents: jsonc(packageManifest),
      },
      {
        path: join(input.outputDirectory, "atlante.jsonc"),
        contents: jsonc(preset),
      },
      {
        path: join(input.outputDirectory, input.id, "instance.jsonc"),
        contents: jsonc(
          instanceFacetFor(input.kind, input.metadata, input.ast),
        ),
      },
    ],
  };
}

export type LocalPackMergePlan = Readonly<{
  outputDirectory: string;
  id: string;
  instancePath: string;
  instanceContents: string;
  presetPath: string;
  presetContents: string;
}>;

export type LocalPackMergePlanInput = Readonly<{
  outputDirectory: string;
  id: string;
  kind: ImportKind;
  metadata: MappedFrontmatter;
  ast: readonly MarkdownBlockContent[];
  preset: Record<string, unknown>;
}>;

/** Plans the two writes that add one resource to an existing local pack. */
export function planLocalPackMerge(
  input: LocalPackMergePlanInput,
): LocalPackMergePlan {
  const collection = collectionFor(input.kind);
  const existingBindings = input.preset[collection];
  const bindings = isJsonObject(existingBindings) ? existingBindings : {};
  const preset = {
    ...input.preset,
    [collection]: {
      ...bindings,
      [input.id]: {
        $instance: `./${input.id}`,
        description: input.metadata.description,
      },
    },
  };
  return {
    outputDirectory: input.outputDirectory,
    id: input.id,
    instancePath: join(input.outputDirectory, input.id, "instance.jsonc"),
    instanceContents: jsonc(
      instanceFacetFor(input.kind, input.metadata, input.ast),
    ),
    presetPath: join(input.outputDirectory, "atlante.jsonc"),
    presetContents: jsonc(preset),
  };
}

export type ImportFileSystem = Readonly<{
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (path: string, options: { recursive: true }) => void;
  renameSync: (source: string, destination: string) => void;
  writeFileSync: (path: string, contents: string) => void;
  rmSync: (path: string, options: { recursive: true; force: true }) => void;
}>;

const defaultImportFileSystem: ImportFileSystem = {
  existsSync,
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  mkdtempSync,
  mkdirSync: (path, options) => mkdirSync(path, options),
  renameSync,
  writeFileSync: (path, contents) => writeFileSync(path, contents),
  rmSync: (path, options) => rmSync(path, options),
};

export type WriteLocalPackResult = Readonly<{
  writtenPaths: readonly string[];
  error?: string;
}>;

function relativePackPath(outputDirectory: string, filePath: string): string {
  const fileRelativePath = relative(outputDirectory, filePath);
  if (
    fileRelativePath.length === 0 ||
    isAbsolute(fileRelativePath) ||
    fileRelativePath === ".." ||
    fileRelativePath.startsWith(`..${sep}`)
  )
    throw new Error(
      `planned file is outside the output directory: ${filePath}`,
    );
  return fileRelativePath;
}

/** Writes a planned pack through a sibling staging directory and atomic rename. */
export function writeLocalPack(
  plan: LocalPackPlan,
  fileSystem: ImportFileSystem = defaultImportFileSystem,
): WriteLocalPackResult {
  if (fileSystem.existsSync(plan.outputDirectory))
    return {
      writtenPaths: [],
      error: `output directory already exists: ${plan.outputDirectory}`,
    };

  let relativePaths: string[];
  try {
    relativePaths = plan.files.map(({ path }) =>
      relativePackPath(plan.outputDirectory, path),
    );
  } catch (cause) {
    return {
      writtenPaths: [],
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }

  let stagingDirectory: string | undefined;
  try {
    const outputParent = dirname(plan.outputDirectory);
    fileSystem.mkdirSync(outputParent, { recursive: true });
    stagingDirectory = fileSystem.mkdtempSync(
      join(outputParent, `.${basename(plan.outputDirectory)}.tmp-`),
    );
    for (const [index, file] of plan.files.entries()) {
      const stagedFilePath = join(
        stagingDirectory,
        relativePaths[index] as string,
      );
      fileSystem.mkdirSync(dirname(stagedFilePath), { recursive: true });
      fileSystem.writeFileSync(stagedFilePath, file.contents);
    }
    fileSystem.renameSync(stagingDirectory, plan.outputDirectory);
    return { writtenPaths: plan.files.map(({ path }) => path) };
  } catch (cause) {
    let cleanupMessage = "";
    if (stagingDirectory !== undefined) {
      try {
        fileSystem.rmSync(stagingDirectory, { recursive: true, force: true });
      } catch (cleanupCause) {
        cleanupMessage = `; cleanup failed: ${
          cleanupCause instanceof Error
            ? cleanupCause.message
            : String(cleanupCause)
        }`;
      }
    }
    const primaryError = cause instanceof Error ? cause.message : String(cause);
    return {
      writtenPaths: [],
      error: `${primaryError}${cleanupMessage}`,
    };
  }
}

/**
 * Applies a merge plan through a staging directory inside the pack: the
 * instance lands first, then the preset; a failure before the preset rename
 * removes the written instance directory so the pack keeps its previous
 * state. After both renames the merge is committed and staging cleanup is
 * best-effort only.
 */
export function mergeLocalPack(
  plan: LocalPackMergePlan,
  fileSystem: ImportFileSystem = defaultImportFileSystem,
): WriteLocalPackResult {
  let stagingDirectory: string | undefined;
  const instanceDirectory = join(plan.outputDirectory, plan.id);
  try {
    stagingDirectory = fileSystem.mkdtempSync(
      join(plan.outputDirectory, `.${plan.id}.tmp-`),
    );
    fileSystem.writeFileSync(
      join(stagingDirectory, "instance.jsonc"),
      plan.instanceContents,
    );
    fileSystem.writeFileSync(
      join(stagingDirectory, "atlante.jsonc"),
      plan.presetContents,
    );
    fileSystem.mkdirSync(instanceDirectory, { recursive: true });
    fileSystem.renameSync(
      join(stagingDirectory, "instance.jsonc"),
      plan.instancePath,
    );
    fileSystem.renameSync(
      join(stagingDirectory, "atlante.jsonc"),
      plan.presetPath,
    );
  } catch (cause) {
    const cleanupErrors: string[] = [];
    if (stagingDirectory !== undefined) {
      try {
        fileSystem.rmSync(stagingDirectory, { recursive: true, force: true });
      } catch (cleanupCause) {
        cleanupErrors.push(
          cleanupCause instanceof Error
            ? cleanupCause.message
            : String(cleanupCause),
        );
      }
    }
    try {
      fileSystem.rmSync(instanceDirectory, { recursive: true, force: true });
    } catch (cleanupCause) {
      cleanupErrors.push(
        cleanupCause instanceof Error
          ? cleanupCause.message
          : String(cleanupCause),
      );
    }
    const primaryError = cause instanceof Error ? cause.message : String(cause);
    return {
      writtenPaths: [],
      error:
        cleanupErrors.length === 0
          ? primaryError
          : `${primaryError}; cleanup failed: ${cleanupErrors.join(", ")}`,
    };
  }
  // The merge is committed. Removing the now-empty staging directory is
  // best-effort: its failure must never roll back a committed merge.
  try {
    fileSystem.rmSync(stagingDirectory, { recursive: true, force: true });
  } catch {
    // A leftover staging directory is harmless.
  }
  return { writtenPaths: [plan.instancePath, plan.presetPath] };
}

export type ImportOptions = Readonly<{
  kind: ImportKind;
  name?: string;
}>;

export type ImportDependencies = Partial<ImportFileSystem> &
  Readonly<{
    packVersion?: string;
    facetInputSchemas?: FacetInputSchemas;
  }>;

function inputStem(input: string): string {
  return basename(input, extname(input));
}

function importError(
  code: string,
  message: string,
  source?: string,
  cause?: unknown,
): Diagnostic {
  return error(code, message, {
    ...(source ? { source } : {}),
    ...(cause === undefined
      ? {}
      : { cause: cause instanceof Error ? cause.message : String(cause) }),
  });
}

/** Runs parse, lowering, validation, and fail-closed local-pack writing. */
export function runImportWithDependencies(
  input: string,
  outputDirectory: string,
  options: ImportOptions,
  dependencies: ImportDependencies = {},
): number {
  const fileSystem: ImportFileSystem = {
    ...defaultImportFileSystem,
    ...dependencies,
  };
  const diagnostics: Diagnostic[] = [];

  if (!fileSystem.existsSync(input)) {
    printDiagnostics([
      importError(
        "input-not-found",
        `Markdown input does not exist: ${input}`,
        input,
      ),
    ]);
    return 1;
  }

  let sourceText: string;
  try {
    sourceText = fileSystem.readFileSync(input, "utf8");
  } catch (cause) {
    printDiagnostics([
      importError(
        "input-unreadable",
        `could not read Markdown input: ${input}`,
        input,
        cause,
      ),
    ]);
    return 1;
  }

  const parsed = parseMarkdownSource(sourceText, input);
  diagnostics.push(...parsed.diagnostics);
  const lowered = lowerToAtlanteAst(parsed.tree, input);
  diagnostics.push(...lowered.diagnostics);
  const mapped = mapFrontmatter(
    parsed.frontmatter,
    options.kind,
    input,
    parsed.frontmatterLocation,
  );
  diagnostics.push(...mapped.diagnostics);

  // Precedence: explicit --name, then frontmatter name, then the file stem.
  const requestedId = options.name ?? mapped.metadata.id ?? inputStem(input);
  const id = sanitizeResourceId(requestedId);
  if (!id) {
    diagnostics.push(
      importError(
        "invalid-import-name",
        "the import name must contain an ASCII letter or digit and be at most 64 characters after sanitization",
      ),
    );
  }

  if (hasErrors(diagnostics)) {
    printDiagnostics(sortDiagnostics(diagnostics));
    return 1;
  }

  // Auto-detection: an existing directory merges only when it is a local
  // pack (package.json + atlante.jsonc); anything else is refused.
  let mergePreset: Record<string, unknown> | undefined;
  if (fileSystem.existsSync(outputDirectory)) {
    const presetPath = join(outputDirectory, "atlante.jsonc");
    const manifestPath = join(outputDirectory, "package.json");
    if (
      !fileSystem.existsSync(manifestPath) ||
      !fileSystem.existsSync(presetPath)
    ) {
      diagnostics.push(
        importError(
          "import-target-exists",
          `output directory exists but is not an Atlante local pack: ${outputDirectory}`,
        ),
      );
    } else if (id) {
      const collection = collectionFor(options.kind);
      let parsedPreset: unknown;
      try {
        const parseErrors: ParseError[] = [];
        parsedPreset = parseJsonc(
          fileSystem.readFileSync(presetPath, "utf8"),
          parseErrors,
        );
        if (parseErrors.length > 0 || !isJsonObject(parsedPreset)) {
          diagnostics.push(
            importError(
              "malformed-jsonc",
              "the existing pack preset is not valid JSONC",
              presetPath,
            ),
          );
        }
      } catch (cause) {
        diagnostics.push(
          importError(
            "malformed-jsonc",
            "the existing pack preset could not be read",
            presetPath,
            cause,
          ),
        );
      }
      const existingBindings = isJsonObject(parsedPreset)
        ? parsedPreset[collection]
        : undefined;
      if (
        isJsonObject(parsedPreset) &&
        existingBindings !== undefined &&
        !isJsonObject(existingBindings)
      ) {
        diagnostics.push(
          importError(
            "malformed-jsonc",
            `the existing pack preset "${collection}" collection is not an object`,
            presetPath,
          ),
        );
      } else if (isJsonObject(parsedPreset)) {
        if (fileSystem.existsSync(join(outputDirectory, id))) {
          diagnostics.push(
            importError(
              "import-binding-exists",
              `the target pack already contains a resource named "${id}"; pass --name to use a different ID`,
            ),
          );
        } else if (isJsonObject(existingBindings) && id in existingBindings) {
          diagnostics.push(
            importError(
              "import-binding-exists",
              `the target pack already has a "${collection}" binding named "${id}"; pass --name to use a different ID`,
            ),
          );
        } else {
          mergePreset = parsedPreset;
        }
      }
    }
  }

  if (hasErrors(diagnostics)) {
    printDiagnostics(sortDiagnostics(diagnostics));
    return 1;
  }

  let packVersion: string;
  let schemas: FacetInputSchemas;
  try {
    packVersion = dependencies.packVersion ?? firstPartyPackVersion();
    schemas = dependencies.facetInputSchemas ?? firstPartyFacetInputSchemas();
  } catch (cause) {
    diagnostics.push(
      importError(
        "import-validation-failed",
        "could not load the first-party pack required to validate the import",
        undefined,
        cause,
      ),
    );
    printDiagnostics(sortDiagnostics(diagnostics));
    return 1;
  }

  diagnostics.push(
    ...validateImportedInputs(
      mapped.metadata,
      lowered.ast,
      options.kind,
      schemas,
    ),
  );
  if (hasErrors(diagnostics)) {
    printDiagnostics(sortDiagnostics(diagnostics));
    return 1;
  }

  const written = mergePreset
    ? mergeLocalPack(
        planLocalPackMerge({
          outputDirectory,
          id: id as string,
          kind: options.kind,
          metadata: mapped.metadata,
          ast: lowered.ast,
          preset: mergePreset,
        }),
        fileSystem,
      )
    : writeLocalPack(
        planLocalPack({
          outputDirectory,
          id: id as string,
          kind: options.kind,
          metadata: mapped.metadata,
          ast: lowered.ast,
          packVersion,
        }),
        fileSystem,
      );
  if (written.error) {
    diagnostics.push(
      importError(
        "import-write-failed",
        "could not write the local pack",
        undefined,
        written.error,
      ),
    );
    printDiagnostics(sortDiagnostics(diagnostics));
    return 1;
  }

  printDiagnostics(sortDiagnostics(diagnostics));
  const styler = createStyler();
  console.log(`${styler.success("imported")} ${styler.dim(outputDirectory)}`);
  return 0;
}
