import { basename, join, relative } from "node:path";
import { authoredValueLayerIssues } from "./authored-values.js";
import { BUNDLED_RESOURCE_PACK } from "./bundled.js";
import { type Slot, slotsOf } from "./composition.js";
import {
  isResourcePackPathContained,
  type ResourcePack,
  resourcePackMetadataPaths,
} from "./content-root.js";
import {
  failGraphResource,
  failResource,
  normalizeResourcePaths,
  ResourceResolutionError,
} from "./errors.js";
import {
  type FacetCandidate,
  facetCandidateNames,
  inspectFacetCandidates,
  type LoadedResource,
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
} from "./facets.js";
import {
  inspectResourceFile,
  type ResolvedResourceTarget,
  type ResourceLocatorOptions,
  resolveResourceLocator,
  resourceCandidateWatchPaths,
} from "./filesystem.js";
import {
  addResourceGraphEdge,
  addResourceGraphNode,
  assertResourceGraphStep,
  canonicalGraphKey,
  createResourceGraphState,
  type ResourceGraph,
  type ResourceGraphState,
  snapshotResourceGraph,
} from "./graph.js";
import { jsonValueAtPath } from "./json-path.js";
import type { JsoncLocation } from "./jsonc.js";
import { isSafeJsonObject } from "./jsonc.js";
import { parseResourceLocator } from "./locator.js";
import { mergeResourceValues } from "./merge.js";
import { own } from "./object.js";
import { createPackageResolutionCache } from "./package-resolution.js";
import {
  childPointer,
  cloneResourceProvenance,
  mapResourceValuePointers,
  originAt,
  provenanceForValue,
  type ResourceProvenance,
} from "./provenance.js";
import {
  copyResourceTemplateSelection,
  copyResourceValueTombstones,
  resourceTemplateSelection,
  resourceValueTombstones,
  withResourceTemplateSelection,
  withResourceValueTombstones,
} from "./resolution.js";
import type {
  InstanceFacet,
  JsonObject,
  JsonValue,
  Preset,
  RawResourceLocator,
  ResourceFailureCode,
  ResourceGraphChain,
  ResourceGraphNode,
  ResourceLocator,
  ResourceOrigin,
  TemplateFacet,
} from "./types.js";

export type ResourceResolveOptions = Readonly<{
  /** Custom bundled root for tests or an embedded distribution. */
  readonly bundledPack?: ResourcePack;
  /** Existing facet read seam, also used by package metadata reads. */
  readonly beforeRead?: (path: string) => void;
}>;

export type ResolveInstanceRequest = ResourceResolveOptions & {
  readonly pack: ResourcePack;
  readonly locator: RawResourceLocator;
  readonly authoringFile: string;
};

export type ResolveTemplateRequest = ResourceResolveOptions & {
  readonly pack: ResourcePack;
  readonly locator: RawResourceLocator;
  readonly authoringFile: string;
};

export type ResolveDocumentRequest = ResourceResolveOptions & {
  readonly pack: ResourcePack;
  readonly rootFile: string;
  /** Optional in-memory authored root used by text-validation callers. */
  readonly rootDocument?: JsonObject;
};

export type ResolvedTemplateSlot = Readonly<{
  readonly slot: Slot;
  readonly template: ResolvedTemplate;
}>;

export type ResolvedTemplate = Readonly<{
  readonly kind: "template";
  readonly key: string;
  readonly locator: ResourceLocator;
  readonly origin: ResourceOrigin;
  readonly facet: TemplateFacet;
  readonly locations?: Readonly<Record<string, JsoncLocation>>;
  readonly slots: readonly ResolvedTemplateSlot[];
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
}>;

export type ResolvedResourceInstance = Readonly<{
  readonly kind: "instance";
  readonly key: string;
  readonly locator: ResourceLocator;
  readonly origin: ResourceOrigin;
  readonly facet: InstanceFacet;
  readonly template: ResolvedTemplate;
  readonly effectiveTemplate: ResolvedTemplate;
  readonly input: JsonObject;
  readonly provenance: ResourceProvenance;
  readonly graph: ResourceGraph;
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
}>;

export type ResolvedResourceBinding = Readonly<{
  readonly id: string;
  readonly kind: "agent" | "skill";
  readonly description: string;
  readonly template: ResolvedTemplate;
  readonly input: JsonObject;
  readonly values?: JsonObject;
  readonly provenance: ResourceProvenance;
}>;

export type NormalizedResourceDocument = {
  readonly [key: string]: unknown;
  readonly $schema?: string;
  readonly values?: Record<string, unknown>;
  readonly agents: Record<string, Record<string, unknown>>;
  readonly skills: Record<string, Record<string, unknown>>;
};

export type ResolvedResourceDocument = Readonly<{
  /** Authored root overlay, retained for the later semantic layer. */
  readonly raw: JsonObject;
  /** Effective root overlay after preset inheritance, still source-shaped. */
  readonly effectiveRaw: JsonObject;
  readonly normalized: NormalizedResourceDocument;
  readonly document: NormalizedResourceDocument;
  readonly bindings: Readonly<{
    readonly agents: Readonly<Record<string, ResolvedResourceBinding>>;
    readonly skills: Readonly<Record<string, ResolvedResourceBinding>>;
  }>;
  readonly provenance: ResourceProvenance;
  readonly graph: ResourceGraph;
  readonly templates: readonly ResolvedTemplate[];
  readonly instances: readonly ResolvedResourceInstance[];
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
}>;

type LoadedFacet<T> = Readonly<{
  readonly pack: ResourcePack;
  readonly target: ResolvedResourceTarget;
  readonly loaded: LoadedResource<T>;
  readonly authoring: AuthoringContext;
}>;

type FacetCacheKind = "template" | "instance" | "preset";

type CachedFacetCandidate = Readonly<{
  readonly name: FacetCandidate["name"];
  readonly path?: string;
}>;

type CachedFacet = Readonly<{
  readonly facet: TemplateFacet | InstanceFacet | Preset;
  readonly canonicalDependencies: readonly string[];
  readonly candidates: readonly CachedFacetCandidate[];
  readonly locations?: Readonly<Record<string, JsoncLocation>>;
}>;

function cachedFacetDependencies(
  target: ResolvedResourceTarget,
  facet: CachedFacet["facet"],
  canonicalDependencies: readonly string[],
): readonly string[] {
  return normalizeResourcePaths([
    ...canonicalDependencies,
    ...target.resolutionDependencies,
    ...resourcePackMetadataPaths(target.pack),
    target.lexicalDirectory,
    ...facetCandidateNames(facet.kind).flatMap((name) =>
      resourceCandidateWatchPaths(target, name),
    ),
  ]);
}

function facetCandidateIdentities(
  candidates: readonly FacetCandidate[],
): readonly CachedFacetCandidate[] {
  return Object.freeze(
    candidates.map(({ name, file }) =>
      Object.freeze({ name, ...(file ? { path: file.path } : {}) }),
    ),
  );
}

function sameFacetCandidateIdentities(
  expected: readonly CachedFacetCandidate[],
  current: readonly FacetCandidate[],
): boolean {
  return (
    expected.length === current.length &&
    expected.every((candidate, index) => {
      const observed = current[index];
      return (
        observed?.name === candidate.name &&
        observed.file?.path === candidate.path
      );
    })
  );
}

function facetCacheFailure(
  target: ResolvedResourceTarget,
  facet: FacetCacheKind,
  locator: RawResourceLocator,
  dependencies: readonly string[] = [],
): never {
  return failResource(
    "unsafe-path",
    "resource file changed outside the resource root",
    { locator },
    {
      dependencies: normalizeResourcePaths([
        ...target.resolutionDependencies,
        ...resourcePackMetadataPaths(target.pack),
        target.directory,
        target.lexicalDirectory,
        ...facetCandidateNames(facet).flatMap((name) =>
          resourceCandidateWatchPaths(target, name),
        ),
        ...dependencies,
      ]),
      unresolvedParents: [target.directory],
    },
  );
}

function inspectFacetCandidatesForCache(
  target: ResolvedResourceTarget,
  facet: FacetCacheKind,
  locator: RawResourceLocator,
  dependencies: readonly string[] = [],
): readonly FacetCandidate[] {
  try {
    return inspectFacetCandidates(target, facet, locator, dependencies);
  } catch (error) {
    if (error instanceof ResourceResolutionError) {
      return facetCacheFailure(target, facet, locator, [
        ...dependencies,
        ...error.dependencies,
      ]);
    }
    throw error;
  }
}

type AuthoringContext = Readonly<{
  readonly pack: ResourcePack;
  /** Lexical path used to resolve relative selectors. */
  readonly file: string;
  readonly locations?: Readonly<Record<string, JsoncLocation>>;
}>;

type AuthoringProvenance = Readonly<Record<string, AuthoringContext>>;

type TraversalContext = Readonly<{
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
}>;

type TraversalProvenance = Readonly<Record<string, TraversalContext>>;

type EnteredFacet<T extends TemplateFacet | InstanceFacet> = Readonly<{
  readonly loaded: LoadedFacet<T>;
  readonly node: ResourceGraphNode;
  readonly path: readonly ResourceGraphNode[];
  readonly key: string;
}>;

type PresetResult = Readonly<{
  readonly facet: Preset;
  readonly node: ResourceGraphNode;
  readonly path: readonly ResourceGraphNode[];
  readonly effectiveRaw: JsonObject;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
  readonly traversal: TraversalProvenance;
  /** Total preset hops traversed before resolving root bindings. */
  readonly effectiveHops: number;
}>;

type SourceResult = Readonly<{
  readonly template: ResolvedTemplate;
  readonly input: JsonObject;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
  readonly description?: string;
  readonly values?: JsonObject;
}>;

type SourceSelection = Readonly<{
  readonly template: ResolvedTemplate;
  readonly inherited?: JsonObject;
  readonly inheritedProvenance?: ResourceProvenance;
  readonly inheritedAuthoring?: AuthoringProvenance;
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
}>;

