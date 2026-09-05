import type { ResourcePack } from "./content-root.js";
import { failResource } from "./errors.js";
import { jsonValueAtPath } from "./json-path.js";
import type { JsoncLocation } from "./jsonc.js";
import { parseResourceLocator } from "./locator.js";
import { mergeResourceValues } from "./merge.js";
import { own } from "./object.js";
import {
  childPointer,
  cloneResourceProvenance,
  type ResourceProvenance,
} from "./provenance.js";
import {
  copyResourceTemplateSelection,
  copyResourceValueTombstones,
  resourceTemplateSelection,
  resourceValueTombstones,
  withResourceValueTombstones,
} from "./resolution.js";
import type {
  AuthoringContext,
  AuthoringProvenance,
  LocatedValue,
  MergedResourceValue,
  NormalizedValue,
  ResolvedTemplate,
  ResolvedTemplateSlot,
  TraversalContext,
} from "./resolution-types.js";
import type {
  InstanceFacet,
  JsonObject,
  JsonValue,
  Preset,
  RawResourceLocator,
  ResourceGraphNode,
  ResourceOrigin,
  TemplateFacet,
} from "./types.js";

export function isObject(value: unknown): value is Record<string, JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

export function cloneValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const output = value.map(cloneValue);
    return copyResourceValueTombstones(
      value,
      copyResourceTemplateSelection(value, output),
    );
  }
  if (!isObject(value)) return value;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort())
    own(output, key, cloneValue(value[key] as JsonValue));
  return copyResourceValueTombstones(
    value,
    copyResourceTemplateSelection(
      value,
      output as { readonly [key: string]: JsonValue },
    ),
  );
}

export function cloneObject(value: JsonObject): JsonObject {
  return cloneValue(value) as JsonObject;
}

export function withoutKeys(
  value: Record<string, JsonValue>,
  keys: ReadonlySet<string>,
): JsonObject {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (!keys.has(key)) own(output, key, cloneValue(value[key] as JsonValue));
  }
  return output as JsonObject;
}

export function selectorKeys(value: Record<string, JsonValue>): string[] {
  return ["$instance", "$template"].filter((key) => Object.hasOwn(value, key));
}

export function selectorValue(
  value: Record<string, JsonValue>,
  key: string,
  origin: ResourceOrigin,
  pointer: string,
  location?: JsoncLocation,
): RawResourceLocator {
  const selector = value[key];
  if (typeof selector !== "string" || selector.length === 0) {
    return failResource(
      "invalid-resolved-input",
      `${key} selector must be a non-empty string`,
      {
        source: origin,
        pointer: `${pointer}/${key}`,
        ...(location ? { location } : {}),
      },
    );
  }
  return selector;
}

export function removeProvenance(
  provenance: ResourceProvenance,
  keys: ReadonlySet<string>,
): ResourceProvenance {
  return filterContextMap(provenance, keys);
}

export function sliceProvenance(
  provenance: ResourceProvenance,
  prefix: string,
): ResourceProvenance {
  const output: Record<string, ResourceOrigin> = {};
  for (const pointer of Object.keys(provenance).sort()) {
    if (pointer !== prefix && !pointer.startsWith(`${prefix}/`)) continue;
    const relative = pointer.slice(prefix.length);
    own(output, relative === "" ? "" : relative, provenance[pointer]);
  }
  return Object.freeze(output);
}

export function authoringContext(
  pack: ResourcePack,
  file: string,
  locations?: Readonly<Record<string, JsoncLocation>>,
): AuthoringContext {
  return Object.freeze({
    pack,
    file,
    ...(locations ? { locations } : {}),
  });
}

export function traversalContext(
  path: readonly ResourceGraphNode[],
  hops: number,
): TraversalContext {
  return Object.freeze({
    path: Object.freeze([...path]),
    hops,
  });
}

export function sliceContextMap<T>(
  contexts: Readonly<Record<string, T>> | undefined,
  prefix: string,
): Readonly<Record<string, T>> {
  const output: Record<string, T> = {};
  for (const pointer of Object.keys(contexts ?? {}).sort()) {
    if (pointer !== prefix && !pointer.startsWith(`${prefix}/`)) continue;
    const relative = pointer.slice(prefix.length);
    own(output, relative === "" ? "" : relative, contexts?.[pointer] as T);
  }
  return Object.freeze(output);
}

export function contextAt<T>(
  contexts: Readonly<Record<string, T>> | undefined,
  pointer: string,
): T | undefined {
  return contexts?.[pointer] ?? contexts?.[""];
}

export function removeContextMap<T>(
  contexts: Readonly<Record<string, T>> | undefined,
  keys: ReadonlySet<string>,
): Readonly<Record<string, T>> {
  return filterContextMap(contexts, keys);
}

