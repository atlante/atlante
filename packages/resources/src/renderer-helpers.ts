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

const ALWAYS_ESCAPED = new Set([
  "\\",
  "`",
  "*",
  "_",
  "[",
  "]",
  "<",
  "!",
  '"',
  "~",
]);
const LINE_START_ESCAPED = new Set(["-", "+", "#", ">", "=", "|"]);
const ENTITY_PATTERN = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

type HelperOptions = { data?: { gfmTable?: boolean } };

function insideTableCell(options: HelperOptions | undefined): boolean {
  return options?.data?.gfmTable === true;
}

function isEntityLike(value: string, index: number): boolean {
  return ENTITY_PATTERN.test(value.slice(index));
}

/** Escapes an ordered-list marker (`1.` or `12)`) at a line start. */
function escapeOrderMarker(
  value: string,
  index: number,
): { text: string; end: number } {
  let digits = index;
  let current = value[digits];
  while (current !== undefined && current >= "0" && current <= "9") {
    digits += 1;
    current = value[digits];
  }
  const delimiter = current;
  if (digits > index && (delimiter === "." || delimiter === ")"))
    return {
      text: `${value.slice(index, digits)}\\${delimiter}`,
      end: digits + 1,
    };
  return { text: value[index] ?? "", end: index + 1 };
}

function escapedProseCharacter(
  value: string,
  index: number,
  character: string,
  lineStart: boolean,
  escapePipes: boolean,
): { text: string; end: number } {
  if (character === "|" && escapePipes) return { text: "\\|", end: index + 1 };
  if (lineStart && LINE_START_ESCAPED.has(character))
    return { text: `\\${character}`, end: index + 1 };
  if (lineStart && character >= "0" && character <= "9")
    return escapeOrderMarker(value, index);
  if (ALWAYS_ESCAPED.has(character))
    return { text: `\\${character}`, end: index + 1 };
  if (character === "&" && isEntityLike(value, index))
    return { text: "\\&", end: index + 1 };
  return { text: character, end: index + 1 };
}

/**
 * Backslash-escapes prose so re-parsing yields the same literal text:
 * characters that open inline constructs everywhere, entity-like ampersands,
 * and line-start-sensitive characters at line starts. Leading spaces and tabs
 * on a line are encoded as character references so they stay literal text
 * instead of block indentation or list-marker alignment. Inside a GFM table
 * cell (see the `tableCell` block helper), pipes are escaped as well.
 */
export function escapeProse(value: string, options?: HelperOptions): string {
  const escapePipes = insideTableCell(options);
  let output = "";
  let index = 0;
  let lineStart = true;
  while (index < value.length) {
    const character = value[index];
    if (character === undefined) break;
    if (character === "\n") {
      output += character;
      index += 1;
      lineStart = true;
      continue;
    }
    if (lineStart && (character === " " || character === "\t")) {
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
    );
    output += escaped.text;
    index = escaped.end;
    lineStart = false;
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
 * space on each side (all-space values are preserved as-is and need no
 * padding). Inside a GFM table cell, pipes are escaped so the cell cannot
 * split.
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

/**
 * Renders a CommonMark fenced code block. The fence always exceeds every run
 * of its character in `value`, so the body can never close the block early;
 * when backticks cannot be used (a long backtick run, or backticks in the info
 * string, which backtick fences forbid), a tilde fence of the same guarantee
 * is chosen. The body always ends with a newline so a value's own trailing
 * newline is preserved by the blank line before the closing fence.
 */
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
  const useBackticks =
    !info.some((part) => part.includes("`")) && backtickRun < tildeRun + 1;
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

/**
 * Block helper: prefixes every line of the rendered block, including empty
 * ones. Used for block quote bodies.
 */
export function linePrefix(
  prefix: string,
  options: BlockOptions,
  context?: unknown,
): string {
  return prefixLines(options.fn(context), String(prefix));
}

/**
 * Block helper: prefixes every line except the first, so list items keep
 * their first block on the marker line while continuation lines indent.
 */
export function indentExceptFirst(
  prefix: string,
  options: BlockOptions,
  context?: unknown,
): string {
  const lines = options.fn(context).split("\n");
  const first = lines.shift() ?? "";
  return [first, ...lines.map((line) => `${prefix}${line}`)].join("\n");
}

/**
 * Block helper: renders its block inside a GFM table cell, so nested
 * serialization escapes pipes for the remainder of the cell context.
 */
export function inTableCell(
  options: BlockOptions & HelperOptions,
  context?: unknown,
): string {
  const frame = createFrame(options.data);
  frame.gfmTable = true;
  return options.fn(context, { data: frame });
}
