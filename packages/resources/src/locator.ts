import { failResource } from "./errors.js";
import type {
  RawResourceLocator,
  ValidatedBuiltinResourceLocator,
  ValidatedResourceLocator,
} from "./types.js";

const BUILTIN_NAME_PATTERN = /^[a-z0-9-]+$/;
const FACET_FILENAMES = new Set([
  "template.jsonc",
  "template.md",
  "instance.jsonc",
  "atlante.jsonc",
  "atlante.json",
]);

export type ParsedResourceLocator =
  | { readonly kind: "local"; readonly value: ValidatedResourceLocator }
  | {
      readonly kind: "builtin";
      readonly value: ValidatedBuiltinResourceLocator;
      readonly name: string;
    };

function invalid(raw: RawResourceLocator): never {
  return failResource("invalid-locator", "resource locator is malformed", {
    locator: raw,
  });
}

function hasForbiddenLocatorSyntax(raw: string): boolean {
  return (
    raw.includes("\u0000") ||
    raw.includes("\\") ||
    raw.startsWith("/") ||
    raw.startsWith("~") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)
  );
}

function namesFacetFile(raw: string): boolean {
  return raw.split("/").some((part) => FACET_FILENAMES.has(part));
}

function builtinName(raw: string): string | undefined {
  if (!raw.startsWith("atlante/")) return undefined;
  const parts = raw.split("/");
  const name = parts[1];
  if (parts.length !== 2 || !name || !BUILTIN_NAME_PATTERN.test(name)) {
    return undefined;
  }
  return name;
}

/** Validates an authored locator without resolving it against a filesystem. */
export function validateResourceLocator(
  raw: RawResourceLocator,
): ValidatedResourceLocator {
  if (typeof raw !== "string" || raw.length === 0) return invalid(raw);
  if (hasForbiddenLocatorSyntax(raw) || namesFacetFile(raw))
    return invalid(raw);

  if (raw.startsWith("atlante/")) {
    if (!builtinName(raw)) return invalid(raw);
    return raw as ValidatedBuiltinResourceLocator;
  }

  if (!raw.startsWith("./") && !raw.startsWith("../")) return invalid(raw);
  if (raw.includes("//")) return invalid(raw);
  return raw as ValidatedResourceLocator;
}

export function parseResourceLocator(
  raw: RawResourceLocator,
): ParsedResourceLocator {
  const value = validateResourceLocator(raw);
  if (value.startsWith("atlante/")) {
    return {
      kind: "builtin",
      value: value as ValidatedBuiltinResourceLocator,
      name: value.slice("atlante/".length),
    };
  }
  return { kind: "local", value };
}
