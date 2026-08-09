import type { JsoncLocation } from "./jsonc.js";
import { isSafeJsonObject } from "./jsonc.js";
import { isValidValueKey } from "./values.js";

export type AuthoredValueIssue = Readonly<{
  readonly code:
    | "invalid-resolved-input"
    | "invalid-value-reference"
    | "non-string-value";
  readonly message: string;
  readonly pointer: string;
  readonly location?: JsoncLocation;
}>;

export type AuthoredValueLayerKind = "instance" | "preset";

type AuthoredValueLayerOptions = Readonly<{
  readonly kind: AuthoredValueLayerKind;
  readonly locations?: Readonly<Record<string, JsoncLocation>>;
}>;

function pointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function issue(
  code: AuthoredValueIssue["code"],
  message: string,
  pointer: string,
  locations: Readonly<Record<string, JsoncLocation>> | undefined,
): AuthoredValueIssue {
  const location = locations?.[pointer];
  return {
    code,
    message,
    pointer,
    ...(location ? { location } : {}),
  };
}

function valueLayerIssues(
  values: unknown,
  pointer: string,
  label: "binding" | "preset",
  locations: Readonly<Record<string, JsoncLocation>> | undefined,
): AuthoredValueIssue[] {
  if (values === undefined) return [];
  if (!isSafeJsonObject(values))
    return [
      issue(
        "invalid-resolved-input",
        `${label} values must be a JSON object`,
        pointer,
        locations,
      ),
    ];

  const issues: AuthoredValueIssue[] = [];
  for (const key of Object.keys(values).sort()) {
    const valuePointer = `${pointer}/${pointerSegment(key)}`;
    if (!isValidValueKey(key)) {
      issues.push(
        issue(
          "invalid-value-reference",
          `${label} value name ${JSON.stringify(key)} must match [A-Za-z_$][A-Za-z0-9_$-]*`,
          valuePointer,
          locations,
        ),
      );
      continue;
    }
    const value = values[key];
    if (value !== null && typeof value !== "string")
      issues.push(
        issue(
          "non-string-value",
          `${label} value "${key}" must be a string or null (SPECIFICATION.md §4.2)`,
          valuePointer,
          locations,
        ),
      );
  }
  return issues;
}

/**
 * Validates one authored layer before it can be hidden by a later merge.
 * Preset roots include global and binding-local value maps; instance facets
 * contribute the binding-local map carried by the facet.
 */
export function authoredValueLayerIssues(
  source: Record<string, unknown>,
  options: AuthoredValueLayerOptions,
): readonly AuthoredValueIssue[] {
  const issues = valueLayerIssues(
    source.values,
    "/values",
    options.kind === "instance" ? "binding" : "preset",
    options.locations,
  );
  if (options.kind === "instance") return issues;

  for (const kind of ["agents", "skills"] as const) {
    const collection = source[kind];
    if (!isSafeJsonObject(collection)) continue;
    for (const id of Object.keys(collection).sort()) {
      const binding = collection[id];
      if (!isSafeJsonObject(binding)) continue;
      issues.push(
        ...valueLayerIssues(
          binding.values,
          `/${kind}/${pointerSegment(id)}/values`,
          "binding",
          options.locations,
        ),
      );
    }
  }
  return issues.sort(
    (left, right) =>
      left.pointer.localeCompare(right.pointer) ||
      left.code.localeCompare(right.code),
  );
}
