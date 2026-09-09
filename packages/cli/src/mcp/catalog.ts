import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOCUMENTATION_CATALOG_VERSION = "atlante-docs/v1" as const;
export const DOCUMENTATION_MAX_RESPONSE_BYTES = 64 * 1024;

export type DocumentationSourceKind = "documentation" | "specification";

export type DocumentationHeading = Readonly<{
  id: string;
  level: number;
  title: string;
}>;

export type DocumentationSection = Readonly<{
  id: string;
  level: number;
  title: string;
  content: string;
  searchable_text: string;
}>;

export type DocumentationDocument = Readonly<{
  kind: DocumentationSourceKind;
  id: string;
  source_path: string;
  source_url?: string;
  title: string;
  description: string;
  headings: readonly DocumentationHeading[];
  sections: readonly DocumentationSection[];
  content: string;
  searchable_text: string;
  preamble_searchable_text?: string;
}>;

export type DocumentationCatalog = Readonly<{
  schema_version: typeof DOCUMENTATION_CATALOG_VERSION;
  source_hash: string;
  documents: readonly DocumentationDocument[];
}>;

export type CatalogDiagnostic = Readonly<{
  code:
    | "catalog-unavailable"
    | "catalog-invalid"
    | "doc-not-found"
    | "doc-section-not-found"
    | "doc-response-too-large"
    | "doc-query-empty";
  message: string;
}>;

export type DocumentationSearchMatch = Readonly<{
  source_kind: DocumentationSourceKind;
  document_id: string;
  section_id: string | null;
  title: string;
  heading: string | null;
  excerpt: string;
  score: number;
  source_url?: string;
}>;

export type DocumentationReadResult =
  | Readonly<{
      status: "ok";
      document_id: string;
      section_id: string | null;
      source_kind: DocumentationSourceKind;
      title: string;
      heading: string | null;
      description: string;
      source_path: string;
      source_url?: string;
      headings: readonly DocumentationHeading[];
      content: string;
      diagnostic?: undefined;
    }>
  | Readonly<{
      status: "diagnostic";
      diagnostic: CatalogDiagnostic;
      document_id?: undefined;
      section_id?: undefined;
      source_kind?: undefined;
      title?: undefined;
      heading?: undefined;
      description?: undefined;
      source_path?: undefined;
      source_url?: undefined;
      headings?: undefined;
      content?: undefined;
    }>;

export type DocumentationCatalogLoadResult =
  | Readonly<{ status: "available"; catalog: DocumentationCatalog }>
  | Readonly<{ status: "unavailable"; diagnostic: CatalogDiagnostic }>;

type SourceFile = Readonly<{
  relativePath: string;
  bytes: Uint8Array;
  text: string;
  kind: DocumentationSourceKind;
  id: string;
  sourceUrl?: string;
}>;

type ParsedSource = Readonly<{
  title?: string;
  description?: string;
  body: string;
}>;

type ParsedHeading = Readonly<{
  id: string;
  level: number;
  title: string;
  line: number;
}>;

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'"))
      return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(text: string): ParsedSource {
  const lines = text.replaceAll("\r\n", "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { body: lines.join("\n") };

  const closing = lines.findIndex(
    (line, index) =>
      index > 0 && (line.trim() === "---" || line.trim() === "..."),
  );
  if (closing < 0) return { body: lines.join("\n") };

  let title: string | undefined;
  let description: string | undefined;
  for (const line of lines.slice(1, closing)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = stripQuotes(line.slice(separator + 1));
    if (key === "title" && value.length > 0) title = value;
    if (key === "description" && value.length > 0) description = value;
  }

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    body: lines
      .slice(closing + 1)
      .join("\n")
      .replace(/^\n+/, ""),
  };
}

function slug(value: string, fallback: string): string {
  const result = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result || fallback;
}