type SourceResolutionContext = Readonly<{
  readonly pack: ResourcePack;
  readonly authoringFile: string;
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
  readonly origin: ResourceOrigin;
  readonly subject: "agent" | "skill";
  readonly sourcePointer: string;
  readonly sourceProvenance?: ResourceProvenance;
  readonly sourceAuthoring?: AuthoringProvenance;
}>;

type SourceSelectorContext = Readonly<{
  readonly selector?: string;
  readonly origin: ResourceOrigin;
  readonly pointer?: string;
  readonly location?: JsoncLocation;
  readonly authoring: AuthoringContext;
}>;

type SourceLocalContext = Readonly<{
  readonly value: JsonObject;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
}>;

type MergedResourceValue = Readonly<{
  readonly value: JsonValue | undefined;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
}>;

type ResourceTraversal<T> = Readonly<{
  readonly value: T;
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
}>;

type InstanceTraversal = ResourceTraversal<ResolvedResourceInstance> & {
  readonly authoring: AuthoringProvenance;
};

type SourceMetadata = Readonly<{
  readonly input: JsonObject;
  readonly provenance: ResourceProvenance;
  readonly description?: string;
  readonly values?: JsonObject;
}>;

function sourceValueTombstones(value: JsonObject): string[] {
  return (resourceValueTombstones(value) ?? [])
    .filter((pointer) => pointer.startsWith("/values/"))
    .map((pointer) => pointer.slice("/values".length));
}

