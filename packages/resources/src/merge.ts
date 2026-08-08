import { own } from "./object.js";
import {
  childPointer,
  cloneResourceProvenance,
  freezeProvenance,
  originAt,
  provenanceForValue,
  type ResourceProvenance,
} from "./provenance.js";
import {
  copyResourceTemplateSelection,
  resourceTemplateSelection,
} from "./resolution.js";
import type { JsonValue, ResourceOrigin } from "./types.js";

export type ResourceMergeOptions = Readonly<{
  readonly inheritedOrigin?: ResourceOrigin;
  readonly localOrigin?: ResourceOrigin;
  readonly inheritedProvenance?: ResourceProvenance;
  readonly localProvenance?: ResourceProvenance;
}>;

export type ResourceMergeResult = Readonly<{
  readonly value: JsonValue | undefined;
  /** Alias for callers that refer to the merged value as data. */
  readonly data: JsonValue | undefined;
  readonly provenance: ResourceProvenance;
}>;

const DELETED = Symbol("deleted");

function isObject(value: JsonValue | undefined): value is {
  readonly [key: string]: JsonValue;
} {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue(
  value: JsonValue,
  pointer: string,
  source: ResourceProvenance,
  fallback: ResourceOrigin | undefined,
  output: Record<string, ResourceOrigin>,
): JsonValue {
  const origin = originAt(source, pointer) ?? fallback;
  if (origin) own(output, pointer, origin);

  if (Array.isArray(value)) {
    const cloned = value.map((child, index) =>
      cloneValue(child, childPointer(pointer, index), source, fallback, output),
    );
    return copyResourceTemplateSelection(value, cloned);
  }
  if (!isObject(value)) return value;

  const object: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    own(
      object,
      key,
      cloneValue(
        value[key] as JsonValue,
        childPointer(pointer, key),
        source,
        fallback,
        output,
      ),
    );
  }
  return copyResourceTemplateSelection(
    value,
    object as { readonly [key: string]: JsonValue },
  );
}

function mergedOrigin(
  pointer: string,
  local: ResourceProvenance,
  localFallback: ResourceOrigin | undefined,
  inherited: ResourceProvenance,
  inheritedFallback: ResourceOrigin | undefined,
): ResourceOrigin | undefined {
  return (
    originAt(local, pointer) ??
    localFallback ??
    originAt(inherited, pointer) ??
    inheritedFallback
  );
}

type MergeContext = Readonly<{
  readonly inheritedProvenance: ResourceProvenance;
  readonly localProvenance: ResourceProvenance;
  readonly inheritedOrigin?: ResourceOrigin;
  readonly localOrigin?: ResourceOrigin;
  readonly outputProvenance: Record<string, ResourceOrigin>;
}>;

function copyInheritedField(
  result: Record<string, unknown>,
  inherited: { readonly [key: string]: JsonValue } | undefined,
  key: string,
  pointer: string,
  context: MergeContext,
): void {
  if (!inherited || !Object.hasOwn(inherited, key)) return;
  own(
    result,
    key,
    cloneValue(
      inherited[key] as JsonValue,
      pointer,
      context.inheritedProvenance,
      context.inheritedOrigin,
      context.outputProvenance,
    ),
  );
}

function mergeLocalField(
  result: Record<string, unknown>,
  inherited: { readonly [key: string]: JsonValue } | undefined,
  local: { readonly [key: string]: JsonValue },
  key: string,
  pointer: string,
  context: MergeContext,
): void {
  const merged = mergeNode(
    inherited && Object.hasOwn(inherited, key)
      ? (inherited[key] as JsonValue)
      : undefined,
    local[key] as JsonValue,
    pointer,
    context,
  );
  if (merged !== DELETED) own(result, key, merged);
}

function mergeObjectNode(
  inherited: { readonly [key: string]: JsonValue } | undefined,
  local: { readonly [key: string]: JsonValue },
  pointer: string,
  context: MergeContext,
): JsonValue {
  const result: Record<string, unknown> = {};
  const objectOrigin = mergedOrigin(
    pointer,
    context.localProvenance,
    context.localOrigin,
    context.inheritedProvenance,
    context.inheritedOrigin,
  );
  if (objectOrigin) own(context.outputProvenance, pointer, objectOrigin);

  const keys = new Set([
    ...(inherited ? Object.keys(inherited) : []),
    ...Object.keys(local),
  ]);
  for (const key of [...keys].sort()) {
    const pointerValue = childPointer(pointer, key);
    if (!Object.hasOwn(local, key)) {
      copyInheritedField(result, inherited, key, pointerValue, context);
      continue;
    }
    mergeLocalField(result, inherited, local, key, pointerValue, context);
  }
  const selectionSource = resourceTemplateSelection(local) ? local : inherited;
  return copyResourceTemplateSelection(
    selectionSource,
    result as { readonly [key: string]: JsonValue },
  );
}

function mergeNode(
  inherited: JsonValue | undefined,
  local: JsonValue,
  pointer: string,
  context: MergeContext,
): JsonValue | typeof DELETED {
  if (local === null) return DELETED;

  if (Array.isArray(local) || !isObject(local))
    return cloneValue(
      local,
      pointer,
      context.localProvenance,
      context.localOrigin,
      context.outputProvenance,
    );

  return mergeObjectNode(
    isObject(inherited) ? inherited : undefined,
    local,
    pointer,
    context,
  );
}

/**
 * Applies the one resource overlay contract: recursive objects, replacing
 * arrays/scalars, and null tombstones. All values are cloned and provenance is
 * indexed separately from the returned JSON value.
 */
export function mergeResourceValues(
  inherited: JsonValue | undefined,
  local: JsonValue,
  options: ResourceMergeOptions = {},
): ResourceMergeResult {
  const inheritedProvenance =
    options.inheritedProvenance ??
    (inherited === undefined || !options.inheritedOrigin
      ? {}
      : provenanceForValue(inherited, options.inheritedOrigin));
  const localProvenance =
    options.localProvenance ??
    (options.localOrigin ? provenanceForValue(local, options.localOrigin) : {});
  const outputProvenance: Record<string, ResourceOrigin> = {};
  const merged = mergeNode(inherited, local, "", {
    inheritedProvenance,
    localProvenance,
    inheritedOrigin: options.inheritedOrigin,
    localOrigin: options.localOrigin,
    outputProvenance,
  });
  const value = merged === DELETED ? undefined : merged;
  return {
    value,
    data: value,
    provenance: freezeProvenance(outputProvenance),
  };
}

/** Short alias used by resource callers that already have a value seam. */
export const mergeResource = mergeResourceValues;

/** Builds provenance for a parsed facet before it enters a merge. */
export function provenanceOfResourceValue(
  value: JsonValue,
  origin: ResourceOrigin,
): ResourceProvenance {
  return cloneResourceProvenance(provenanceForValue(value, origin));
}
