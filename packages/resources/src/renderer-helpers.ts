import { createFrame } from "handlebars";

/**
 * Deterministic string serialization helpers registered for Handlebars
 * templates. They are pure functions: the same input always renders the same
 * bytes. The Markdown-shaped helpers implement the CommonMark serialization
 * rules the renderer relies on (escape policy, code span and fenced block
 * delimiters, link destinations, list markers); the renderer template decides
 * where each helper applies.
 */

/** Repeats `fragment` `count` times; counts below one yield an empty string. */
export function repeatText(fragment: string, count: number): string {
  return fragment.repeat(Math.max(0, Math.trunc(count)));
}

/** Prefixes every line of `value`, including empty ones, with `prefix`. */
export function prefixLines(value: string, prefix: string): string {
  return `${value}\n`
    .split("\n")
    .slice(0, -1)
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

const ALWAYS_ESCAPED = new Set(["\\", "`", "*", "_", "[", "]"]);
const LINE_START_ESCAPED = new Set(["-", "+", "#", ">", "=", "|", "~"]);
const ENTITY_PATTERN = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

type HelperOptions = {
  data?: { gfmTable?: boolean };
  hash?: {
    continuation?: string;
    leadingSpace?: boolean;
    lineStart?: boolean;
    prefix?: string;
    quoted?: boolean;
    index?: number;
    last?: boolean;
  };
  leadingSpace?: boolean;
  lineStart?: boolean;
  prefix?: string;
  quoted?: boolean;
  index?: number;
  continuation?: string;
  last?: boolean;
};

function insideTableCell(options: HelperOptions | undefined): boolean {
  return options?.data?.gfmTable === true;
}

function optionValue(
  options: HelperOptions | undefined,
  key: "leadingSpace" | "lineStart" | "quoted" | "last",
): boolean | undefined {
  return options?.[key] ?? options?.hash?.[key];
}

function optionString(
  options: HelperOptions | undefined,
  key: "continuation" | "prefix",
): string {
  const value = options?.[key] ?? options?.hash?.[key];
  return typeof value === "string" ? value : "";
}

function optionNumber(options: HelperOptions | undefined): number | undefined {
  const value = options?.index ?? options?.hash?.index;
  return typeof value === "number" ? value : undefined;
}

function isEntityLike(
  value: string,
  index: number,
  continuation: string,
): boolean {
  return ENTITY_PATTERN.test(value.slice(index) + continuation);
}

/** Escapes an ordered-list marker (`1.` or `12)`) at a line start. */
function escapeOrderMarker(
  value: string,
  index: number,
  continuation: string,
): { text: string; end: number } {
  const localLine = value.slice(index, lineEnd(value, index));
  const continuationLine = continuation.slice(
    0,
    (() => {
      const end = continuation.search(/[\r\n]/);
      return end < 0 ? continuation.length : end;
    })(),
  );
  const line = localLine + continuationLine;
  let digitCount = 0;
  while (digitCount < line.length) {
    const digit = line[digitCount];
    if (digit === undefined || digit < "0" || digit > "9") break;
    digitCount += 1;
  }
  const delimiter = line[digitCount];
  const afterDelimiter = line[digitCount + 1];
  if (
    digitCount > 0 &&
    (delimiter === "." || delimiter === ")") &&
    digitCount <= 9 &&
    (afterDelimiter === undefined ||
      afterDelimiter === "\r" ||
      afterDelimiter === "\n" ||
      /\s/.test(afterDelimiter ?? ""))
  ) {
    if (digitCount < localLine.length)
      return {
        text: `${value.slice(index, index + digitCount)}\\${delimiter}`,
        end: index + digitCount + 1,
      };
    return {
      text: `&#${value.charCodeAt(index)};`,
      end: index + 1,
    };
  }
  return { text: value[index] ?? "", end: index + 1 };
}

function lineEnd(value: string, index: number): number {
  const end = value.slice(index).search(/[\r\n]/);
  return end === -1 ? value.length : index + end;
}

function isTrailingWhitespace(
  value: string,
  index: number,
  continuation: string,
  protectsContainerEnd: boolean,
): boolean {
  const rest = value.slice(index);
  const end = rest.search(/[\r\n]/);
  if (end >= 0) return /^[ \t]*$/.test(rest.slice(0, end));
  return (
    /^[ \t]*$/.test(rest) &&
    (/^[\r\n]/.test(continuation) || protectsContainerEnd)
  );
}

function previousLineHasContent(value: string): boolean {
  const lines = value.split(/\r\n|\r|\n/);
  return (lines.at(-2) ?? "").trim().length > 0;
}

function lineStartMarker(
  value: string,
  index: number,
  character: string,
  continuation: string,
  prefix: string,
): boolean {
  const line =
    value.slice(index, lineEnd(value, index)) +
    continuation.slice(
      0,
      continuation.search(/[\r\n]/) < 0
        ? continuation.length
        : continuation.search(/[\r\n]/),
    );
  const before = prefix + value.slice(0, index);
  if (character === "#") return /^#{1,6}(?:[ \t]|$)/.test(line);
  if (character === ">") return true;
  if (character === "-" || character === "+")
    return (
      /^[-+](?:[ \t]|$)/.test(line) ||
      (character === "-" &&
        /^[ \t-]*$/.test(line) &&
        (previousLineHasContent(before) ||
          line.replace(/[ \t]/g, "").length >= 3))
    );
  if (character === "=")
    return previousLineHasContent(before) && /^[ \t]*=+[ \t]*$/.test(line);
  if (character === "~") return line.startsWith("~~~");
  return character === "|";
}

function tildeRun(
  value: string,
  index: number,
): { start: number; end: number } {
  let start = index;
  while (start > 0 && value[start - 1] === "~") start--;
  let end = index;
  while (value[end] === "~") end++;
  return { start, end };
}

function characterClass(
  value: string | undefined,
): "whitespace" | "punctuation" | "word" {
  if (value === undefined || /\s/u.test(value)) return "whitespace";
  if (/[\p{P}\p{S}]/u.test(value)) return "punctuation";
  return "word";
}

function canOpenTilde(value: string, start: number, end: number): boolean {
  const before = characterClass(value[start - 1]);
  const after = characterClass(value[end]);
  return after === "word" || (after === "punctuation" && before !== "word");
}

function canCloseTilde(value: string, start: number, end: number): boolean {
  const before = characterClass(value[start - 1]);
  const after = characterClass(value[end]);
  return before === "word" || (before === "punctuation" && after !== "word");
}

function tildeSequences(
  value: string,
): { start: number; end: number; length: number }[] {
  const sequences: { start: number; end: number; length: number }[] = [];
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "~") {
      index += 1;
      continue;
    }
    const start = index;
    while (value[index] === "~") index += 1;
    const length = index - start;
    if (length <= 2) sequences.push({ start, end: index, length });
  }
  return sequences;
}