function copySourceValues(
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

type BindingCollection = Readonly<{
  readonly bindings: Readonly<Record<string, ResolvedResourceBinding>>;
  readonly normalized: Readonly<Record<string, Record<string, unknown>>>;
  readonly provenance: Readonly<Record<string, ResourceOrigin>>;
}>;

function composeFailurePointer(
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

function pointerForSegments(segments: readonly string[]): string {
  return segments.reduce(childPointer, "");
}

function schemaPointerForPath(
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

type NormalizedValue = Readonly<{
  readonly value: JsonValue;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
}>;

type TraversalFailureDetails = Readonly<{
  readonly locator?: RawResourceLocator;
  readonly source?: ResourceOrigin;
  readonly pointer?: string;
  readonly location?: JsoncLocation;
}>;

type LocatedValue = Readonly<{
  readonly pointer: string;
  readonly path: readonly string[];
  readonly value: JsonValue;
}>;

type SlotGroup = Readonly<{
  readonly dataPath: readonly string[];
  readonly slots: readonly ResolvedTemplateSlot[];
}>;

type SlotCandidateContext = Readonly<{
  readonly value: JsonValue;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
  readonly slots: readonly ResolvedTemplateSlot[];
  readonly fallbackPack: ResourcePack;
  readonly fallbackFile: string;
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
  readonly sourcePointer: string;
}>;

function unchangedNormalizedValue(
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

function isObject(value: unknown): value is Record<string, JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  );
}

function selectedSlotCandidate(
  value: JsonValue,
  candidates: readonly ResolvedTemplateSlot[],
): ResolvedTemplateSlot | undefined {
  const selectedTemplateId = resourceTemplateSelection(value)?.templateId;
  return candidates.find(({ slot }) => slot.templateId === selectedTemplateId);
}

function isConfiguredSlotValue(
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

function cloneValue(value: JsonValue): JsonValue {
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

function cloneObject(value: JsonObject): JsonObject {
  return cloneValue(value) as JsonObject;
}

function withoutKeys(
  value: Record<string, JsonValue>,
  keys: ReadonlySet<string>,
): JsonObject {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (!keys.has(key)) own(output, key, cloneValue(value[key] as JsonValue));
  }
  return output as JsonObject;
}

function selectorKeys(value: Record<string, JsonValue>): string[] {
  return ["$instance", "$template"].filter((key) => Object.hasOwn(value, key));
}

function selectorValue(
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

function removeProvenance(
  provenance: ResourceProvenance,
  keys: ReadonlySet<string>,
): ResourceProvenance {
  return filterContextMap(provenance, keys);
}

function sliceProvenance(
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

function authoringContext(
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

function traversalContext(
  path: readonly ResourceGraphNode[],
  hops: number,
): TraversalContext {
  return Object.freeze({
    path: Object.freeze([...path]),
    hops,
  });
}

function sliceContextMap<T>(
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

function contextAt<T>(
  contexts: Readonly<Record<string, T>> | undefined,
  pointer: string,
): T | undefined {
  return contexts?.[pointer] ?? contexts?.[""];
}

function removeContextMap<T>(
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

function mergeContextMap<T>(
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

function appendPointer(prefix: string, pointer: string): string {
  if (prefix === "") return pointer;
  if (pointer === "") return prefix;
  return `${prefix}${pointer}`;
}

function removeProvenanceSubtree(
  output: Record<string, ResourceOrigin>,
  pointer: string,
): void {
  for (const key of Object.keys(output)) {
    if (key === pointer || key.startsWith(`${pointer}/`)) delete output[key];
  }
}

function replaceProvenanceSubtree(
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

function replaceContextSubtree<T>(
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

function isBareResourceLocator(value: string): boolean {
  try {
    parseResourceLocator(value);
    return true;
  } catch {
    return false;
  }
}

function locationsAt(
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

function setAt(
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

function descriptorData(
  description: string,
  input: JsonObject,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  own(output, "description", description);
  for (const key of Object.keys(input).sort())
    own(output, key, cloneValue(input[key] as JsonValue));
  return output;
}

function graphNode(
  facet: TemplateFacet | InstanceFacet | Preset,
): ResourceGraphNode {
  return {
    kind: facet.kind,
    locator: facet.locator,
    origin: facet.origin,
  } as ResourceGraphNode;
}

function normalizeRequest<T extends ResourceResolveOptions>(
  request: T,
  fallbackPack: ResourcePack,
): ResourceResolveOptions & { readonly bundledPack: ResourcePack } {
  return {
    ...request,
    bundledPack: request.bundledPack ?? fallbackPack,
  };
}

type ResourceRequest = ResourceResolveOptions & {
  readonly pack: ResourcePack;
};

function requestWithPack<T extends ResourceRequest>(
  requestOrPack: T | ResourcePack,
  fields: Omit<T, "pack">,
): T {
  if ("pack" in requestOrPack) return requestOrPack;
  return { pack: requestOrPack, ...fields } as T;
}

function runResourceRequest<T extends ResourceRequest, Result>(
  request: T,
  action: (resolver: ResourceResolver) => Result,
): Result {
  const resolver = new ResourceResolver(
    request.pack,
    normalizeRequest(request, BUNDLED_RESOURCE_PACK),
  );
  return resolver.run(() => action(resolver));
}

class ResourceResolver {
  private readonly bundledPack: ResourcePack;
  private readonly beforeRead: ResourceResolveOptions["beforeRead"];
  private readonly packageCache = createPackageResolutionCache();
  private readonly graph: ResourceGraphState = createResourceGraphState();
  private readonly dependencies = new Set<string>();
  private readonly unresolvedParents = new Set<string>();
  /** Output indexes only; traversal never reads these resolved results. */
  private readonly resolvedTemplates = new Map<string, ResolvedTemplate>();
  private readonly resolvedInstances = new Map<
    string,
    ResolvedResourceInstance
  >();
  private readonly facetCache = new Map<string, CachedFacet>();

  constructor(
    private readonly projectPack: ResourcePack,
    options: ResourceResolveOptions,
  ) {
    this.bundledPack = options.bundledPack ?? BUNDLED_RESOURCE_PACK;
    this.beforeRead = options.beforeRead;
  }

  run<T>(action: () => T): T {
    try {
      return action();
    } catch (error) {
      throw this.decorateFailure(error);
    }
  }

  private decorateFailure(error: unknown): ResourceResolutionError | Error {
    if (!(error instanceof ResourceResolutionError)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    return new ResourceResolutionError(error.failure, {
      dependencies: [...this.dependencies, ...error.dependencies],
      unresolvedParents: [
        ...this.unresolvedParents,
        ...error.unresolvedParents,
      ],
    });
  }

  private collect<T>(loaded: LoadedResource<T>): void {
    loaded.dependencies.forEach((path) => {
      this.dependencies.add(path);
    });
    loaded.unresolvedParents.forEach((path) => {
      this.unresolvedParents.add(path);
    });
  }

  private packForReference(
    pack: ResourcePack,
    locator: RawResourceLocator,
  ): ResourcePack {
    return parseResourceLocator(locator).kind === "builtin"
      ? this.bundledPack
      : pack;
  }

  private enter(
    node: ResourceGraphNode,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): readonly ResourceGraphNode[] {
    assertResourceGraphStep(path, node, hops);
    if (path.length > 0) {
      const parent = path.at(-1);
      if (parent) addResourceGraphEdge(this.graph, parent, node);
    } else {
      addResourceGraphNode(this.graph, node);
    }
    addResourceGraphNode(this.graph, node);
    return [...path, node];
  }

  private loadedFile<T extends TemplateFacet | InstanceFacet | Preset>(
    pack: ResourcePack,
    target: ResolvedResourceTarget,
    loaded: LoadedResource<T>,
  ): LoadedFacet<T> {
    this.collect(loaded);
    return {
      pack,
      target,
      loaded,
      authoring: authoringContext(
        pack,
        join(target.lexicalDirectory, basename(loaded.facet.origin.path)),
        loaded.locations,
      ),
    };
  }

  private loadTemplate(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ): LoadedFacet<TemplateFacet> {
    const selectedPack = this.packForReference(pack, locator);
    const target = requireTarget(selectedPack, locator, authoringFile, {
      packageCache: this.packageCache,
      beforeRead: this.beforeRead,
    });
    return this.cachedFacet(target, "template", () =>
      loadTemplateFacet(selectedPack, locator, authoringFile, {
        packageCache: this.packageCache,
        beforeRead: this.beforeRead,
      }),
    );
  }

  private loadInstance(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ): LoadedFacet<InstanceFacet> {
    const selectedPack = this.packForReference(pack, locator);
    const target = requireTarget(selectedPack, locator, authoringFile, {
      packageCache: this.packageCache,
      beforeRead: this.beforeRead,
    });
    return this.cachedFacet(target, "instance", () =>
      loadInstanceFacet(selectedPack, locator, authoringFile, {
        packageCache: this.packageCache,
        beforeRead: this.beforeRead,
      }),
    );
  }

  private loadPreset(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ): LoadedFacet<Preset> {
    const selectedPack = this.packForReference(pack, locator);
    const target = requireTarget(selectedPack, locator, authoringFile, {
      packageCache: this.packageCache,
      beforeRead: this.beforeRead,
    });
    return this.cachedFacet(target, "preset", () =>
      loadPresetFacet(selectedPack, locator, authoringFile, {
        packageCache: this.packageCache,
        beforeRead: this.beforeRead,
      }),
    );
  }

  private cachedFacet<T extends TemplateFacet | InstanceFacet | Preset>(
    target: ResolvedResourceTarget,
    facet: FacetCacheKind,
    load: () => LoadedResource<T>,
  ): LoadedFacet<T> {
    const cacheKey = `${target.cacheKey}\u0000${facet}`;
    if (target.pack.kind === "package") {
      const cached = this.facetCache.get(cacheKey);
      if (cached) {
        const candidates = inspectFacetCandidatesForCache(
          target,
          facet,
          target.locator,
          cached.canonicalDependencies,
        );
        if (!sameFacetCandidateIdentities(cached.candidates, candidates)) {
          return facetCacheFailure(
            target,
            facet,
            target.locator,
            cached.canonicalDependencies,
          );
        }
        return this.loadedFile(
          target.pack,
          target,
          Object.freeze({
            facet: Object.freeze({
              ...cached.facet,
              locator: target.locator,
            }) as T,
            dependencies: Object.freeze(
              cachedFacetDependencies(
                target,
                cached.facet,
                cached.canonicalDependencies,
              ),
            ),
            unresolvedParents: Object.freeze([]),
            ...(cached.locations
              ? { locations: Object.freeze({ ...cached.locations }) }
              : {}),
          }),
        );
      }
    }
    if (target.pack.kind === "package") {
      const initialCandidates = inspectFacetCandidatesForCache(
        target,
        facet,
        target.locator,
      );
      const loaded = load();
      const finalCandidates = inspectFacetCandidatesForCache(
        target,
        facet,
        target.locator,
        loaded.dependencies,
      );
      if (
        !sameFacetCandidateIdentities(
          facetCandidateIdentities(initialCandidates),
          finalCandidates,
        )
      ) {
        return facetCacheFailure(
          target,
          facet,
          target.locator,
          loaded.dependencies,
        );
      }
      this.facetCache.set(
        cacheKey,
        Object.freeze({
          facet: loaded.facet,
          canonicalDependencies: Object.freeze(
            normalizeResourcePaths(
              loaded.dependencies.filter((path) =>
                isResourcePackPathContained(target.pack, path),
              ),
            ),
          ),
          candidates: facetCandidateIdentities(finalCandidates),
          ...(loaded.locations ? { locations: loaded.locations } : {}),
        }),
      );
      return this.loadedFile(
        target.pack,
        target,
        Object.freeze({
          ...loaded,
          dependencies: Object.freeze(
            cachedFacetDependencies(
              target,
              loaded.facet,
              loaded.dependencies.filter((path) =>
                isResourcePackPathContained(target.pack, path),
              ),
            ),
          ),
        }),
      );
    }
    const loaded = load();
    return this.loadedFile(target.pack, target, loaded);
  }

  private enterLoaded<T extends TemplateFacet | InstanceFacet>(
    loaded: LoadedFacet<T>,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): EnteredFacet<T> {
    const node = graphNode(loaded.loaded.facet);
    return {
      loaded,
      node,
      path: this.enter(node, path, hops),
      key: canonicalGraphKey(node),
    };
  }

  private failureNode(
    kind: ResourceGraphNode["kind"],
    locator: RawResourceLocator,
    source: ResourceOrigin | undefined,
  ): ResourceGraphNode | undefined {
    if (!source) return undefined;
    try {
      const parsed = parseResourceLocator(locator);
      return {
        kind,
        locator: parsed.value,
        origin: source,
      } as ResourceGraphNode;
    } catch {
      return undefined;
    }
  }

  private graphChain(
    path: readonly ResourceGraphNode[],
  ): ResourceGraphChain | undefined {
    return path.length === 0
      ? undefined
      : (path as [ResourceGraphNode, ...ResourceGraphNode[]]);
  }

  private decorateTraversalFailure(
    error: unknown,
    path: readonly ResourceGraphNode[],
    kind: ResourceGraphNode["kind"],
    locator: RawResourceLocator,
  ): ResourceResolutionError | Error {
    if (!(error instanceof ResourceResolutionError)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    const failure = error.failure;
    if (failure.chain) return error;
    const node = this.failureNode(kind, locator, failure.source);
    const chain = this.graphChain(node ? [...path, node] : path);
    return new ResourceResolutionError(
      {
        ...failure,
        ...(chain ? { chain } : {}),
      },
      this.failureContext(error),
    );
  }

  private loadForTraversal<T extends TemplateFacet | InstanceFacet | Preset>(
    load: () => LoadedFacet<T>,
    path: readonly ResourceGraphNode[],
    kind: ResourceGraphNode["kind"],
    locator: RawResourceLocator,
  ): LoadedFacet<T> {
    try {
      return load();
    } catch (error) {
      throw this.decorateTraversalFailure(error, path, kind, locator);
    }
  }

  private delegatedFailure(
    error: ResourceResolutionError,
    path: readonly ResourceGraphNode[],
    source: ResourceOrigin | undefined,
    pointer: string | undefined,
    location: JsoncLocation | undefined,
    pointerScope: string | undefined,
  ): ResourceResolutionError {
    const failure = error.failure;
    const chain = failure.chain ?? this.graphChain(path);
    const failurePointer = composeFailurePointer(
      pointer,
      failure.pointer,
      pointerScope,
    );
    return new ResourceResolutionError(
      {
        ...failure,
        ...(source && !failure.source ? { source } : {}),
        ...(failurePointer ? { pointer: failurePointer } : {}),
        ...(location && !failure.location ? { location } : {}),
        ...(chain ? { chain } : {}),
      },
      this.failureContext(error),
    );
  }

  private delegateResource<T>(
    action: () => T,
    path: readonly ResourceGraphNode[],
    source: ResourceOrigin | undefined,
    pointer: string | undefined,
    location?: JsoncLocation,
    pointerScope?: string,
  ): T {
    try {
      return action();
    } catch (error) {
      if (!(error instanceof ResourceResolutionError)) throw error;
      throw this.delegatedFailure(
        error,
        path,
        source,
        pointer,
        location,
        pointerScope,
      );
    }
  }

  private resolveTemplateChild(
    loaded: LoadedFacet<TemplateFacet>,
    slot: Slot,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerScope: string | undefined,
  ): ResourceTraversal<ResolvedTemplate> {
    const slotPointer = pointerForSegments(slot.dataPath ?? [slot.property]);
    const schemaPointer = schemaPointerForPath(
      loaded.loaded.facet.inputSchema,
      slot.path ?? [slot.property],
    );
    return this.delegateResource(
      () =>
        this.resolveTemplateAt(
          loaded.pack,
          slot.templateId,
          loaded.authoring.file,
          path,
          hops + 1,
          pointerScope,
        ),
      path,
      loaded.loaded.facet.origin,
      slotPointer,
      loaded.loaded.locations?.[schemaPointer],
      pointerScope,
    );
  }

  private resolveTemplateAt(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
    path: readonly ResourceGraphNode[] = [],
    hops = 0,
    pointerScope?: string,
  ): ResourceTraversal<ResolvedTemplate> {
    const entered = this.enterLoaded(
      this.loadForTraversal(
        () => this.loadTemplate(pack, locator, authoringFile),
        path,
        "template",
        locator,
      ),
      path,
      hops,
    );
    const { loaded, path: nextPath, key } = entered;

    const slots: ResolvedTemplateSlot[] = [];
    for (const slot of slotsOf(
      loaded.loaded.facet.inputSchema as Record<string, unknown>,
    )) {
      const child = this.resolveTemplateChild(
        loaded,
        slot,
        nextPath,
        hops,
        pointerScope,
      );
      slots.push(
        Object.freeze({
          slot: Object.freeze({ ...slot }),
          template: child.value,
        }),
      );
    }

    const resolved = Object.freeze({
      kind: "template" as const,
      key,
      locator: loaded.loaded.facet.locator,
      origin: loaded.loaded.facet.origin,
      facet: loaded.loaded.facet,
      ...(loaded.loaded.locations
        ? { locations: loaded.loaded.locations }
        : {}),
      slots: Object.freeze(slots),
      dependencies: Object.freeze([...this.dependencies].sort()),
      unresolvedParents: Object.freeze([...this.unresolvedParents].sort()),
    });
    this.resolvedTemplates.set(
      `${key}\u0000${loaded.authoring.file}`,
      resolved,
    );
    return { value: resolved, path: nextPath, hops };
  }

  resolveTemplate(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
    path: readonly ResourceGraphNode[] = [],
    hops = 0,
  ): ResolvedTemplate {
    return this.resolveTemplateAt(pack, locator, authoringFile, path, hops)
      .value;
  }

  private resolveLoadedSelector<T extends ResourceTraversal<unknown>>(
    loaded: LoadedFacet<InstanceFacet>,
    selector: "$template" | "$instance",
    path: readonly ResourceGraphNode[],
    pointerScope: string | undefined,
    resolve: (locator: RawResourceLocator) => T,
  ): T {
    const origin = loaded.loaded.facet.origin;
    const selected = this.delegateResource(
      () =>
        selectorValue(
          loaded.loaded.facet.input,
          selector,
          origin,
          "",
          loaded.loaded.locations?.[`/${selector}`],
        ),
      path,
      origin,
      `/${selector}`,
      undefined,
      pointerScope,
    );
    return this.delegateResource(
      () => resolve(selected),
      path,
      origin,
      `/${selector}`,
      loaded.loaded.locations?.[`/${selector}`],
      pointerScope,
    );
  }

  private selectInstance(
    loaded: LoadedFacet<InstanceFacet>,
    selector: string | undefined,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerScope?: string,
  ): SourceSelection {
    const origin = loaded.loaded.facet.origin;
    if (selector === "$template") {
      const template = this.resolveLoadedSelector(
        loaded,
        selector,
        path,
        pointerScope,
        (selected) =>
          this.resolveTemplateAt(
            loaded.authoring.pack,
            selected,
            loaded.authoring.file,
            path,
            hops + 1,
            pointerScope,
          ),
      );
      return {
        template: template.value,
        path: template.path,
        hops: template.hops,
      };
    }

    if (selector === "$instance") {
      const base = this.resolveLoadedSelector(
        loaded,
        selector,
        path,
        pointerScope,
        (selected) =>
          this.resolveInstanceAt(
            loaded.authoring.pack,
            selected,
            loaded.authoring.file,
            path,
            hops + 1,
            pointerScope,
          ),
      );
      return {
        template: base.value.template,
        inherited: base.value.input,
        inheritedProvenance: base.value.provenance,
        inheritedAuthoring: base.authoring,
        path: base.path,
        hops: base.hops,
      };
    }

    try {
      const sibling = this.resolveTemplateAt(
        loaded.pack,
        "./",
        loaded.authoring.file,
        path,
        hops + 1,
        pointerScope,
      );
      return {
        template: sibling.value,
        path: sibling.path,
        hops: sibling.hops,
      };
    } catch (error) {
      if (
        error instanceof ResourceResolutionError &&
        error.failure.code === "missing-target" &&
        this.isAbsentSiblingTemplate(loaded)
      ) {
        return failGraphResource(
          "missing-effective-template",
          "instance has no effective sibling template facet",
          path as [ResourceGraphNode, ...ResourceGraphNode[]],
          { source: origin },
          this.failureContext(error),
        );
      }
      throw error;
    }
  }

  private resolveInstanceAt(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
    path: readonly ResourceGraphNode[] = [],
    hops = 0,
    pointerScope?: string,
  ): InstanceTraversal {
    const entered = this.enterLoaded(
      this.loadForTraversal(
        () => this.loadInstance(pack, locator, authoringFile),
        path,
        "instance",
        locator,
      ),
      path,
      hops,
    );
    const { loaded, path: nextPath, key } = entered;

    const rawInput = loaded.loaded.facet.input;
    this.assertAuthoredValueLayer(
      rawInput,
      "instance",
      loaded.loaded.facet.origin,
      loaded.loaded.locations,
      nextPath,
      hops,
    );
    const selectors = selectorKeys(rawInput);
    if (selectors.length > 1) {
      return this.failAt(
        "conflicting-selectors",
        "an instance cannot select both $template and $instance",
        traversalContext(nextPath, hops),
        { source: loaded.loaded.facet.origin, pointer: "" },
      );
    }

    const selector = selectors[0];
    const selection = this.selectInstance(
      loaded,
      selector,
      nextPath,
      hops,
      pointerScope,
    );
    const localInput = withoutKeys(
      rawInput,
      new Set(["$template", "$instance"]),
    );
    const localProvenance = provenanceForValue(
      localInput,
      loaded.loaded.facet.origin,
    );
    const localAuthoring = mapResourceValuePointers(
      localInput,
      loaded.authoring,
    );

    const merged = this.mergeValues(selection.inherited, localInput, {
      inheritedProvenance: selection.inheritedProvenance,
      localProvenance,
      inheritedAuthoring: selection.inheritedAuthoring,
      localAuthoring,
      inheritedOrigin: selection.inherited
        ? loaded.loaded.facet.origin
        : undefined,
      localOrigin: loaded.loaded.facet.origin,
    });
    if (!isSafeJsonObject(merged.value)) {
      return this.failAt(
        "invalid-resolved-input",
        "resolved instance input must be a JSON object",
        traversalContext(selection.path, selection.hops),
        { source: loaded.loaded.facet.origin },
      );
    }
    const normalized = this.normalizeTemplateInput(
      selection.template,
      merged.value,
      merged.provenance,
      merged.authoring,
      loaded.pack,
      loaded.authoring.file,
      selection.path,
      selection.hops,
      "",
    );
    if (!isSafeJsonObject(normalized.value)) {
      return this.failAt(
        "invalid-resolved-input",
        "resolved instance input must be a JSON object",
        traversalContext(selection.path, selection.hops),
        { source: loaded.loaded.facet.origin },
      );
    }

    const resolved = Object.freeze({
      kind: "instance" as const,
      key,
      locator: loaded.loaded.facet.locator,
      origin: loaded.loaded.facet.origin,
      facet: loaded.loaded.facet,
      template: selection.template,
      effectiveTemplate: selection.template,
      input: cloneObject(normalized.value),
      provenance: cloneResourceProvenance(normalized.provenance),
      graph: snapshotResourceGraph(this.graph),
      dependencies: Object.freeze([...this.dependencies].sort()),
      unresolvedParents: Object.freeze([...this.unresolvedParents].sort()),
    });
    this.resolvedInstances.set(
      `${key}\u0000${loaded.authoring.file}`,
      resolved,
    );
    return {
      value: resolved,
      path: selection.path,
      hops: selection.hops,
      authoring: normalized.authoring,
    };
  }

  resolveInstance(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
    path: readonly ResourceGraphNode[] = [],
    hops = 0,
  ): ResolvedResourceInstance {
    return this.resolveInstanceAt(pack, locator, authoringFile, path, hops)
      .value;
  }

  private failureContext(error?: ResourceResolutionError): {
    readonly dependencies: readonly string[];
    readonly unresolvedParents: readonly string[];
  } {
    return {
      dependencies: [...this.dependencies, ...(error?.dependencies ?? [])],
      unresolvedParents: [
        ...this.unresolvedParents,
        ...(error?.unresolvedParents ?? []),
      ],
    };
  }

  private isAbsentSiblingTemplate(loaded: LoadedFacet<InstanceFacet>): boolean {
    try {
      return (
        inspectResourceFile(
          loaded.target,
          "template.jsonc",
          loaded.loaded.facet.locator,
        ) === undefined
      );
    } catch {
      return false;
    }
  }

  private failAt(
    code: Exclude<
      ResourceFailureCode,
      | "resource-cycle"
      | "resource-depth-exceeded"
      | "missing-effective-template"
      | "incompatible-template"
    >,
    message: string,
    context: TraversalContext,
    details: TraversalFailureDetails = {},
  ): never {
    const chain = this.graphChain(context.path);
    return failResource(
      code,
      message,
      chain ? { ...details, chain } : details,
      this.failureContext(),
    );
  }

  private mergeValues(
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
  ): Readonly<{
    readonly value: JsonValue | undefined;
    readonly provenance: ResourceProvenance;
    readonly authoring: AuthoringProvenance;
  }> {
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

  private normalizeSlotLocation(
    location: LocatedValue,
    slot: ResolvedTemplateSlot,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    if (
      !slot.slot.arrayItems ||
      !Array.isArray(location.value) ||
      templateAcceptsArray(slot.template)
    ) {
      const normalized = this.normalizeSlotValue(
        location.value,
        sliceProvenance(provenance, location.pointer),
        sliceContextMap(authoring, location.pointer),
        slot.template,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        appendPointer(pointerPrefix, location.pointer),
      );
      return {
        ...normalized,
        value: withResourceTemplateSelection(
          normalized.value,
          slot.slot.templateId,
        ),
      };
    }

    return this.normalizeArraySlotLocation(
      location as LocatedValue & { readonly value: readonly JsonValue[] },
      slot,
      provenance,
      authoring,
      fallbackPack,
      fallbackFile,
      path,
      hops,
      pointerPrefix,
    );
  }

  private normalizeArraySlotLocation(
    location: LocatedValue & { readonly value: readonly JsonValue[] },
    slot: ResolvedTemplateSlot,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    return this.normalizeArrayEntries(
      location,
      provenance,
      authoring,
      (item, itemPointer) => {
        const normalized = this.normalizeSlotValue(
          item,
          sliceProvenance(provenance, itemPointer),
          sliceContextMap(authoring, itemPointer),
          slot.template,
          fallbackPack,
          fallbackFile,
          path,
          hops,
          appendPointer(pointerPrefix, itemPointer),
        );
        return {
          ...normalized,
          value: withResourceTemplateSelection(
            normalized.value,
            slot.slot.templateId,
          ),
        };
      },
    );
  }

  private normalizeSlotGroupLocation(
    location: LocatedValue,
    group: SlotGroup,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    const slots = uniqueResolvedSlots(group.slots);
    const first = slots[0];
    if (!first) {
      return {
        value: cloneValue(location.value),
        provenance: cloneResourceProvenance(
          sliceProvenance(provenance, location.pointer),
        ),
        authoring: sliceContextMap(authoring, location.pointer),
      };
    }
    if (slots.length === 1) {
      return this.normalizeSlotLocation(
        location,
        first,
        provenance,
        authoring,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        pointerPrefix,
      );
    }

    if (
      first.slot.arrayItems &&
      slots.every(({ slot }) => slot.arrayItems) &&
      Array.isArray(location.value) &&
      !slots.some(({ template }) => templateAcceptsArray(template))
    ) {
      return this.normalizeArraySlotGroupLocation(
        location as LocatedValue & { readonly value: readonly JsonValue[] },
        slots,
        provenance,
        authoring,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        pointerPrefix,
      );
    }

    return this.normalizeSlotCandidates(
      location.value,
      sliceProvenance(provenance, location.pointer),
      sliceContextMap(authoring, location.pointer),
      slots,
      fallbackPack,
      fallbackFile,
      path,
      hops,
      appendPointer(pointerPrefix, location.pointer),
    );
  }

  private normalizeArraySlotGroupLocation(
    location: LocatedValue & { readonly value: readonly JsonValue[] },
    slots: readonly ResolvedTemplateSlot[],
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    return this.normalizeArrayEntries(
      location,
      provenance,
      authoring,
      (item, itemPointer) =>
        this.normalizeSlotCandidates(
          item,
          sliceProvenance(provenance, itemPointer),
          sliceContextMap(authoring, itemPointer),
          slots,
          fallbackPack,
          fallbackFile,
          path,
          hops,
          appendPointer(pointerPrefix, itemPointer),
        ),
    );
  }

  private normalizeArrayEntries(
    location: LocatedValue & { readonly value: readonly JsonValue[] },
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    normalize: (item: JsonValue, itemPointer: string) => NormalizedValue,
  ): NormalizedValue {
    const entries = location.value.map((item, index) =>
      normalize(item, childPointer(location.pointer, index)),
    );
    const output: Record<string, ResourceOrigin> = {};
    const outputAuthoring: Record<string, AuthoringContext> = {};
    const arrayOrigin = originAt(provenance, location.pointer);
    if (arrayOrigin) own(output, "", arrayOrigin);
    const arrayAuthoring = contextAt(authoring, location.pointer);
    if (arrayAuthoring) own(outputAuthoring, "", arrayAuthoring);
    for (const [index, entry] of entries.entries()) {
      for (const pointer of Object.keys(entry.provenance).sort()) {
        own(
          output,
          pointer === "" ? `/${index}` : `/${index}${pointer}`,
          entry.provenance[pointer],
        );
      }
      for (const pointer of Object.keys(entry.authoring).sort()) {
        own(
          outputAuthoring,
          pointer === "" ? `/${index}` : `/${index}${pointer}`,
          entry.authoring[pointer],
        );
      }
    }
    return {
      value: entries.map((entry) => entry.value),
      provenance: Object.freeze(output),
      authoring: Object.freeze(outputAuthoring),
    };
  }

  private normalizeSlotCandidates(
    value: JsonValue,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    slots: readonly ResolvedTemplateSlot[],
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    sourcePointer: string,
  ): NormalizedValue {
    const candidates = uniqueResolvedSlots(slots);
    const first = candidates[0];
    if (!first) {
      return unchangedNormalizedValue(value, provenance, authoring);
    }
    if (candidates.length === 1) {
      return this.normalizeSlotValue(
        value,
        provenance,
        authoring,
        first.template,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        sourcePointer,
      );
    }

    const selected = selectedSlotCandidate(value, candidates);
    if (selected) {
      return this.normalizeSlotValue(
        value,
        provenance,
        authoring,
        selected.template,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        sourcePointer,
      );
    }

    if (!isConfiguredSlotValue(value, candidates))
      return unchangedNormalizedValue(value, provenance, authoring);

    return this.normalizeConfiguredSlot({
      value,
      provenance,
      authoring,
      slots: candidates,
      fallbackPack,
      fallbackFile,
      path,
      hops,
      sourcePointer,
    });
  }

  private normalizeConfiguredSlot(
    candidateContext: SlotCandidateContext,
  ): NormalizedValue {
    const {
      value,
      provenance,
      authoring,
      slots,
      fallbackPack,
      fallbackFile,
      path,
      hops,
      sourcePointer,
    } = candidateContext;
    const first = slots[0];
    if (!first) {
      return {
        value: cloneValue(value),
        provenance: cloneResourceProvenance(provenance),
        authoring: sliceContextMap(authoring, ""),
      };
    }
    const selectedContext =
      contextAt(authoring, "") ?? authoringContext(fallbackPack, fallbackFile);

    if (typeof value === "string") {
      const instance = this.resolveInstanceAt(
        selectedContext.pack,
        value,
        selectedContext.file,
        path,
        hops + 1,
        sourcePointer,
      );
      const candidate = slots.find(
        ({ template }) => template.key === instance.value.template.key,
      );
      const selected = candidate ?? first;
      this.requireCompatibleTemplate(
        instance.value.template,
        slots.map(({ template }) => template),
        instance.path,
        sourcePointer,
      );
      return {
        value: withResourceTemplateSelection(
          cloneObject(instance.value.input),
          selected.slot.templateId,
        ),
        provenance: cloneResourceProvenance(instance.value.provenance),
        authoring: instance.authoring,
      };
    }

    const fallback =
      [...slots].sort((a, b) =>
        a.template.key.localeCompare(b.template.key),
      )[0] ?? first;
    const origin = originAt(provenance, "") ?? fallback.template.origin;
    const source = this.resolveSource(
      value as Record<string, JsonValue>,
      "nested",
      undefined,
      selectedContext.pack,
      selectedContext.file,
      path,
      hops + 1,
      origin,
      "agent",
      sourcePointer,
      provenance,
      authoring,
    );
    const candidate = slots.find(
      ({ template }) => template.key === source.template.key,
    );
    const selected = candidate ?? first;
    this.requireCompatibleTemplate(
      source.template,
      slots.map(({ template }) => template),
      source.path,
      sourcePointer,
    );
    return {
      value: withResourceTemplateSelection(
        cloneObject(source.input),
        selected.slot.templateId,
      ),
      provenance: cloneResourceProvenance(source.provenance),
      authoring: source.authoring,
    };
  }

  private normalizeTemplateInput(
    template: ResolvedTemplate,
    input: JsonValue,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerPrefix: string,
  ): NormalizedValue {
    let value = cloneValue(input);
    const outputProvenance: Record<string, ResourceOrigin> = {
      ...provenance,
    };
    const outputAuthoring: Record<string, AuthoringContext> = {
      ...authoring,
    };

    for (const group of groupTemplateSlots(template.slots)) {
      const locations = locationsAt(value, group.dataPath);
      for (const location of locations) {
        const target = this.normalizeSlotGroupLocation(
          location,
          group,
          provenance,
          authoring,
          fallbackPack,
          fallbackFile,
          path,
          hops,
          pointerPrefix,
        );
        if (location.path.length === 0) value = target.value;
        else setAt(value, location.path, target.value);
        replaceProvenanceSubtree(
          outputProvenance,
          location.pointer,
          target.provenance,
        );
        replaceContextSubtree(
          outputAuthoring,
          location.pointer,
          target.authoring,
        );
      }
    }

    return {
      value,
      provenance: Object.freeze(outputProvenance),
      authoring: Object.freeze(outputAuthoring),
    };
  }

  private enterInlineTemplate(
    template: ResolvedTemplate,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): TraversalContext {
    const nextPath = this.enter(graphNode(template.facet), path, hops + 1);
    return traversalContext(nextPath, hops + 1);
  }

  private normalizeSlotValue(
    value: JsonValue,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    expected: ResolvedTemplate,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    sourcePointer: string,
  ): NormalizedValue {
    if (typeof value === "string") {
      if (!templateAcceptsObject(expected) && !isBareResourceLocator(value)) {
        const inline = this.enterInlineTemplate(expected, path, hops);
        return this.normalizeSlotString(
          value,
          provenance,
          authoring,
          expected,
          fallbackPack,
          fallbackFile,
          inline.path,
          inline.hops,
          sourcePointer,
        );
      }
      return this.normalizeSlotString(
        value,
        provenance,
        authoring,
        expected,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        sourcePointer,
      );
    }

    if (isObject(value) && selectorKeys(value).length > 0) {
      return this.normalizeSlotSource(
        value,
        provenance,
        authoring,
        expected,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        sourcePointer,
      );
    }

    const inline = this.enterInlineTemplate(expected, path, hops);
    if (Array.isArray(value) || isObject(value)) {
      return this.normalizeTemplateInput(
        expected,
        value,
        provenance,
        authoring,
        fallbackPack,
        fallbackFile,
        inline.path,
        inline.hops,
        sourcePointer,
      );
    }

    return {
      value: cloneValue(value),
      provenance: cloneResourceProvenance(provenance),
      authoring: sliceContextMap(authoring, ""),
    };
  }

  private normalizeSlotString(
    value: string,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    expected: ResolvedTemplate,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    sourcePointer: string,
  ): NormalizedValue {
    if (!templateAcceptsObject(expected) && !isBareResourceLocator(value)) {
      return {
        value,
        provenance: cloneResourceProvenance(provenance),
        authoring: sliceContextMap(authoring, ""),
      };
    }

    const context =
      contextAt(authoring, "") ?? authoringContext(fallbackPack, fallbackFile);
    const instance = this.resolveInstanceAt(
      context.pack,
      value,
      context.file,
      path,
      hops + 1,
      sourcePointer,
    );
    this.requireCompatibleTemplate(
      instance.value.template,
      [expected],
      instance.path,
      sourcePointer,
    );
    return {
      value: cloneObject(instance.value.input),
      provenance: cloneResourceProvenance(instance.value.provenance),
      authoring: instance.authoring,
    };
  }

  private normalizeSlotSource(
    value: Record<string, JsonValue>,
    provenance: ResourceProvenance,
    authoring: AuthoringProvenance,
    expected: ResolvedTemplate,
    fallbackPack: ResourcePack,
    fallbackFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    sourcePointer: string,
  ): NormalizedValue {
    const origin = originAt(provenance, "");
    const context =
      contextAt(authoring, "") ?? authoringContext(fallbackPack, fallbackFile);
    const source = this.resolveSource(
      value,
      "nested",
      expected,
      context.pack,
      context.file,
      path,
      hops + 1,
      origin ?? expected.origin,
      "agent",
      sourcePointer,
      provenance,
      authoring,
    );
    return {
      value: cloneObject(source.input),
      provenance: cloneResourceProvenance(source.provenance),
      authoring: source.authoring,
    };
  }

  private requireCompatibleTemplate(
    actual: ResolvedTemplate,
    expected: readonly ResolvedTemplate[],
    path: readonly ResourceGraphNode[],
    sourcePointer: string,
  ): void {
    const expectedKeys = [
      ...new Set(expected.map((template) => template.key)),
    ].sort();
    if (expectedKeys.includes(actual.key)) return;
    failGraphResource(
      "incompatible-template",
      `configured nested instance template does not match slot templates: ${actual.key} != [${expectedKeys.join(", ")}]`,
      path as [ResourceGraphNode, ...ResourceGraphNode[]],
      { source: actual.origin, pointer: sourcePointer || undefined },
      this.failureContext(),
    );
  }

  private sourceSelector(
    source: Record<string, JsonValue>,
    context: SourceResolutionContext,
  ): SourceSelectorContext {
    const selector = selectorKeys(source)[0];
    if (selector === undefined) {
      return {
        origin: context.origin,
        authoring: authoringContext(context.pack, context.authoringFile),
      };
    }
    const selectorPointer = childPointer("", selector);
    const authoring =
      contextAt(context.sourceAuthoring, "") ??
      authoringContext(context.pack, context.authoringFile);
    return {
      selector,
      origin:
        originAt(context.sourceProvenance, selectorPointer) ?? context.origin,
      pointer: childPointer(context.sourcePointer, selector),
      location:
        authoring.locations?.[childPointer(context.sourcePointer, selector)] ??
        authoring.locations?.[selectorPointer],
      authoring:
        contextAt(context.sourceAuthoring, selectorPointer) ?? authoring,
    };
  }

  private selectSource(
    source: Record<string, JsonValue>,
    kind: "root" | "nested",
    sourceContext: SourceResolutionContext,
  ): SourceSelection {
    const selectors = selectorKeys(source);
    if (selectors.length > 1) {
      return this.failAt(
        "conflicting-selectors",
        "a resource source cannot select both $template and $instance",
        traversalContext(sourceContext.path, sourceContext.hops),
        {
          source: sourceContext.origin,
          pointer: sourceContext.sourcePointer || undefined,
        },
      );
    }

    const selector = this.sourceSelector(source, sourceContext);
    if (selector.selector === "$instance")
      return this.selectSourceInstance(
        source,
        sourceContext,
        selector.origin,
        selector.pointer,
        selector.location,
        selector.authoring,
      );
    if (selector.selector === "$template")
      return this.selectSourceTemplate(
        source,
        sourceContext,
        selector.origin,
        selector.pointer,
        selector.location,
        selector.authoring,
      );

    if (kind === "nested") {
      return this.failAt(
        "invalid-resolved-input",
        "nested source objects require $template or $instance",
        traversalContext(sourceContext.path, sourceContext.hops),
        {
          source: sourceContext.origin,
          pointer: sourceContext.sourcePointer || undefined,
        },
      );
    }

    const template = this.resolveTemplateAt(
      sourceContext.pack,
      sourceContext.subject === "skill" ? "atlante/skill" : "atlante/agent",
      sourceContext.authoringFile,
      sourceContext.path,
      sourceContext.hops,
      sourceContext.sourcePointer,
    );
    return {
      template: template.value,
      path: template.path,
      hops: template.hops,
    };
  }

  private selectSourceInstance(
    source: Record<string, JsonValue>,
    sourceContext: SourceResolutionContext,
    selectorOrigin: ResourceOrigin,
    selectorPointer: string | undefined,
    selectorLocation: JsoncLocation | undefined,
    selectedContext: AuthoringContext,
  ): SourceSelection {
    const instance = this.resolveSourceSelector(
      source,
      sourceContext,
      "$instance",
      selectorOrigin,
      selectorPointer,
      selectorLocation,
      (selected) =>
        this.resolveInstanceAt(
          selectedContext.pack,
          selected,
          selectedContext.file,
          sourceContext.path,
          sourceContext.hops,
          sourceContext.sourcePointer,
        ),
    );
    return {
      template: instance.value.template,
      inherited: instance.value.input,
      inheritedProvenance: instance.value.provenance,
      inheritedAuthoring: instance.authoring,
      path: instance.path,
      hops: instance.hops,
    };
  }

  private selectSourceTemplate(
    source: Record<string, JsonValue>,
    sourceContext: SourceResolutionContext,
    selectorOrigin: ResourceOrigin,
    selectorPointer: string | undefined,
    selectorLocation: JsoncLocation | undefined,
    selectedContext: AuthoringContext,
  ): SourceSelection {
    const template = this.resolveSourceSelector(
      source,
      sourceContext,
      "$template",
      selectorOrigin,
      selectorPointer,
      selectorLocation,
      (selected) =>
        this.resolveTemplateAt(
          selectedContext.pack,
          selected,
          selectedContext.file,
          sourceContext.path,
          sourceContext.hops,
          sourceContext.sourcePointer,
        ),
    );
    return {
      template: template.value,
      path: template.path,
      hops: template.hops,
    };
  }

  private resolveSourceSelector<T extends ResourceTraversal<unknown>>(
    source: Record<string, JsonValue>,
    sourceContext: SourceResolutionContext,
    selector: "$template" | "$instance",
    selectorOrigin: ResourceOrigin,
    selectorPointer: string | undefined,
    selectorLocation: JsoncLocation | undefined,
    resolve: (locator: RawResourceLocator) => T,
  ): T {
    const selected = this.delegateResource(
      () =>
        selectorValue(
          source,
          selector,
          selectorOrigin,
          sourceContext.sourcePointer,
          selectorLocation,
        ),
      sourceContext.path,
      selectorOrigin,
      selectorPointer,
      undefined,
      sourceContext.sourcePointer,
    );
    return this.delegateResource(
      () => resolve(selected),
      sourceContext.path,
      selectorOrigin,
      selectorPointer,
      selectorLocation,
      sourceContext.sourcePointer,
    );
  }

  private sourceObject(
    value: JsonValue | undefined,
    origin: ResourceOrigin,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): JsonObject {
    if (isSafeJsonObject(value)) return value;
    return this.failAt(
      "invalid-resolved-input",
      "resolved source input must be a JSON object",
      traversalContext(path, hops),
      { source: origin },
    );
  }

  private sourceDescription(
    context: "root" | "nested",
    value: JsonObject,
    subject: "agent" | "skill",
    origin: ResourceOrigin,
    sourcePointer: string,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): string | undefined {
    const description = value.description;
    if (context !== "root" && typeof description === "string")
      return description;
    if (typeof description === "string" && description.length > 0)
      return description;
    if (context === "root")
      return this.failAt(
        "invalid-resolved-input",
        `${subject} description must be a non-empty string after resolution`,
        traversalContext(path, hops),
        {
          source: origin,
          pointer: sourcePointer
            ? `${sourcePointer}/description`
            : "/description",
        },
      );
    return undefined;
  }

  private sourceValues(
    value: JsonObject,
    origin: ResourceOrigin,
    sourcePointer: string,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): JsonObject | undefined {
    const valueTombstones = sourceValueTombstones(value);
    if (!Object.hasOwn(value, "values")) {
      return valueTombstones.length > 0
        ? withResourceValueTombstones({}, valueTombstones)
        : undefined;
    }
    if (!isObject(value.values))
      return this.failAt(
        "invalid-resolved-input",
        "binding values must be a JSON object",
        traversalContext(path, hops),
        {
          source: origin,
          pointer: sourcePointer ? `${sourcePointer}/values` : "/values",
        },
      );
    return copySourceValues(value.values as JsonObject, valueTombstones);
  }

  private sourceMetadata(
    context: "root" | "nested",
    value: JsonObject,
    provenance: ResourceProvenance,
    origin: ResourceOrigin,
    subject: "agent" | "skill",
    sourcePointer: string,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): SourceMetadata {
    const metadataKeys = new Set(["description", "values"]);
    const description = this.sourceDescription(
      context,
      value,
      subject,
      origin,
      sourcePointer,
      path,
      hops,
    );
    const values = this.sourceValues(value, origin, sourcePointer, path, hops);
    return {
      input:
        context === "root"
          ? withoutKeys(value, metadataKeys)
          : cloneObject(value),
      provenance:
        context === "root"
          ? removeProvenance(provenance, metadataKeys)
          : provenance,
      ...(description ? { description } : {}),
      ...(values ? { values } : {}),
    };
  }

  private sourceLocalContext(
    source: Record<string, JsonValue>,
    origin: ResourceOrigin,
    pack: ResourcePack,
    authoringFile: string,
    sourceProvenance: ResourceProvenance | undefined,
    sourceAuthoring: AuthoringProvenance | undefined,
  ): SourceLocalContext {
    const value = withoutKeys(source, new Set(["$template", "$instance"]));
    return {
      value,
      provenance: sourceProvenance
        ? removeProvenance(
            sourceProvenance,
            new Set(["$template", "$instance"]),
          )
        : provenanceForValue(value, origin),
      authoring: sourceAuthoring
        ? removeContextMap(sourceAuthoring, new Set(["$template", "$instance"]))
        : mapResourceValuePointers(
            value,
            authoringContext(pack, authoringFile),
          ),
    };
  }

  private buildSourceResult(
    selection: SourceSelection,
    metadata: SourceMetadata,
    merged: MergedResourceValue,
    normalized: NormalizedValue,
    normalizedValue: JsonObject,
    pack: ResourcePack,
    authoringFile: string,
    origin: ResourceOrigin,
  ): SourceResult {
    const bindingProvenance: Record<string, ResourceOrigin> = {};
    const bindingAuthoring: Record<string, AuthoringContext> = {};
    if (metadata.description) {
      const descriptionOrigin =
        originAt(merged.provenance, "/description") ?? origin;
      own(bindingProvenance, "/description", descriptionOrigin);
      own(
        bindingAuthoring,
        "/description",
        contextAt(merged.authoring, "/description") ??
          authoringContext(pack, authoringFile),
      );
    }
    for (const pointer of Object.keys(normalized.provenance).sort()) {
      own(bindingProvenance, pointer, normalized.provenance[pointer]);
      const context = contextAt(normalized.authoring, pointer);
      if (context) own(bindingAuthoring, pointer, context);
    }
    addBindingValuesProvenance(
      bindingProvenance,
      merged.provenance,
      metadata.values,
    );
    return {
      template: selection.template,
      input: cloneObject(normalizedValue),
      provenance: Object.freeze(sortProvenance(bindingProvenance)),
      authoring: Object.freeze(bindingAuthoring),
      path: selection.path,
      hops: selection.hops,
      ...(metadata.description ? { description: metadata.description } : {}),
      ...(metadata.values ? { values: metadata.values } : {}),
    };
  }

  private resolveSource(
    source: Record<string, JsonValue>,
    context: "root" | "nested",
    expected: ResolvedTemplate | undefined,
    pack: ResourcePack,
    authoringFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    origin: ResourceOrigin,
    subject: "agent" | "skill" = "agent",
    sourcePointer = "",
    sourceProvenance?: ResourceProvenance,
    sourceAuthoring?: AuthoringProvenance,
  ): SourceResult {
    const selection = this.selectSource(source, context, {
      pack,
      authoringFile,
      path,
      hops,
      origin,
      subject,
      sourcePointer,
      sourceProvenance,
      sourceAuthoring,
    });

    const local = this.sourceLocalContext(
      source,
      origin,
      pack,
      authoringFile,
      sourceProvenance,
      sourceAuthoring,
    );
    const merged = this.mergeValues(selection.inherited, local.value, {
      inheritedProvenance: selection.inheritedProvenance,
      inheritedAuthoring: selection.inheritedAuthoring,
      inheritedOrigin: selection.inherited
        ? (originAt(selection.inheritedProvenance, "") ?? origin)
        : undefined,
      localOrigin: origin,
      localProvenance: local.provenance,
      localAuthoring: local.authoring,
    });
    const mergedValue = this.sourceObject(
      merged.value,
      origin,
      selection.path,
      selection.hops,
    );

    if (expected)
      this.requireCompatibleTemplate(
        selection.template,
        [expected],
        selection.path,
        sourcePointer,
      );
    const metadata = this.sourceMetadata(
      context,
      mergedValue,
      merged.provenance,
      origin,
      subject,
      sourcePointer,
      selection.path,
      selection.hops,
    );
    const normalized = this.normalizeTemplateInput(
      selection.template,
      metadata.input,
      metadata.provenance,
      merged.authoring,
      pack,
      authoringFile,
      selection.path,
      selection.hops,
      sourcePointer,
    );
    const normalizedValue = this.sourceObject(
      normalized.value,
      origin,
      selection.path,
      selection.hops,
    );
    return this.buildSourceResult(
      selection,
      metadata,
      merged,
      normalized,
      normalizedValue,
      pack,
      authoringFile,
      origin,
    );
  }

  private resolveBinding(
    kind: "agent" | "skill",
    id: string,
    source: JsonValue,
    pointer: string,
    root: PresetResult,
  ): ResolvedResourceBinding {
    const origin = originAt(root.provenance, pointer) ?? root.facet.origin;
    const context =
      contextAt(root.authoring, pointer) ??
      contextAt(root.authoring, "") ??
      authoringContext(
        this.projectPack,
        join(this.projectPack.lexicalRoot, "atlante.jsonc"),
      );
    const traversal =
      contextAt(root.traversal, pointer) ??
      traversalContext(root.path, root.effectiveHops + 1);
    if (typeof source !== "string" && !isObject(source)) {
      return this.failAt(
        "invalid-resolved-input",
        `${kind} source must be a locator string or object`,
        traversal,
        { source: origin, pointer },
      );
    }
    const sourceResult = this.resolveBindingSource(
      source,
      kind,
      origin,
      context,
      traversal,
      pointer,
      root,
    );
    if (!sourceResult.description) {
      return this.failAt(
        "invalid-resolved-input",
        `${kind} description must be a non-empty string after resolution`,
        traversal,
        { source: origin, pointer: `${pointer}/description` },
      );
    }
    return Object.freeze({
      id,
      kind,
      description: sourceResult.description,
      template: sourceResult.template,
      input: sourceResult.input,
      ...(sourceResult.values ? { values: sourceResult.values } : {}),
      provenance: sourceResult.provenance,
    });
  }

  private resolveBindingSource(
    source: string | Record<string, JsonValue>,
    kind: "agent" | "skill",
    origin: ResourceOrigin,
    authoring: AuthoringContext,
    traversal: TraversalContext,
    pointer: string,
    root: PresetResult,
  ): SourceResult {
    const sourceValue =
      typeof source === "string" ? { $instance: source } : source;
    const sourceProvenance =
      typeof source === "string"
        ? provenanceForValue(sourceValue, origin)
        : sliceProvenance(root.provenance, pointer);
    const sourceAuthoring =
      typeof source === "string"
        ? mapResourceValuePointers(sourceValue, authoring)
        : sliceContextMap(root.authoring, pointer);
    return this.resolveSource(
      sourceValue,
      "root",
      undefined,
      authoring.pack,
      authoring.file,
      traversal.path,
      traversal.hops,
      origin,
      kind,
      pointer,
      sourceProvenance,
      sourceAuthoring,
    );
  }

  private resolveBindingCollection(
    kind: "agents" | "skills",
    collection: JsonValue | undefined,
    root: PresetResult,
  ): BindingCollection {
    if (collection === undefined) {
      return { bindings: {}, normalized: {}, provenance: {} };
    }
    if (!isObject(collection)) {
      return this.failAt(
        "invalid-resolved-input",
        `${kind} must be a JSON object`,
        traversalContext(root.path, root.effectiveHops),
        { source: root.facet.origin, pointer: `/${kind}` },
      );
    }

    const bindings: Record<string, ResolvedResourceBinding> = {};
    const normalized: Record<string, Record<string, unknown>> = {};
    const provenance: Record<string, ResourceOrigin> = {};
    for (const id of Object.keys(collection).sort()) {
      const binding = this.resolveBinding(
        kind === "agents" ? "agent" : "skill",
        id,
        collection[id] as JsonValue,
        `/${kind}/${escapePointer(id)}`,
        root,
      );
      own(bindings, id, binding);
      own(normalized, id, descriptorData(binding.description, binding.input));
      for (const pointer of Object.keys(binding.provenance).sort()) {
        own(
          provenance,
          `/${kind}/${escapePointer(id)}${pointer}`,
          binding.provenance[pointer],
        );
      }
    }
    return { bindings, normalized, provenance };
  }

  resolveDocument(
    rootFile: string,
    rootDocument?: JsonObject,
  ): ResolvedResourceDocument {
    const loaded = rootDocument
      ? this.memoryPreset(rootFile, rootDocument)
      : this.loadForTraversal(
          () => this.loadPreset(this.projectPack, "./", rootFile),
          [],
          "preset",
          "./",
        );
    const node = graphNode(loaded.loaded.facet);
    const path = this.enter(node, [], 0);
    const root = this.resolvePresetLoaded(loaded, node, path, 0);
    const normalizedValue = cloneValue(root.effectiveRaw) as Record<
      string,
      JsonValue
    >;
    if (!isObject(normalizedValue)) {
      return this.failAt(
        "invalid-resolved-input",
        "resolved root preset must be a JSON object",
        traversalContext(root.path, root.effectiveHops),
        { source: root.facet.origin },
      );
    }

    const resultProvenance: Record<string, ResourceOrigin> = {
      ...root.provenance,
    };
    for (const key of ["/agents", "/skills"])
      removeProvenanceSubtree(resultProvenance, key);

    const agentsResult = this.resolveBindingCollection(
      "agents",
      normalizedValue.agents,
      root,
    );
    const skillsResult = this.resolveBindingCollection(
      "skills",
      normalizedValue.skills,
      root,
    );

    own(normalizedValue, "agents", agentsResult.normalized);
    own(normalizedValue, "skills", skillsResult.normalized);
    for (const provenance of [
      agentsResult.provenance,
      skillsResult.provenance,
    ]) {
      for (const pointer of Object.keys(provenance).sort())
        own(resultProvenance, pointer, provenance[pointer]);
    }

    const normalized = cloneNormalizedDocument(normalizedValue);
    const result = Object.freeze({
      raw: cloneObject(root.facet.document),
      effectiveRaw: cloneObject(root.effectiveRaw),
      normalized,
      document: normalized,
      bindings: Object.freeze({
        agents: Object.freeze({ ...agentsResult.bindings }),
        skills: Object.freeze({ ...skillsResult.bindings }),
      }),
      provenance: Object.freeze(sortProvenance(resultProvenance)),
      graph: snapshotResourceGraph(this.graph),
      templates: Object.freeze(
        [...this.resolvedTemplates.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, template]) => template),
      ),
      instances: Object.freeze(
        [...this.resolvedInstances.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([, instance]) => instance),
      ),
      dependencies: Object.freeze([...this.dependencies].sort()),
      unresolvedParents: Object.freeze([...this.unresolvedParents].sort()),
    });
    return result;
  }

  private memoryPreset(
    rootFile: string,
    document: JsonObject,
  ): LoadedFacet<Preset> {
    const target = resolveResourceLocator(this.projectPack, "./", rootFile);
    const origin = {
      kind: "project" as const,
      path: relative(this.projectPack.root, rootFile).replaceAll("\\", "/"),
    } as ResourceOrigin;
    return {
      pack: this.projectPack,
      target,
      loaded: {
        facet: {
          locator: target.locator,
          origin,
          kind: "preset" as const,
          document: cloneObject(document),
        },
        dependencies: Object.freeze([]),
        unresolvedParents: Object.freeze([]),
      },
      authoring: authoringContext(this.projectPack, rootFile),
    };
  }

  private presetExtendsLocators(
    loaded: LoadedFacet<Preset>,
    extendsValue: JsonValue,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): readonly RawResourceLocator[] {
    const isArrayExtends = Array.isArray(extendsValue);
    if (
      (typeof extendsValue !== "string" || extendsValue.length === 0) &&
      (!isArrayExtends || extendsValue.length === 0)
    ) {
      return this.failAt(
        "invalid-resolved-input",
        "preset extends must be a non-empty string or array",
        traversalContext(path, hops),
        {
          source: loaded.loaded.facet.origin,
          pointer: "/extends",
          location: loaded.loaded.locations?.["/extends"],
        },
      );
    }
    if (!isArrayExtends) return [extendsValue as RawResourceLocator];

    return extendsValue.map((locator, index): RawResourceLocator => {
      if (typeof locator !== "string" || locator.length === 0) {
        return this.failAt(
          "invalid-resolved-input",
          "preset extends entries must be non-empty strings",
          traversalContext(path, hops),
          {
            source: loaded.loaded.facet.origin,
            pointer: `/extends/${index}`,
            location: loaded.loaded.locations?.[`/extends/${index}`],
          },
        );
      }
      return locator;
    });
  }

  private resolvePresetChild(
    loaded: LoadedFacet<Preset>,
    locator: RawResourceLocator,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointer: string,
  ): PresetResult {
    const next = this.delegateResource(
      () =>
        this.loadForTraversal(
          () => this.loadPreset(loaded.pack, locator, loaded.authoring.file),
          path,
          "preset",
          locator,
        ),
      path,
      loaded.loaded.facet.origin,
      pointer,
      loaded.loaded.locations?.[pointer],
    );
    const child = graphNode(next.loaded.facet);
    const childPath = this.enter(child, path, hops + 1);
    return this.resolvePresetLoaded(next, child, childPath, hops + 1);
  }

  private mergePresetSibling(
    base: PresetResult | undefined,
    child: PresetResult,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): PresetResult {
    const merged = this.mergeValues(base?.effectiveRaw, child.effectiveRaw, {
      inheritedProvenance: base?.provenance,
      inheritedAuthoring: base?.authoring,
      inheritedOrigin: base?.facet.origin,
      localOrigin: child.facet.origin,
      localProvenance: child.provenance,
      localAuthoring: child.authoring,
    });
    if (!isSafeJsonObject(merged.value)) {
      return this.failAt(
        "invalid-resolved-input",
        "preset root must resolve to a JSON object",
        traversalContext(path, hops),
        { source: child.facet.origin },
      );
    }
    return Object.freeze({
      ...child,
      effectiveRaw: cloneObject(merged.value),
      provenance: cloneResourceProvenance(merged.provenance),
      authoring: merged.authoring,
      traversal: mergeContextMap(
        merged.provenance,
        child.provenance,
        child.traversal,
        base?.traversal,
      ),
      effectiveHops: this.maxPresetBranchDepth(base, child),
    });
  }

  private maxPresetBranchDepth(
    base: PresetResult | undefined,
    child: PresetResult,
  ): number {
    return Math.max(base?.effectiveHops ?? 0, child.effectiveHops);
  }

  private resolvePresetArray(
    loaded: LoadedFacet<Preset>,
    locators: readonly RawResourceLocator[],
    path: readonly ResourceGraphNode[],
    hops: number,
  ): PresetResult {
    let base: PresetResult | undefined;
    for (const [index, locator] of locators.entries()) {
      base = this.mergePresetSibling(
        base,
        this.resolvePresetChild(
          loaded,
          locator,
          path,
          hops,
          `/extends/${index}`,
        ),
        path,
        hops,
      );
    }
    return base as PresetResult;
  }

  private loadPresetBase(
    loaded: LoadedFacet<Preset>,
    raw: JsonObject,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): PresetResult | undefined {
    if (!Object.hasOwn(raw, "extends")) return undefined;
    const extendsValue = raw.extends as JsonValue;
    const locators = this.presetExtendsLocators(
      loaded,
      extendsValue,
      path,
      hops,
    );
    if (!Array.isArray(extendsValue))
      return this.resolvePresetChild(
        loaded,
        locators[0] as RawResourceLocator,
        path,
        hops,
        "/extends",
      );
    return this.resolvePresetArray(loaded, locators, path, hops);
  }

  private resolvePresetLoaded(
    loaded: LoadedFacet<Preset>,
    node: ResourceGraphNode,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): PresetResult {
    const raw = loaded.loaded.facet.document;
    this.assertAuthoredValueLayer(
      raw,
      "preset",
      loaded.loaded.facet.origin,
      loaded.loaded.locations,
      path,
      hops,
    );
    const base = this.loadPresetBase(loaded, raw, path, hops);
    const local = withoutKeys(raw, new Set(["extends"]));
    const localProvenance = provenanceForValue(
      local,
      loaded.loaded.facet.origin,
    );
    const effectiveHops = base?.effectiveHops ?? hops;
    const merged = this.mergeValues(base?.effectiveRaw, local, {
      inheritedProvenance: base?.provenance,
      inheritedAuthoring: base?.authoring,
      inheritedOrigin: base?.facet.origin,
      localOrigin: loaded.loaded.facet.origin,
      localProvenance,
      localAuthoring: mapResourceValuePointers(local, loaded.authoring),
    });
    if (!isSafeJsonObject(merged.value)) {
      return this.failAt(
        "invalid-resolved-input",
        "preset root must resolve to a JSON object",
        traversalContext(path, hops),
        { source: loaded.loaded.facet.origin },
      );
    }
    const result = Object.freeze({
      facet: loaded.loaded.facet,
      node,
      path: Object.freeze([...path]),
      effectiveRaw: cloneObject(merged.value),
      provenance: cloneResourceProvenance(merged.provenance),
      authoring: merged.authoring,
      traversal: mergeContextMap(
        merged.provenance,
        localProvenance,
        mapResourceValuePointers(
          local,
          traversalContext(path, effectiveHops + 1),
        ),
        base?.traversal,
      ),
      effectiveHops,
    });
    return result;
  }

  private assertAuthoredValueLayer(
    source: JsonObject,
    kind: "instance" | "preset",
    origin: ResourceOrigin,
    locations: Readonly<Record<string, JsoncLocation>> | undefined,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): void {
    const valueIssue = authoredValueLayerIssues(source, {
      kind,
      locations,
    })[0];
    if (!valueIssue) return;
    this.failAt(
      "invalid-resolved-input",
      valueIssue.message,
      traversalContext(path, hops),
      {
        source: origin,
        pointer: valueIssue.pointer,
        ...(valueIssue.location ? { location: valueIssue.location } : {}),
      },
    );
  }
}

function requireTarget(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  options: ResourceLocatorOptions = {},
): ResolvedResourceTarget {
  // Kept as a small seam so every facet read still goes through the T3
  // locator checks before the selected facet loader opens a file.
  return resolveResourceLocator(pack, locator, authoringFile, options);
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function sortProvenance(
  provenance: Record<string, ResourceOrigin>,
): Record<string, ResourceOrigin> {
  const output: Record<string, ResourceOrigin> = {};
  for (const key of Object.keys(provenance).sort())
    own(output, key, provenance[key]);
  return output;
}

function addBindingValuesProvenance(
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

function cloneNormalizedDocument(
  value: Record<string, JsonValue>,
): NormalizedResourceDocument {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    own(output, key, cloneValue(value[key] as JsonValue));
  }
  return output as NormalizedResourceDocument;
}

function templateAcceptsArray(template: ResolvedTemplate): boolean {
  return (
    isObject(template.facet.inputSchema) &&
    template.facet.inputSchema.type === "array"
  );
}

function templateAcceptsObject(template: ResolvedTemplate): boolean {
  return (
    isObject(template.facet.inputSchema) &&
    template.facet.inputSchema.type === "object"
  );
}

function uniqueResolvedSlots(
  slots: readonly ResolvedTemplateSlot[],
): ResolvedTemplateSlot[] {
  const unique = new Map<string, ResolvedTemplateSlot>();
  for (const slot of slots) {
    if (!unique.has(slot.template.key)) unique.set(slot.template.key, slot);
  }
  return [...unique.values()];
}

function groupTemplateSlots(
  slots: readonly ResolvedTemplateSlot[],
): readonly SlotGroup[] {
  const groups = new Map<
    string,
    { dataPath: string[]; slots: ResolvedTemplateSlot[] }
  >();
  for (const slot of slots) {
    const dataPath = slot.slot.dataPath ?? [slot.slot.property];
    const key = JSON.stringify(dataPath);
    const group = groups.get(key);
    if (group) {
      group.slots.push(slot);
    } else {
      groups.set(key, { dataPath: [...dataPath], slots: [slot] });
    }
  }
  return [...groups.values()].map(({ dataPath, slots: grouped }) => ({
    dataPath: Object.freeze(dataPath),
    slots: Object.freeze(grouped),
  }));
}

export function resolveResourceInstance(
  request: ResolveInstanceRequest,
): ResolvedResourceInstance;
export function resolveResourceInstance(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  options?: ResourceResolveOptions,
): ResolvedResourceInstance;
export function resolveResourceInstance(
  requestOrPack: ResolveInstanceRequest | ResourcePack,
  locator?: RawResourceLocator,
  authoringFile?: string,
  options: ResourceResolveOptions = {},
): ResolvedResourceInstance {
  const request = requestWithPack<ResolveInstanceRequest>(requestOrPack, {
    locator: locator as RawResourceLocator,
    authoringFile: authoringFile as string,
    ...options,
  });
  return runResourceRequest(request, (resolver) =>
    resolver.resolveInstance(
      request.pack,
      request.locator,
      request.authoringFile,
    ),
  );
}

export function resolveResourceTemplate(
  request: ResolveTemplateRequest,
): ResolvedTemplate;
export function resolveResourceTemplate(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  options?: ResourceResolveOptions,
): ResolvedTemplate;
export function resolveResourceTemplate(
  requestOrPack: ResolveTemplateRequest | ResourcePack,
  locator?: RawResourceLocator,
  authoringFile?: string,
  options: ResourceResolveOptions = {},
): ResolvedTemplate {
  const request = requestWithPack<ResolveTemplateRequest>(requestOrPack, {
    locator: locator as RawResourceLocator,
    authoringFile: authoringFile as string,
    ...options,
  });
  return runResourceRequest(request, (resolver) =>
    resolver.resolveTemplate(
      request.pack,
      request.locator,
      request.authoringFile,
    ),
  );
}

export function resolveResourceDocument(
  request: ResolveDocumentRequest,
): ResolvedResourceDocument;
export function resolveResourceDocument(
  pack: ResourcePack,
  rootFile: string,
  options?: ResourceResolveOptions,
): ResolvedResourceDocument;
export function resolveResourceDocument(
  requestOrPack: ResolveDocumentRequest | ResourcePack,
  rootFile?: string,
  options: ResourceResolveOptions = {},
): ResolvedResourceDocument {
  const request = requestWithPack<ResolveDocumentRequest>(requestOrPack, {
    rootFile: rootFile as string,
    ...options,
  });
  return runResourceRequest(request, (resolver) =>
    resolver.resolveDocument(request.rootFile, request.rootDocument),
  );
}

export const resolveInstance = resolveResourceInstance;
export const resolveTemplate = resolveResourceTemplate;
export const resolveDocument = resolveResourceDocument;
export const resolveResource = resolveResourceDocument;
