import { relative } from "node:path";
import { authoredValueLayerIssues } from "./authored-values.js";
import type { ResourcePack } from "./content-root.js";
import { resolveResourceLocator } from "./filesystem.js";
import type { JsoncLocation } from "./jsonc.js";
import { isSafeJsonObject } from "./jsonc.js";
import {
  cloneResourceProvenance,
  mapResourceValuePointers,
  provenanceForValue,
} from "./provenance.js";
import type { ResolutionTraversal } from "./resolution-traversal.js";
import type {
  LoadedFacet,
  PresetResult,
  ResourceBindingCollectionSpec,
} from "./resolution-types.js";
import {
  authoringContext,
  cloneObject,
  graphNode,
  mergeContextMap,
  mergeValues,
  traversalContext,
  withoutKeys,
} from "./resolution-values.js";
import type {
  JsonObject,
  JsonValue,
  Preset,
  RawResourceLocator,
  ResourceGraphNode,
  ResourceOrigin,
} from "./types.js";

/** Re-entry operations the preset merger needs from the coordinator. */
export type PresetMergerHost = Readonly<{
  loadPreset: (
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ) => LoadedFacet<Preset>;
}>;

/**
 * Resolves preset inheritance: loads `extends` bases, merges sibling and base
 * overlays, and tracks effective traversal depth for root bindings.
 */
export class PresetMerger {
  constructor(
    private readonly traversal: ResolutionTraversal,
    private readonly host: PresetMergerHost,
    private readonly projectPack: ResourcePack,
    private readonly bindingCollections: readonly ResourceBindingCollectionSpec[],
  ) {}

  memoryPreset(rootFile: string, document: JsonObject): LoadedFacet<Preset> {
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

  presetExtendsLocators(
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
      return this.traversal.failAt(
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
        return this.traversal.failAt(
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

  resolvePresetChild(
    loaded: LoadedFacet<Preset>,
    locator: RawResourceLocator,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointer: string,
  ): PresetResult {
    const next = this.traversal.delegateResource(
      () =>
        this.traversal.loadForTraversal(
          () =>
            this.host.loadPreset(loaded.pack, locator, loaded.authoring.file),
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
    const childPath = this.traversal.enter(child, path, hops + 1);
    return this.resolvePresetLoaded(next, child, childPath, hops + 1);
  }

  mergePresetSibling(
    base: PresetResult | undefined,
    child: PresetResult,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): PresetResult {
    const merged = mergeValues(base?.effectiveRaw, child.effectiveRaw, {
      inheritedProvenance: base?.provenance,
      inheritedAuthoring: base?.authoring,
      inheritedOrigin: base?.facet.origin,
      localOrigin: child.facet.origin,
      localProvenance: child.provenance,
      localAuthoring: child.authoring,
    });
    if (!isSafeJsonObject(merged.value)) {
      return this.traversal.failAt(
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

  maxPresetBranchDepth(
    base: PresetResult | undefined,
    child: PresetResult,
  ): number {
    return Math.max(base?.effectiveHops ?? 0, child.effectiveHops);
  }

  resolvePresetArray(
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

  loadPresetBase(
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

  resolvePresetLoaded(
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
      this.bindingCollections.map(({ key }) => key),
    );
    const base = this.loadPresetBase(loaded, raw, path, hops);
    const local = withoutKeys(raw, new Set(["extends"]));
    const localProvenance = provenanceForValue(
      local,
      loaded.loaded.facet.origin,
    );
    const effectiveHops = base?.effectiveHops ?? hops;
    const merged = mergeValues(base?.effectiveRaw, local, {
      inheritedProvenance: base?.provenance,
      inheritedAuthoring: base?.authoring,
      inheritedOrigin: base?.facet.origin,
      localOrigin: loaded.loaded.facet.origin,
      localProvenance,
      localAuthoring: mapResourceValuePointers(local, loaded.authoring),
    });
    if (!isSafeJsonObject(merged.value)) {
      return this.traversal.failAt(
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

  assertAuthoredValueLayer(
    source: JsonObject,
    kind: "instance" | "preset",
    origin: ResourceOrigin,
    locations: Readonly<Record<string, JsoncLocation>> | undefined,
    path: readonly ResourceGraphNode[],
    hops: number,
    bindingKeys: readonly string[] = [],
  ): void {
    const valueIssue = authoredValueLayerIssues(source, {
      kind,
      locations,
      bindingKeys,
    })[0];
    if (!valueIssue) return;
    this.traversal.failAt(
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
