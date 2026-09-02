import {
  findNodeAtLocation,
  getNodeValue,
  type ParseError,
  parseTree,
} from "jsonc-parser";

export type JsoncParseOptions = {
  allowTrailingComma?: boolean;
  disallowComments?: boolean;
};

export type JsoncParseError = {
  error: number;
  offset: number;
  length: number;
};

export type JsoncParseResult = {
  value?: unknown;
  errors: JsoncParseError[];
};

export function positionOf(text: string, offset: number) {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function pointerSegments(pointer: string | undefined): string[] {
  if (!pointer || pointer === "" || pointer === "/") return [];
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

export function locationAtPointer(
  text: string,
  pointer: string | undefined,
): { line: number; column: number } | undefined {
  if (pointer === undefined) return undefined;
  const parseErrors: ParseError[] = [];
  const tree = parseTree(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  const node = tree
    ? findNodeAtLocation(tree, pointerSegments(pointer))
    : undefined;
  return node ? positionOf(text, node.offset) : undefined;
}

/** Parses JSON or JSONC while retaining syntax errors for fail-closed callers. */
export function parseJsonc(
  text: string,
  options: JsoncParseOptions = {},
): JsoncParseResult {
  const parseErrors: ParseError[] = [];
  const tree = parseTree(text, parseErrors, options);
  return {
    ...(tree ? { value: getNodeValue(tree) } : {}),
    errors: parseErrors.map(({ error, offset, length }) => ({
      error,
      offset,
      length,
    })),
  };
}