function headingTitle(raw: string): string {
  return raw
    .trim()
    .replace(/\s+#+\s*$/, "")
    .trim();
}

function parseHeadings(body: string): ParsedHeading[] {
  const headings: ParsedHeading[] = [];
  const used = new Map<string, number>();
  let fenced = false;
  for (const [line, value] of body.split("\n").entries()) {
    if (/^\s*(```|~~~)/.test(value)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(value);
    if (!match) continue;
    const level = match[1]?.length ?? 1;
    const title = headingTitle(match[2] ?? "");
    if (title.length === 0) continue;
    const base = slug(title, `section-${headings.length + 1}`);
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    headings.push({
      id: count === 1 ? base : `${base}-${count}`,
      level,
      title,
      line,
    });
  }
  return headings;
}

function sectionContent(
  body: string,
  heading: ParsedHeading,
  headings: readonly ParsedHeading[],
): string {
  const lines = body.split("\n");
  const end =
    headings.find(
      (candidate) =>
        candidate.line > heading.line && candidate.level <= heading.level,
    )?.line ?? lines.length;
  return lines
    .slice(heading.line + 1, end)
    .join("\n")
    .trim();
}

function firstParagraph(body: string): string {
  const lines = body.split("\n");
  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length > 0) {
      paragraphs.push(current.join(" ").trim());
      current = [];
    }
  };
  for (const line of lines) {
    if (line.trim().length === 0 || /^#{1,6}\s/.test(line)) flush();
    else current.push(line.trim());
  }
  flush();
  return paragraphs[0] ?? "";
}

function preamble(body: string, headings: readonly ParsedHeading[]): string {
  const firstHeading = headings[0]?.line;
  if (firstHeading === undefined) return body;
  return body.split("\n").slice(0, firstHeading).join("\n");
}

function searchable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_>#[\](){}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function documentFromSource(source: SourceFile): DocumentationDocument {
  const parsed = parseFrontmatter(source.text);
  const body = parsed.body.trim();
  const parsedHeadings = parseHeadings(body);
  const preambleSearchableText = searchable(preamble(body, parsedHeadings));
  const sections = parsedHeadings
    .filter(({ level }) => level > 1)
    .map((heading) => {
      const content = sectionContent(body, heading, parsedHeadings);
      return {
        id: heading.id,
        level: heading.level,
        title: heading.title,
        content,
        searchable_text: searchable(`${heading.title}\n${content}`),
      };
    });
  const title =
    parsed.title ??
    parsedHeadings.find(({ level }) => level === 1)?.title ??
    basename(source.id).replace(/[-_]+/g, " ");
  const description = parsed.description ?? firstParagraph(body);

  return {
    kind: source.kind,
    id: source.id,
    source_path: source.relativePath,
    ...(source.sourceUrl ? { source_url: source.sourceUrl } : {}),
    title,
    description,
    headings: parsedHeadings.map(({ id, level, title: headingTitleValue }) => ({
      id,
      level,
      title: headingTitleValue,
    })),
    sections,
    content: body,
    searchable_text: searchable(`${title}\n${description}\n${body}`),
    preamble_searchable_text: preambleSearchableText,
  };
}

function documentationFiles(root: string): SourceFile[] {
  const docsRoot = join(root, "docs", "src", "content", "docs");
  const paths: string[] = [];
  const visit = (directory: string): void => {
    let entries: Dirent<string>[];
    try {
      entries = readdirSync(directory, {
        encoding: "utf8",
        withFileTypes: true,
      });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) =>
      compareCodeUnits(left.name, right.name),
    )) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (
        entry.isFile() &&
        (entry.name.endsWith(".md") || entry.name.endsWith(".mdx"))
      )
        paths.push(path);
    }
  };
  if (!existsSync(docsRoot)) return [];
  visit(docsRoot);

  return paths.map((path) => {
    const relativePath = normalizedPath(relative(root, path));
    const id = normalizedPath(relative(docsRoot, path)).replace(
      /\.(?:md|mdx)$/,
      "",
    );
    const bytes = new Uint8Array(readFileSync(path));
    return {
      relativePath,
      bytes,
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      kind: "documentation" as const,
      id,
      sourceUrl: `https://docs.atlante.sh/${id}`,
    };
  });
}

function specificationFile(root: string): SourceFile | undefined {
  const path = join(root, "SPECIFICATION.md");
  if (!existsSync(path)) return undefined;
  const bytes = new Uint8Array(readFileSync(path));
  return {
    relativePath: "SPECIFICATION.md",
    bytes,
    text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    kind: "specification",
    id: "specification",
    sourceUrl: "https://github.com/atlante/atlante/blob/main/SPECIFICATION.md",
  };
}

function sourceHash(sources: readonly SourceFile[]): string {
  const hash = createHash("sha256");
  for (const source of sources) {
    hash.update(source.relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(source.bytes);
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

/** Builds the deterministic catalog from the authoritative documentation tree. */
export function generateDocumentationCatalog(
  root: string,
): DocumentationCatalog {
  const projectRoot = resolve(root);
  const sources = [
    ...documentationFiles(projectRoot),
    specificationFile(projectRoot),
  ].filter((source): source is SourceFile => source !== undefined);
  sources.sort((left, right) =>
    compareCodeUnits(left.relativePath, right.relativePath),
  );
  if (sources.length === 0)
    throw new Error("documentation sources are unavailable");

  return {
    schema_version: DOCUMENTATION_CATALOG_VERSION,
    source_hash: sourceHash(sources),
    documents: sources
      .map(documentFromSource)
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
  };
}

function termsOf(query: string): string[] {
  return [...new Set(query.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
}

function occurrences(text: string, term: string): number {
  let count = 0;
  let offset = 0;
  while (true) {
    const found = text.indexOf(term, offset);
    if (found < 0) return count;
    count += 1;
    offset = found + term.length;
  }
}

function excerpt(text: string, terms: readonly string[]): string {
  const plain = searchable(text);
  const lower = plain.toLowerCase();
  const first = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  const start = Math.max(0, (first ?? 0) - 80);
  const end = Math.min(plain.length, start + 300);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < plain.length ? "…" : "";
  return `${prefix}${plain.slice(start, end).trim()}${suffix}`;
}

function searchScore(
  document: DocumentationDocument,
  section: DocumentationSection | undefined,
  terms: readonly string[],
  query: string,
  includeDocumentContext = true,
): number {
  const text = (
    section?.searchable_text ?? document.searchable_text
  ).toLowerCase();
  const metadata = includeDocumentContext
    ? searchable(
        `${document.title}\n${document.description}\n${
          document.preamble_searchable_text ?? ""
        }`,
      ).toLowerCase()
    : "";
  const heading = section?.title?.toLowerCase() ?? "";
  const documentTitle = includeDocumentContext
    ? document.title.toLowerCase()
    : "";
  const sectionScore = terms.reduce(
    (total, term) => total + occurrences(text, term) * 2,
    0,
  );
  const metadataScore = terms.reduce(
    (total, term) => total + occurrences(metadata, term),
    0,
  );
  const bodyScore = sectionScore > 0 ? sectionScore : metadataScore;
  const headingScore = terms.reduce(
    (total, term) =>
      total +
      occurrences(heading, term) * 8 +
      occurrences(documentTitle, term) * 8,
    0,
  );
  const normalizedQuery = query.toLowerCase().trim();
  const phraseScore = text.includes(normalizedQuery)
    ? 4
    : sectionScore === 0 && metadata.includes(normalizedQuery)
      ? 2
      : 0;
  return bodyScore + headingScore + phraseScore;
}

/** Returns bounded deterministic matches ranked by local text evidence only. */
export function searchDocumentation(
  catalog: DocumentationCatalog,
  query: string,
  options: Readonly<{ limit?: number }> = {},
): DocumentationSearchMatch[] {
  const terms = termsOf(query);
  if (terms.length === 0) return [];
  const normalizedQuery = query.trim().toLowerCase();
  const candidates: DocumentationSearchMatch[] = [];
  for (const document of catalog.documents) {
    const sections =
      document.sections.length > 0 ? document.sections : [undefined];
    const hasSectionEvidence = document.sections.some(
      (section) =>
        searchScore(document, section, terms, normalizedQuery, false) > 0,
    );
    for (const [index, section] of sections.entries()) {
      const score = searchScore(
        document,
        section,
        terms,
        normalizedQuery,
        !hasSectionEvidence && index === 0,
      );
      if (score === 0) continue;
      candidates.push({
        source_kind: document.kind,
        document_id: document.id,
        section_id: section?.id ?? null,
        title: document.title,
        heading: section?.title ?? null,
        excerpt: excerpt(section?.content ?? document.content, terms),
        score,
        ...(document.source_url ? { source_url: document.source_url } : {}),
      });
    }
  }
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      compareCodeUnits(left.document_id, right.document_id) ||
      compareCodeUnits(left.section_id ?? "", right.section_id ?? ""),
  );
  const limit = Math.max(1, Math.min(20, Math.trunc(options.limit ?? 10)));
  return candidates.slice(0, limit);
}

function catalogSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Reads a known page/document or section without fabricating missing content. */
export function readDocumentation(
  catalog: DocumentationCatalog,
  documentId: string,
  sectionId?: string,
  maxBytes = DOCUMENTATION_MAX_RESPONSE_BYTES,
): DocumentationReadResult {
  const document = catalog.documents.find(({ id }) => id === documentId);
  if (!document)
    return {
      status: "diagnostic",
      diagnostic: {
        code: "doc-not-found",
        message: `documentation document "${documentId}" was not found`,
      },
    };

  const section =
    sectionId === undefined
      ? undefined
      : document.sections.find(({ id }) => id === sectionId);
  if (sectionId !== undefined && !section)
    return {
      status: "diagnostic",
      diagnostic: {
        code: "doc-section-not-found",
        message: `documentation section "${sectionId}" was not found in "${documentId}"`,
      },
    };

  const result: DocumentationReadResult = {
    status: "ok",
    document_id: document.id,
    section_id: section?.id ?? null,
    source_kind: document.kind,
    title: document.title,
    heading: section?.title ?? null,
    description: document.description,
    source_path: document.source_path,
    ...(document.source_url ? { source_url: document.source_url } : {}),
    headings: document.headings,
    content: section?.content ?? document.content,
  };
  if (catalogSize(result) > Math.max(1, Math.trunc(maxBytes)))
    return {
      status: "diagnostic",
      diagnostic: {
        code: "doc-response-too-large",
        message: `documentation response exceeds the ${Math.max(1, Math.trunc(maxBytes))}-byte limit`,
      },
    };
  return result;
}

function parseCatalog(value: unknown): DocumentationCatalog | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.schema_version !== DOCUMENTATION_CATALOG_VERSION ||
    typeof record.source_hash !== "string" ||
    !/^[0-9a-f]{64}$/.test(record.source_hash) ||
    !Array.isArray(record.documents)
  )
    return undefined;
  if (
    !record.documents.every((document) => {
      if (
        typeof document !== "object" ||
        document === null ||
        Array.isArray(document)
      )
        return false;
      const candidate = document as Record<string, unknown>;
      return (
        (candidate.kind === "documentation" ||
          candidate.kind === "specification") &&
        typeof candidate.id === "string" &&
        typeof candidate.source_path === "string" &&
        typeof candidate.title === "string" &&
        typeof candidate.description === "string" &&
        typeof candidate.content === "string" &&
        typeof candidate.searchable_text === "string" &&
        Array.isArray(candidate.headings) &&
        Array.isArray(candidate.sections)
      );
    })
  )
    return undefined;
  return value as DocumentationCatalog;
}

function bundledCatalogPath(): string {
  return fileURLToPath(new URL("../mcp/catalog.json", import.meta.url));
}

function sourceRootFrom(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    if (
      existsSync(join(current, "SPECIFICATION.md")) &&
      existsSync(join(current, "docs", "src", "content", "docs"))
    )
      return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Loads the generated catalog, falling back to repository sources in local development. */
export function loadDocumentationCatalog(
  projectRoot = process.cwd(),
): DocumentationCatalogLoadResult {
  const bundledPath = bundledCatalogPath();
  if (existsSync(bundledPath)) {
    try {
      const parsed = parseCatalog(
        JSON.parse(readFileSync(bundledPath, "utf8")),
      );
      if (parsed) return { status: "available", catalog: parsed };
    } catch {
      // Report the invalid artifact below rather than silently using another source.
    }
    return {
      status: "unavailable",
      diagnostic: {
        code: "catalog-invalid",
        message: "the bundled documentation catalog is invalid",
      },
    };
  }

  const sourceRoot = sourceRootFrom(projectRoot);
  if (sourceRoot) {
    try {
      return {
        status: "available",
        catalog: generateDocumentationCatalog(sourceRoot),
      };
    } catch {
      // Fall through to the explicit unavailable state.
    }
  }
  return {
    status: "unavailable",
    diagnostic: {
      code: "catalog-unavailable",
      message: "the bundled documentation catalog is unavailable",
    },
  };
}

/** Validates a generated catalog without exposing parser internals. */
export function isDocumentationCatalog(
  value: unknown,
): value is DocumentationCatalog {
  return parseCatalog(value) !== undefined;
}
