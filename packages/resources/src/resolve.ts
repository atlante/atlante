import { authoredValueLayerIssues } from "./authored-values.js";
import { BindingResolver } from "./binding-resolver.js";
import { type Slot, slotsOf } from "./composition.js";
import type { ResourcePack } from "./content-root.js";
import { FacetLoader } from "./facet-loader.js";
import type { JsoncLocation } from "./jsonc.js";
import { isSafeJsonObject } from "./jsonc.js";
import { own } from "./object.js";
import { PresetMerger } from "./preset-merger.js";
import {
  cloneResourceProvenance,
  mapResourceValuePointers,
  provenanceForValue,
  type ResourceProvenance,
} from "./provenance.js";
import { ResolutionTraversal } from "./resolution-traversal.js";
import type {
  AuthoringProvenance,
  BindingCollection,
  EnteredFacet,
  InstanceTraversal,
  LoadedFacet,
  NormalizedResourceDocument,
  NormalizedValue,
  PresetResult,
  ResolvedResourceBinding,
  ResolvedResourceDocument,
  ResolvedResourceInstance,
  ResolvedTemplate,
  ResolvedTemplateSlot,
  ResourceBindingCollectionSpec,
  ResourceResolveOptions,
  ResourceTraversal,
  SourceResult,
  SourceSelection,
  TraversalContext,
  TraversalFailureDetails,
} from "./resolution-types.js";
import {
  cloneObject,
  cloneValue,
  graphNode,
  isObject,
  mergeValues,
  pointerForSegments,
  removeProvenanceSubtree,
  schemaPointerForPath,
  selectorKeys,
  sortProvenance,
  traversalContext,
  withoutKeys,
} from "./resolution-values.js";
import { SlotNormalizer } from "./slot-normalizer.js";
import { SourceSelector } from "./source-selector.js";
import type {
  InstanceFacet,
  JsonObject,
  JsonValue,
  Preset,
  RawResourceLocator,
  ResourceFailureCode,
  ResourceGraphNode,
  ResourceOrigin,
  TemplateFacet,
} from "./types.js";

export type {
  NormalizedResourceDocument,
  ResolveDocumentRequest,
  ResolvedResourceBinding,
  ResolvedResourceDocument,
  ResolvedResourceInstance,
  ResolvedTemplate,
  ResolvedTemplateSlot,
  ResolveInstanceRequest,
  ResolveTemplateRequest,
  ResourceBindingCollectionSpec,
  ResourceResolveOptions,
} from "./resolution-types.js";

/** Coordinates the resolver collaborators and hosts the traversal core. */
export class ResourceResolver {
  private readonly bindingCollections: readonly ResourceBindingCollectionSpec[];
  private readonly traversal = new ResolutionTraversal();
  private readonly facets: FacetLoader;
  private readonly normalizer: SlotNormalizer;
  private readonly sources: SourceSelector;
  private readonly bindings: BindingResolver;
  private readonly presets: PresetMerger;
  /** Output indexes only; traversal never reads these resolved results. */
  private readonly resolvedTemplates = new Map<string, ResolvedTemplate>();
  private readonly resolvedInstances = new Map<
    string,
    ResolvedResourceInstance
  >();

  constructor(
    private readonly projectPack: ResourcePack,
    options: ResourceResolveOptions,
  ) {
    this.bindingCollections = options.bindingCollections ?? [];
    this.facets = new FacetLoader(
      this.traversal,
      options.beforeRead,
      options.resourceContext,
    );
    this.normalizer = new SlotNormalizer(this.traversal, {
      resolveInstanceAt: (
        pack,
        locator,
        authoringFile,
        path,
        hops,
        pointerScope,
      ) =>
        this.resolveInstanceAt(
          pack,
          locator,
          authoringFile,
          path,
          hops,
          pointerScope,
        ),
      resolveSource: (
        source,
        context,
        expected,
        pack,
        authoringFile,
        path,
        hops,
        origin,
        spec,
        sourcePointer,
        sourceProvenance,
        sourceAuthoring,
      ) =>
        this.resolveSource(
          source,
          context,
          expected,
          pack,
          authoringFile,
          path,
          hops,
          origin,
          spec,
          sourcePointer,
          sourceProvenance,
          sourceAuthoring,
        ),
    });
    this.sources = new SourceSelector(this.traversal, {
      resolveTemplateAt: (pack, locator, authoringFile, path, hops, scope) =>
        this.resolveTemplateAt(pack, locator, authoringFile, path, hops, scope),
      resolveInstanceAt: (pack, locator, authoringFile, path, hops, scope) =>
        this.resolveInstanceAt(pack, locator, authoringFile, path, hops, scope),
      normalizeTemplateInput: (
        template,
        input,
        provenance,
        authoring,
        fallbackPack,
        fallbackFile,
        path,
        hops,
        pointerPrefix,
      ) =>
        this.normalizeTemplateInput(
          template,
          input,
          provenance,
          authoring,
          fallbackPack,
          fallbackFile,
          path,
          hops,
          pointerPrefix,
        ),
      requireCompatibleTemplate: (actual, expected, path, sourcePointer) =>
        this.requireCompatibleTemplate(actual, expected, path, sourcePointer),
    });
    this.bindings = new BindingResolver(this.traversal, {
      projectPack: this.projectPack,
      resolveSource: (
        source,
        context,
        expected,
        pack,
        authoringFile,
        path,
        hops,
        origin,
        spec,
        sourcePointer,
        sourceProvenance,
        sourceAuthoring,
      ) =>
        this.resolveSource(
          source,
          context,
          expected,
          pack,
          authoringFile,
          path,
          hops,
          origin,
          spec,
          sourcePointer,
          sourceProvenance,
          sourceAuthoring,
        ),
    });
    this.presets = new PresetMerger(
      this.traversal,
      {
        loadPreset: (pack, locator, authoringFile) =>
          this.loadPreset(pack, locator, authoringFile),
      },
      this.projectPack,
      this.bindingCollections,
    );
  }