function isTildeDelimiter(value: string, index: number): boolean {
  const run = tildeRun(value, index);
  const length = run.end - run.start;
  if (length < 1 || length > 2) return false;
  const current = { start: run.start, end: run.end, length };
  const sequences = tildeSequences(value);
  return sequences.some((candidate) => {
    if (candidate.length !== current.length) return false;
    if (candidate.start === current.start) return false;
    const between =
      candidate.start < current.start
        ? value.slice(candidate.end, current.start)
        : value.slice(current.end, candidate.start);
    if (/[\r\n]/.test(between)) return false;
    return candidate.start < current.start
      ? canOpenTilde(value, candidate.start, candidate.end) &&
          canCloseTilde(value, current.start, current.end)
      : canOpenTilde(value, current.start, current.end) &&
          canCloseTilde(value, candidate.start, candidate.end);
  });
}

function escapedProseCharacter(
  value: string,
  index: number,
  character: string,
  lineStart: boolean,
  escapePipes: boolean,
  quoted: boolean,
  continuation: string,
  prefix: string,
): { text: string; end: number } {
  if (character === "|" && escapePipes) return { text: "\\|", end: index + 1 };
  if (
    lineStart &&
    LINE_START_ESCAPED.has(character) &&
    lineStartMarker(value, index, character, continuation, prefix)
  )
    return { text: `\\${character}`, end: index + 1 };
  if (lineStart && character >= "0" && character <= "9")
    return escapeOrderMarker(value, index, continuation);
  if (
    character === "!" &&
    (value[index + 1] === "[" ||
      (value[index + 1] === undefined && continuation[0] === "["))
  )
    return { text: "\\!", end: index + 1 };
  if (character === "<") return { text: "\\<", end: index + 1 };
  if (
    character === "~" &&
    isTildeDelimiter(prefix + value + continuation, prefix.length + index)
  )
    return { text: "\\~", end: index + 1 };
  if (character === '"' && quoted) return { text: '\\"', end: index + 1 };
  if (ALWAYS_ESCAPED.has(character))
    return { text: `\\${character}`, end: index + 1 };
  if (character === "&" && isEntityLike(value, index, continuation))
    return { text: "\\&", end: index + 1 };
  return { text: character, end: index + 1 };
}