function filterContextMap<T>(
  contexts: Readonly<Record<string, T>> | undefined,
  keys: ReadonlySet<string>,
): Readonly<Record<string, T>> {
  const output: Record<string, T> = {};
  for (const pointer of Object.keys(contexts ?? {}).sort()) {
    const first = pointer
      .split("/")[1]
      ?.replaceAll("~1", "/")
      .replaceAll("~0", "~");
    if (!first || !keys.has(first))
      own(output, pointer, contexts?.[pointer] as T);
  }
  return Object.freeze(output);
}

export function mergeContextMap<T>(
  outputProvenance: ResourceProvenance,
  localProvenance: ResourceProvenance,
  local: Readonly<Record<string, T>> | undefined,
  inherited: Readonly<Record<string, T>> | undefined,
): Readonly<Record<string, T>> {
  const output: Record<string, T> = {};
  for (const pointer of Object.keys(outputProvenance).sort()) {
    const contexts = Object.hasOwn(localProvenance, pointer)
      ? local
      : inherited;
    const context = contextAt(contexts, pointer);
    if (context) own(output, pointer, context);
  }
  return Object.freeze(output);
}

export function appendPointer(prefix: string, pointer: string): string {
  if (prefix === "") return pointer;
  if (pointer === "") return prefix;
  return `${prefix}${pointer}`;
}

export function removeProvenanceSubtree(
  output: Record<string, ResourceOrigin>,
  pointer: string,
): void {
  for (const key of Object.keys(output)) {
    if (key === pointer || key.startsWith(`${pointer}/`)) delete output[key];
  }
}

export function replaceProvenanceSubtree(
  output: Record<string, ResourceOrigin>,
  pointer: string,
  replacement: ResourceProvenance,
): void {
  removeProvenanceSubtree(output, pointer);
  for (const child of Object.keys(replacement).sort()) {
    own(
      output,
      child === "" ? pointer : `${pointer}${child}`,
      replacement[child],
    );
  }
}

export function replaceContextSubtree<T>(
  output: Record<string, T>,
  pointer: string,
  replacement: Readonly<Record<string, T>>,
): void {
  for (const key of Object.keys(output)) {
    if (key === pointer || key.startsWith(`${pointer}/`)) delete output[key];
  }
  for (const child of Object.keys(replacement).sort()) {
    own(
      output,
      child === "" ? pointer : `${pointer}${child}`,
      replacement[child] as T,
    );
  }
}

export function composeFailurePointer(
  parent: string | undefined,
  child: string | undefined,
  scope: string | undefined,
): string | undefined {
  if (!parent) return child;
  if (!child) return parent;
  if (child === parent || child.startsWith(`${parent}/`)) return child;
  if (scope && (child === scope || child.startsWith(`${scope}/`))) return child;
  return `${parent}${child.startsWith("/") ? child : `/${child}`}`;
}

export function pointerForSegments(segments: readonly string[]): string {
  return segments.reduce(childPointer, "");
}

export function schemaPointerForPath(
  schema: Record<string, unknown>,
  path: readonly string[],
): string {
  let current: unknown = schema;
  let pointer = "";
  for (const segment of path) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      pointer = childPointer(pointer, segment);
      current = current[Number(segment)];
      continue;
    }
    if (!isObject(current)) break;
    const properties = current.properties;
    if (isObject(properties) && Object.hasOwn(properties, segment)) {
      pointer = `${pointer}/properties${childPointer("", segment)}`;
      current = properties[segment];
      continue;
    }
    if (!Object.hasOwn(current, segment)) break;
    pointer = childPointer(pointer, segment);
    current = current[segment];
  }
  return pointer;
}

export function unchangedNormalizedValue(
  value: JsonValue,
  provenance: ResourceProvenance,
  authoring: AuthoringProvenance,
): NormalizedValue {
  return {
    value: cloneValue(value),
    provenance: cloneResourceProvenance(provenance),
    authoring: sliceContextMap(authoring, ""),
  };
}

export function locationsAt(
  value: JsonValue,
  path: readonly string[],
  pointer = "",
  consumed: readonly string[] = [],
): LocatedValue[] {
  const segment = path[0];
  if (segment === undefined) return [{ pointer, path: consumed, value }];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      locationsAt(item, path, childPointer(pointer, index), [
        ...consumed,
        String(index),
      ]),
    );
  }
  if (!isObject(value) || !Object.hasOwn(value, segment)) return [];
  return locationsAt(
    value[segment] as JsonValue,
    path.slice(1),
    childPointer(pointer, segment),
    [...consumed, segment],
  );
}