  private get dependencies(): ReadonlySet<string> {
    return this.traversal.dependencyPaths;
  }

  private get unresolvedParents(): ReadonlySet<string> {
    return this.traversal.unresolvedParentPaths;
  }

  run<T>(action: () => T): T {
    return this.traversal.run(action);
  }

  private enter(
    node: ResourceGraphNode,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): readonly ResourceGraphNode[] {
    return this.traversal.enter(node, path, hops);
  }

  private loadTemplate(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ): LoadedFacet<TemplateFacet> {
    return this.facets.loadTemplate(pack, locator, authoringFile);
  }

  private loadInstance(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ): LoadedFacet<InstanceFacet> {
    return this.facets.loadInstance(pack, locator, authoringFile);
  }

  private loadPreset(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ): LoadedFacet<Preset> {
    return this.facets.loadPreset(pack, locator, authoringFile);
  }

  private enterLoaded<T extends TemplateFacet | InstanceFacet>(
    loaded: LoadedFacet<T>,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): EnteredFacet<T> {
    return this.traversal.enterLoaded(loaded, path, hops);
  }

  private loadForTraversal<T extends TemplateFacet | InstanceFacet | Preset>(
    load: () => LoadedFacet<T>,
    path: readonly ResourceGraphNode[],
    kind: ResourceGraphNode["kind"],
    locator: RawResourceLocator,
  ): LoadedFacet<T> {
    return this.traversal.loadForTraversal(load, path, kind, locator);
  }

  private delegateResource<T>(
    action: () => T,
    path: readonly ResourceGraphNode[],
    source: ResourceOrigin | undefined,
    pointer: string | undefined,
    location?: JsoncLocation,
    pointerScope?: string,
  ): T {
    return this.traversal.delegateResource(
      action,
      path,
      source,
      pointer,
      location,
      pointerScope,
    );
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

  private selectInstance(
    loaded: LoadedFacet<InstanceFacet>,
    selector: string | undefined,
    path: readonly ResourceGraphNode[],
    hops: number,
    pointerScope?: string,
  ): SourceSelection {
    return this.sources.selectInstance(
      loaded,
      selector,
      path,
      hops,
      pointerScope,
    );
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

    const merged = mergeValues(selection.inherited, localInput, {
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
      graph: this.traversal.snapshotGraph(),
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
    return this.traversal.failAt(code, message, context, details);
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
    return this.normalizer.normalizeTemplateInput(
      template,
      input,
      provenance,
      authoring,
      fallbackPack,
      fallbackFile,
      path,
      hops,
      pointerPrefix,
    );
  }

  private requireCompatibleTemplate(
    actual: ResolvedTemplate,
    expected: readonly ResolvedTemplate[],
    path: readonly ResourceGraphNode[],
    sourcePointer: string,
  ): void {
    this.normalizer.requireCompatibleTemplate(
      actual,
      expected,
      path,
      sourcePointer,
    );
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
    spec?: ResourceBindingCollectionSpec,
    sourcePointer = "",
    sourceProvenance?: ResourceProvenance,
    sourceAuthoring?: AuthoringProvenance,
  ): SourceResult {
    return this.sources.resolveSource(
      source,
      context,
      expected,
      pack,
      authoringFile,
      path,
      hops,
      origin,
      spec,
      sourcePointer,
      sourceProvenance,
      sourceAuthoring,
    );
  }

  private resolveBindingCollection(
    spec: ResourceBindingCollectionSpec,
    collection: JsonValue | undefined,
    root: PresetResult,
  ): BindingCollection {
    return this.bindings.resolveBindingCollection(spec, collection, root);
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
    for (const { key } of this.bindingCollections)
      removeProvenanceSubtree(resultProvenance, `/${key}`);

    const bindingResults = this.bindingCollections.map((spec) => ({
      spec,
      result: this.resolveBindingCollection(
        spec,
        normalizedValue[spec.key],
        root,
      ),
    }));

    for (const { spec, result } of bindingResults)
      own(normalizedValue, spec.key, result.normalized);
    for (const { result } of bindingResults) {
      for (const pointer of Object.keys(result.provenance).sort())
        own(resultProvenance, pointer, result.provenance[pointer]);
    }

    const normalized = cloneNormalizedDocument(normalizedValue);
    const bindings: Record<
      string,
      Readonly<Record<string, ResolvedResourceBinding>>
    > = {};
    for (const { spec, result } of bindingResults)
      own(bindings, spec.key, Object.freeze({ ...result.bindings }));
    const result = Object.freeze({
      raw: cloneObject(root.facet.document),
      effectiveRaw: cloneObject(root.effectiveRaw),
      normalized,
      document: normalized,
      bindings: Object.freeze(bindings),
      provenance: Object.freeze(sortProvenance(resultProvenance)),
      graph: this.traversal.snapshotGraph(),
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
      trustedRoots: Object.freeze(this.traversal.watchRoots),
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
    bindingKeys: readonly string[] = [],
  ): void {
    const valueIssue = authoredValueLayerIssues(source, {
      kind,
      locations,
      bindingKeys,
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

  private memoryPreset(
    rootFile: string,
    document: JsonObject,
  ): LoadedFacet<Preset> {
    return this.presets.memoryPreset(rootFile, document);
  }

  private resolvePresetLoaded(
    loaded: LoadedFacet<Preset>,
    node: ResourceGraphNode,
    path: readonly ResourceGraphNode[],
    hops: number,
  ): PresetResult {
    return this.presets.resolvePresetLoaded(loaded, node, path, hops);
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
