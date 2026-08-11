import { own } from "./object.js";
import type { JsonValue, ResourceOrigin } from "./types.js";

/**
 * Provenance is deliberately a sibling value, not a property on authored
 * input. JSON pointers identify the winning value at each node in a result.
 */
export type ResourceProvenance = Readonly<Record<string, ResourceOrigin>>;

function cloneOrigin(origin: ResourceOrigin): ResourceOrigin {
  return Object.freeze({ ...origin });
}

function pointerSegment(segment: string | number): string {
  return String(segment).replaceAll("~", "~0").replaceAll("/", "~1");
}

export function childPointer(
  pointer: string,
  segment: string | number,
): string {
  return `${pointer}/${pointerSegment(segment)}`;
}

function isObject(value: JsonValue): value is {
  readonly [key: string]: JsonValue;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mapResourceValuePointers<T>(
  value: JsonValue,
  context: T,
  pointer = "",
): Readonly<Record<string, T>> {
  const output: Record<string, T> = {};
  const visit = (current: JsonValue, currentPointer: string): void => {
    own(output, currentPointer, context);
    if (Array.isArray(current)) {
      current.forEach((child, index) => {
        visit(child, childPointer(currentPointer, index));
      });
      return;
    }
    if (!isObject(current)) return;
    for (const key of Object.keys(current).sort()) {
      visit(current[key] as JsonValue, childPointer(currentPointer, key));
    }
  };
  visit(value, pointer);
  return Object.freeze(output);
}

/** Creates a complete provenance index for one independently authored value. */
export function provenanceForValue(
  value: JsonValue,
  origin: ResourceOrigin,
  pointer = "",
): ResourceProvenance {
  return freezeProvenance(
    mapResourceValuePointers(value, origin, pointer) as Record<
      string,
      ResourceOrigin
    >,
  );
}

export function cloneResourceProvenance(
  provenance: ResourceProvenance | undefined,
): ResourceProvenance {
  const output: Record<string, ResourceOrigin> = {};
  for (const pointer of Object.keys(provenance ?? {}).sort()) {
    const origin = provenance?.[pointer];
    if (origin) own(output, pointer, cloneOrigin(origin));
  }
  return freezeProvenance(output);
}

export function prefixProvenance(
  provenance: ResourceProvenance,
  prefix: string,
): ResourceProvenance {
  const output: Record<string, ResourceOrigin> = {};
  for (const pointer of Object.keys(provenance).sort()) {
    const prefixed =
      prefix === "" ? pointer : pointer === "" ? prefix : `${prefix}${pointer}`;
    own(output, prefixed, provenance[pointer]);
  }
  return freezeProvenance(output);
}

export function originAt(
  provenance: ResourceProvenance | undefined,
  pointer: string,
): ResourceOrigin | undefined {
  return provenance?.[pointer];
}

export function freezeProvenance(
  provenance: Record<string, ResourceOrigin>,
): ResourceProvenance {
  const output: Record<string, ResourceOrigin> = {};
  for (const pointer of Object.keys(provenance).sort()) {
    const origin = provenance[pointer];
    if (origin) own(output, pointer, cloneOrigin(origin));
  }
  return Object.freeze(output);
}