/**
 * Backslash-escapes prose while preserving the literal text through a
 * Markdown round trip. The template supplies the actual line and container
 * context; direct callers default to a block start.
 */
export function escapeProse(value: string, options?: HelperOptions): string {
  const escapePipes = insideTableCell(options);
  const quoted = optionValue(options, "quoted") === true;
  const continuation = optionString(options, "continuation");
  const prefix = optionString(options, "prefix");
  const initialLineStart = optionValue(options, "lineStart") ?? true;
  const leadingSpace = optionValue(options, "leadingSpace") === true;
  const firstInline = optionNumber(options) ?? 0;
  let output = "";
  let index = 0;
  let lineStart = initialLineStart;
  let leadingActive = leadingSpace;
  while (index < value.length) {
    const character = value[index];
    if (character === undefined) break;
    if (character === "\r") {
      output += character;
      index += 1;
      if (value[index] === "\n") {
        output += "\n";
        index += 1;
      }
      lineStart = true;
      leadingActive = false;
      continue;
    }
    if (character === "\n") {
      output += character;
      index += 1;
      lineStart = true;
      leadingActive = false;
      continue;
    }
    const atLineEnd = isTrailingWhitespace(
      value,
      index,
      continuation,
      leadingSpace && optionValue(options, "last") !== false,
    );
    if (
      (lineStart || (leadingActive && firstInline === 0) || atLineEnd) &&
      (character === " " || character === "\t")
    ) {
      output += character === " " ? "&#32;" : "&#9;";
      index += 1;
      continue;
    }
    const escaped = escapedProseCharacter(
      value,
      index,
      character,
      lineStart,
      escapePipes,
      quoted,
      lineEnd(value, index) === value.length ? continuation : "",
      prefix,
    );
    output += escaped.text;
    index = escaped.end;
    lineStart = false;
    leadingActive = false;
  }
  return output;
}

function longestRun(value: string, character: "`" | "~"): number {
  let longest = 0;
  for (const run of value.match(new RegExp(`${character}+`, "g")) ?? [])
    longest = Math.max(longest, run.length);
  return longest;
}

/**
 * Renders `value` as a CommonMark code span, widening the delimiter past any
 * embedded backtick run. CommonMark strips one surrounding space when the
 * content both starts and ends with one and does not consist entirely of
 * spaces, so values that would lose content to that strip are padded with one
 * space on each side.
 */
export function codeSpan(value: string, options?: HelperOptions): string {
  if (value === "") return "`` ``";
  const content =
    insideTableCell(options) && value.includes("|")
      ? value.replaceAll("|", "\\|")
      : value;
  const delimiter = repeatText("`", longestRun(content, "`") + 1);
  const padded =
    content.startsWith("`") ||
    content.endsWith("`") ||
    (content.startsWith(" ") && content.endsWith(" ") && /[^ ]/.test(content));
  return padded
    ? `${delimiter} ${content} ${delimiter}`
    : `${delimiter}${content}${delimiter}`;
}

/** Renders a deterministic fenced CommonMark code block. */
export function fencedCode(
  value: string,
  lang?: string,
  meta?: string,
): string {
  const info = [lang, meta].filter(
    (part): part is string => part !== undefined && part !== "",
  );
  const backtickRun = longestRun(value, "`");
  const tildeRun = longestRun(value, "~");
  const useBackticks = !info.some((part) => part.includes("`"));
  const fence = repeatText(
    useBackticks ? "`" : "~",
    Math.max(3, (useBackticks ? backtickRun : tildeRun) + 1),
  );
  return `${fence}${info.join(" ")}\n${value}\n${fence}`;
}

/**
 * Renders a link or image destination: plain when free of whitespace and
 * delimiters, otherwise wrapped in angle brackets with inner escapes.
 */
export function linkDestination(url: string, options?: HelperOptions): string {
  const escapePipes = insideTableCell(options) && url.includes("|");
  if (!/[\s()<>]/.test(url) && !escapePipes) return url;
  return `<${url.replace(/[<>\\|]/g, (character) => `\\${character}`)}>`;
}

