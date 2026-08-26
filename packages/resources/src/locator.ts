import { failResource } from "./errors.js";
import type {
  RawResourceLocator,
  ValidatedPackageResourceLocator,
  ValidatedResourceLocator,
} from "./types.js";

const PACKAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_PATH_PATTERN = /^[^/\\]+$/;
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
      readonly kind: "package";
      readonly value: ValidatedPackageResourceLocator;
      readonly packageName: string;
      readonly subpath?: string;
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

function packageNameParts(
  parts: readonly string[],
  scoped: boolean,
): { readonly packageName: string; readonly count: number } | undefined {
  const count = scoped ? 2 : 1;
  if (parts.length < count) return undefined;
  const nameParts = parts.slice(0, count);
  const segments = scoped
    ? [nameParts[0]?.slice(1) ?? "", nameParts[1] ?? ""]
    : nameParts;
  if (!segments.every((part) => PACKAGE_NAME_PATTERN.test(part)))
    return undefined;
  return { packageName: nameParts.join("/"), count };
}

function validPackageSubpath(parts: readonly string[]): boolean {
  return parts.every(
    (part) => part !== "." && part !== ".." && PACKAGE_PATH_PATTERN.test(part),
  );
}

function packageParts(
  raw: string,
): { readonly packageName: string; readonly subpath?: string } | undefined {
  const parts = raw.split("/");
  if (!parts.every((part) => part.length > 0)) return undefined;

  const name = packageNameParts(parts, raw.startsWith("@"));
  if (!name) return undefined;
  const subparts = parts.slice(name.count);
  if (!validPackageSubpath(subparts)) return undefined;
  return {
    packageName: name.packageName,
    subpath: subparts.length > 0 ? subparts.join("/") : undefined,
  };
}

/** Validates an authored locator without resolving it against a filesystem. */
export function validateResourceLocator(
  raw: RawResourceLocator,
): ValidatedResourceLocator {
  if (typeof raw !== "string" || raw.length === 0) return invalid(raw);
  if (hasForbiddenLocatorSyntax(raw)) return invalid(raw);

  if (raw.startsWith("./") || raw.startsWith("../")) {
    if (raw.includes("//") || namesFacetFile(raw)) return invalid(raw);
    return raw as ValidatedResourceLocator;
  }

  const packageTarget = packageParts(raw);
  if (
    !packageTarget ||
    (packageTarget.subpath !== undefined &&
      namesFacetFile(packageTarget.subpath))
  )
    return invalid(raw);
  return raw as ValidatedPackageResourceLocator;
}

export function parseResourceLocator(
  raw: RawResourceLocator,
): ParsedResourceLocator {
  const value = validateResourceLocator(raw);
  if (value.startsWith("./") || value.startsWith("../"))
    return { kind: "local", value };

  const packageTarget = packageParts(value);
  if (!packageTarget) return invalid(raw);
  return {
    kind: "package",
    value: value as ValidatedPackageResourceLocator,
    ...packageTarget,
  };
}
