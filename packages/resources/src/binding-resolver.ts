import { join } from "node:path";
import type { ResourcePack } from "./content-root.js";
import { own } from "./object.js";
import {
  mapResourceValuePointers,
  originAt,
  provenanceForValue,
  type ResourceProvenance,
} from "./provenance.js";
import type { ResolutionTraversal } from "./resolution-traversal.js";
import type {
  AuthoringContext,
  AuthoringProvenance,
  BindingCollection,
  PresetResult,
  ResolvedResourceBinding,
  ResolvedTemplate,
  ResourceBindingCollectionSpec,
  SourceResult,
  TraversalContext,
} from "./resolution-types.js";
import {
  authoringContext,
  contextAt,
  descriptorData,
  escapePointer,
  isObject,
  sliceContextMap,
  sliceProvenance,
  traversalContext,
} from "./resolution-values.js";
import type { JsonValue, ResourceGraphNode, ResourceOrigin } from "./types.js";

/** Re-entry operations the binding resolver needs from the coordinator. */
export type BindingResolverHost = Readonly<{
  /** Project pack used as the fallback authoring context for bindings. */
  readonly projectPack: ResourcePack;
  resolveSource: (
    source: Record<string, JsonValue>,
    context: "root" | "nested",
    expected: ResolvedTemplate | undefined,
    pack: ResourcePack,
    authoringFile: string,
    path: readonly ResourceGraphNode[],
    hops: number,
    origin: ResourceOrigin,
    spec: ResourceBindingCollectionSpec | undefined,
    sourcePointer: string,
    sourceProvenance: ResourceProvenance | undefined,
    sourceAuthoring: AuthoringProvenance | undefined,
  ) => SourceResult;
}>;

/**
 * Materializes declared binding collections of the root document into resolved
 * binding entries, one per collection id, with normalized descriptor data.
 */
export class BindingResolver {
  constructor(
    private readonly traversal: ResolutionTraversal,
    private readonly host: BindingResolverHost,
  ) {}

  resolveBindingCollection(
    spec: ResourceBindingCollectionSpec,
    collection: JsonValue | undefined,
    root: PresetResult,
  ): BindingCollection {
    if (collection === undefined) {
      return { bindings: {}, normalized: {}, provenance: {} };
    }
    if (!isObject(collection)) {
      return this.traversal.failAt(
        "invalid-resolved-input",
        `${spec.key} must be a JSON object`,
        traversalContext(root.path, root.effectiveHops),
        { source: root.facet.origin, pointer: `/${spec.key}` },
      );
    }

    const bindings: Record<string, ResolvedResourceBinding> = {};
    const normalized: Record<string, Record<string, unknown>> = {};
    const provenance: Record<string, ResourceOrigin> = {};
    for (const id of Object.keys(collection).sort()) {
      const binding = this.resolveBinding(
        spec,
        id,
        collection[id] as JsonValue,
        `/${spec.key}/${escapePointer(id)}`,
        root,
      );
      own(bindings, id, binding);
      own(normalized, id, descriptorData(binding.description, binding.input));
      for (const pointer of Object.keys(binding.provenance).sort()) {
        own(
          provenance,
          `/${spec.key}/${escapePointer(id)}${pointer}`,
          binding.provenance[pointer],
        );
      }
    }
    return { bindings, normalized, provenance };
  }

  private resolveBinding(
    spec: ResourceBindingCollectionSpec,
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
        this.host.projectPack,
        join(this.host.projectPack.lexicalRoot, "atlante.jsonc"),
      );
    const traversal =
      contextAt(root.traversal, pointer) ??
      traversalContext(root.path, root.effectiveHops + 1);
    if (typeof source !== "string" && !isObject(source)) {
      return this.traversal.failAt(
        "invalid-resolved-input",
        `${spec.subject} source must be a locator string or object`,
        traversal,
        { source: origin, pointer },
      );
    }
    const sourceResult = this.resolveBindingSource(
      source,
      spec,
      origin,
      context,
      traversal,
      pointer,
      root,
    );
    if (!sourceResult.description) {
      return this.traversal.failAt(
        "invalid-resolved-input",
        `${spec.subject} description must be a non-empty string after resolution`,
        traversal,
        { source: origin, pointer: `${pointer}/description` },
      );
    }
    return Object.freeze({
      id,
      kind: spec.subject,
      description: sourceResult.description,
      template: sourceResult.template,
      input: sourceResult.input,
      ...(sourceResult.values ? { values: sourceResult.values } : {}),
      provenance: sourceResult.provenance,
    });
  }

  private resolveBindingSource(
    source: string | Record<string, JsonValue>,
    spec: ResourceBindingCollectionSpec,
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
    return this.host.resolveSource(
      sourceValue,
      "root",
      undefined,
      authoring.pack,
      authoring.file,
      traversal.path,
      traversal.hops,
      origin,
      spec,
      pointer,
      sourceProvenance,
      sourceAuthoring,
    );
  }
}