type TableAlignment = "left" | "right" | "center" | null;

function tableWidth(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  const firstRow = rows[0];
  if (typeof firstRow !== "object" || firstRow === null) return 0;
  const cells = (firstRow as { children?: unknown }).children;
  return Array.isArray(cells) ? cells.length : 0;
}

/** Normalizes positional GFM alignments to the table header width. */
export function tableAlignments(
  align: unknown,
  rows: unknown,
): TableAlignment[] {
  const source = Array.isArray(align) ? align : [];
  const count = tableWidth(rows) || source.length;
  return Array.from({ length: count }, (_, index) => {
    const value = source[index];
    return value === "left" || value === "right" || value === "center"
      ? value
      : null;
  });
}

/** Renders the list item marker for a zero-based `index`. */
export function listItemMarker(
  index: number,
  start: number | undefined,
  ordered: boolean,
): string {
  const numericStart = start ?? 1;
  const normalizedStart = Number.isFinite(numericStart)
    ? Math.trunc(numericStart)
    : 1;
  return ordered ? `${normalizedStart + Math.trunc(index)}. ` : "- ";
}

/** Returns the continuation indent matching a marker's width. */
export function continuationIndent(marker: string): string {
  return repeatText(" ", marker.length);
}

/** Returns `n` newline characters, for deterministic block separation. */
export function newlines(count: number): string {
  return repeatText("\n", count);
}

type BlockOptions = {
  data?: { gfmTable?: boolean };
  fn: (
    context?: unknown,
    options?: { data?: { gfmTable?: boolean } },
  ) => string;
};

/** Prefixes every line of a block, including empty ones. */
export function linePrefix(
  prefix: string,
  options: BlockOptions,
  context?: unknown,
): string {
  return prefixLines(options.fn(context), String(prefix));
}

/** Prefixes every line except the first for list continuation blocks. */
export function indentExceptFirst(
  prefix: string,
  options: BlockOptions,
  context?: unknown,
): string {
  const lines = options.fn(context).split("\n");
  const first = lines.shift() ?? "";
  return [first, ...lines.map((line) => `${prefix}${line}`)].join("\n");
}

/** Marks nested rendering as occurring inside a GFM table cell. */
export function inTableCell(
  options: BlockOptions & HelperOptions,
  context?: unknown,
): string {
  const frame = createFrame(options.data);
  frame.gfmTable = true;
  return options.fn(context, { data: frame });
}

function inlineNodes(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .filter((key) => /^(?:0|[1-9][0-9]*)$/.test(key))
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => record[key]);
}

function inlineSource(value: unknown): string {
  if (Array.isArray(value)) return value.map(inlineSource).join("");
  if (typeof value !== "object" || value === null) return "";
  const node = value as Record<string, unknown>;
  const children = inlineSource(node.children);
  switch (node.type) {
    case "text":
      return typeof node.value === "string" ? node.value : "";
    case "emphasis":
      return `*${children}*`;
    case "strong":
      return `**${children}**`;
    case "delete":
      return `~~${children}~~`;
    case "inlineCode":
      return "``";
    case "link":
      return `[${children}]`;
    case "image":
      return "![ ]";
    case "break":
      return "\n";
    default:
      return "";
  }
}

function inlineSourceRange(nodes: unknown, start: number, end: number): string {
  const items = inlineNodes(nodes);
  return items?.slice(start, end).map(inlineSource).join("") ?? "";
}

/** Returns whether an inline sibling begins at a rendered line start. */
export function inlineLineStart(
  nodes: unknown,
  index: number,
  initial: boolean,
): boolean {
  const prefix = inlineSourceRange(nodes, 0, index);
  return prefix.length === 0 ? initial : /[\r\n]$/.test(prefix);
}

/** Returns whether an inline child has no rendered siblings after it. */
export function inlineLast(nodes: unknown, index: number): boolean {
  const items = inlineNodes(nodes);
  return (
    !items ||
    items.slice(index + 1).every((item) => inlineSource(item).length === 0)
  );
}

/** Returns the raw inline source rendered after the current child. */
export function inlineContinuesLine(nodes: unknown, index: number): string {
  return inlineSourceRange(nodes, index + 1, Number.MAX_SAFE_INTEGER);
}

/** Returns the raw inline source rendered before the current child. */
export function inlinePrefix(nodes: unknown, index: number): string {
  return inlineSourceRange(nodes, 0, index);
}
