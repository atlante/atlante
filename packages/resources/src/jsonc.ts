import { type Node, type ParseError, parseTree } from "jsonc-parser";
import type { JsonObject, JsonValue } from "./types.js";

export type JsoncLocation = Readonly<{ line: number; column: number }>;

export type ParsedJsonc = Readonly<{
  value: unknown;
  locations: Readonly<Record<string, JsoncLocation>>;
}>;

export class JsoncParseError extends Error {
  readonly offset: number;
  readonly location: JsoncLocation;

  constructor(offset: number, location: JsoncLocation) {
    super("selected JSONC is malformed");
    this.name = "JsoncParseError";
    this.offset = offset;
    this.location = Object.freeze(location);
  }
}

function materializeObject(node: Node): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (const property of node.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (keyNode?.type !== "string" || !valueNode) {
      throw new Error("JSON object property could not be materialized");
    }
    Object.defineProperty(object, keyNode.value, {
      configurable: true,
      enumerable: true,
      value: materialize(valueNode),
      writable: true,
    });
  }
  return object;
}

function materialize(node: Node): unknown {
  if (node.type === "object") return materializeObject(node);
  if (node.type === "array") return (node.children ?? []).map(materialize);
  return node.value;
}

function positionOf(
  lineStarts: readonly number[],
  offset: number,
): JsoncLocation {
  let low = 0;
  let high = lineStarts.length;
  for (const _ of lineStarts) {
    const middle = low + Math.floor((high - low) / 2);
    const lineStart = lineStarts[middle] ?? Number.POSITIVE_INFINITY;
    if (lineStart <= offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const lineStart = lineStarts[low - 1] ?? 0;
  return {
    line: low,
    column: offset - lineStart + 1,
  };
}

function pointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function collectObjectLocations(
  node: Node,
  lineStarts: readonly number[],
  pointer: string,
  output: Record<string, JsoncLocation>,
): void {
  for (const property of node.children ?? []) {
    const [keyNode, valueNode] = property.children ?? [];
    if (!keyNode || !valueNode || typeof keyNode.value !== "string") continue;
    collectLocations(
      valueNode,
      lineStarts,
      `${pointer}/${pointerSegment(keyNode.value)}`,
      output,
    );
  }
}

function collectArrayLocations(
  node: Node,
  lineStarts: readonly number[],
  pointer: string,
  output: Record<string, JsoncLocation>,
): void {
  for (const [index, child] of (node.children ?? []).entries())
    collectLocations(child, lineStarts, `${pointer}/${index}`, output);
}

function collectLocations(
  node: Node,
  lineStarts: readonly number[],
  pointer: string,
  output: Record<string, JsoncLocation>,
): void {
  output[pointer] = positionOf(lineStarts, node.offset);
  if (node.type === "object") {
    collectObjectLocations(node, lineStarts, pointer, output);
    return;
  }
  if (node.type === "array") {
    collectArrayLocations(node, lineStarts, pointer, output);
  }
}

function parseSource(
  source: string,
  options: { allowTrailingComma: boolean; disallowComments: boolean },
): ParsedJsonc {
  const lineStarts = [0];
  for (const [index, character] of source.split("").entries()) {
    if (character === "\n") lineStarts.push(index + 1);
  }

  const errors: ParseError[] = [];
  const parsed = parseTree(source, errors, options);
  if (errors.length > 0 || !parsed) {
    const offset = errors[0]?.offset ?? 0;
    throw new JsoncParseError(offset, positionOf(lineStarts, offset));
  }
  const locations: Record<string, JsoncLocation> = {};
  collectLocations(parsed, lineStarts, "", locations);
  return { value: materialize(parsed), locations };
}

export function parseJsoncWithLocations(source: string): ParsedJsonc {
  return parseSource(source, {
    allowTrailingComma: true,
    disallowComments: false,
  });
}

export function parseJsonWithLocations(source: string): ParsedJsonc {
  return parseSource(source, {
    allowTrailingComma: false,
    disallowComments: true,
  });
}

export function isSafeJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    isSafeJsonValue(value)
  );
}

function isSafeJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isSafeJsonValue);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return false;
  return Object.values(value).every(isSafeJsonValue);
}