export function setAt(
  value: JsonValue,
  path: readonly string[],
  replacement: JsonValue,
): void {
  if (path.length === 0) return;
  const parentPath = path.slice(0, -1);
  const key = path.at(-1);
  if (key === undefined) return;
  const parent = jsonValueAtPath<JsonValue>(value, parentPath);
  if (Array.isArray(parent)) {
    if (/^\d+$/.test(key)) parent[Number(key)] = replacement;
    return;
  }
  if (isObject(parent))
    own(parent as Record<string, unknown>, key, replacement);
}

export function descriptorData(
  description: string,
  input: JsonObject,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  own(output, "description", description);
  for (const key of Object.keys(input).sort())
    own(output, key, cloneValue(input[key] as JsonValue));
  return output;
}

export function graphNode(
  facet: TemplateFacet | InstanceFacet | Preset,
): ResourceGraphNode {
  return {
    kind: facet.kind,
    locator: facet.locator,
    origin: facet.origin,
  } as ResourceGraphNode;
}

export function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function sortProvenance(
  provenance: Record<string, ResourceOrigin>,
): Record<string, ResourceOrigin> {
  const output: Record<string, ResourceOrigin> = {};
  for (const key of Object.keys(provenance).sort())
    own(output, key, provenance[key]);
  return output;
}

export function addBindingValuesProvenance(
  output: Record<string, ResourceOrigin>,
  provenance: ResourceProvenance,
  values: JsonObject | undefined,
): void {
  if (!values) return;
  for (const pointer of Object.keys(provenance).sort()) {
    if (pointer !== "/values" && !pointer.startsWith("/values/")) continue;
    own(output, pointer, provenance[pointer]);
  }
}

export function sourceValueTombstones(value: JsonObject): string[] {
  return (resourceValueTombstones(value) ?? [])
    .filter((pointer) => pointer.startsWith("/values/"))
    .map((pointer) => pointer.slice("/values".length));
}

export function copySourceValues(
  sourceValues: JsonObject,
  inheritedTombstones: readonly string[],
): JsonObject {
  const output: Record<string, JsonValue> = {};
  const tombstones = new Set<string>(inheritedTombstones);
  for (const key of Object.keys(sourceValues).sort()) {
    const child = sourceValues[key] as JsonValue;
    if (child === null) {
      tombstones.add(`/${escapePointer(key)}`);
      continue;
    }
    own(output, key, cloneValue(child));
  }

  for (const pointer of resourceValueTombstones(sourceValues) ?? [])
    tombstones.add(pointer);
  return withResourceValueTombstones(
    output as JsonObject,
    [...tombstones].sort(),
  );
}

export function templateAcceptsArray(template: ResolvedTemplate): boolean {
  return (
    isObject(template.facet.inputSchema) &&
    template.facet.inputSchema.type === "array"
  );
}

export function templateAcceptsObject(template: ResolvedTemplate): boolean {
  return (
    isObject(template.facet.inputSchema) &&
    template.facet.inputSchema.type === "object"
  );
}

export function selectedSlotCandidate(
  value: JsonValue,
  candidates: readonly ResolvedTemplateSlot[],
): ResolvedTemplateSlot | undefined {
  const selectedTemplateId = resourceTemplateSelection(value)?.templateId;
  return candidates.find(({ slot }) => slot.templateId === selectedTemplateId);
}

export function isConfiguredSlotValue(
  value: JsonValue,
  candidates: readonly ResolvedTemplateSlot[],
): boolean {
  if (isObject(value)) return selectorKeys(value).length > 0;
  if (typeof value !== "string") return false;
  return (
    isBareResourceLocator(value) ||
    candidates.every(({ template }) => templateAcceptsObject(template))
  );
}

export function isBareResourceLocator(value: string): boolean {
  try {
    parseResourceLocator(value);
    return true;
  } catch {
    return false;
  }
}

export function mergeValues(
  inherited: JsonValue | undefined,
  local: JsonValue,
  options: Readonly<{
    readonly inheritedOrigin?: ResourceOrigin;
    readonly localOrigin?: ResourceOrigin;
    readonly inheritedProvenance?: ResourceProvenance;
    readonly localProvenance: ResourceProvenance;
    readonly inheritedAuthoring?: AuthoringProvenance;
    readonly localAuthoring: AuthoringProvenance;
  }>,
): MergedResourceValue {
  const merged = mergeResourceValues(inherited, local, {
    inheritedOrigin: options.inheritedOrigin,
    localOrigin: options.localOrigin,
    inheritedProvenance: options.inheritedProvenance,
    localProvenance: options.localProvenance,
  });
  return {
    value: merged.value,
    provenance: merged.provenance,
    authoring: mergeContextMap(
      merged.provenance,
      options.localProvenance,
      options.localAuthoring,
      options.inheritedAuthoring,
    ),
  };
}
