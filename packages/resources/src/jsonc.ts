import { type Node, type ParseError, parseTree } from "jsonc-parser";
import type { JsonObject, JsonValue } from "./types.js";

const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"]);

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

function parseSource(
  source: string,
  options: { allowTrailingComma: boolean; disallowComments: boolean },
): unknown {
  const errors: ParseError[] = [];
  const parsed = parseTree(source, errors, options);
  if (errors.length > 0 || !parsed) {
    throw new Error(`JSONC parse error at offset ${errors[0]?.offset ?? 0}`);
  }
  return materialize(parsed);
}

/** Parses one selected JSONC file and never enumerates sibling resources. */
export function parseJsonc(source: string): unknown {
  return parseSource(source, {
    allowTrailingComma: true,
    disallowComments: false,
  });
}

/** Parses one selected strict JSON file and rejects JSONC extensions. */
export function parseJson(source: string): unknown {
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
  return Object.entries(value).every(
    ([key, child]) => !unsafeObjectKeys.has(key) && isSafeJsonValue(child),
  );
}
