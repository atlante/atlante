import { join, relative } from "node:path";
import { authoredValueLayerIssues } from "./authored-values.js";
import { type Slot, slotsOf } from "./composition.js";
import type { ResourcePack } from "./content-root.js";
import { failGraphResource, ResourceResolutionError } from "./errors.js";
import { FacetLoader } from "./facet-loader.js";
import type { LoadedResource } from "./facets.js";
import { inspectResourceFile, resolveResourceLocator } from "./filesystem.js";
import type { JsoncLocation } from "./jsonc.js";
import { isSafeJsonObject } from "./jsonc.js";
import { mergeResourceValues } from "./merge.js";
import { own } from "./object.js";
import {
  childPointer,
  cloneResourceProvenance,
  mapResourceValuePointers,
  originAt,
  provenanceForValue,
  type ResourceProvenance,
} from "./provenance.js";
import { withResourceValueTombstones } from "./resolution.js";
import { ResolutionTraversal } from "./resolution-traversal.js";
import type {
  AuthoringContext,
  AuthoringProvenance,
  BindingCollection,
  EnteredFacet,
  InstanceTraversal,
  LoadedFacet,
  MergedResourceValue,
  NormalizedResourceDocument,
  NormalizedValue,
  PresetResult,
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
  ResourceTraversal,
  SourceLocalContext,
  SourceMetadata,
  SourceResolutionContext,
  SourceResult,
  SourceSelection,
  SourceSelectorContext,
  TraversalContext,
  TraversalFailureDetails,
} from "./resolution-types.js";
import {
  addBindingValuesProvenance,
  authoringContext,
  cloneObject,
  cloneValue,
  contextAt,
  copySourceValues,
  descriptorData,
  escapePointer,
  graphNode,
  isObject,
  mergeContextMap,
  pointerForSegments,
  removeContextMap,
  removeProvenance,
  removeProvenanceSubtree,
  schemaPointerForPath,
  selectorKeys,
  selectorValue,
  sliceContextMap,
  sliceProvenance,
  sortProvenance,
  sourceValueTombstones,
  traversalContext,
  withoutKeys,
} from "./resolution-values.js";
import { SlotNormalizer } from "./slot-normalizer.js";
import type {
  InstanceFacet,
  JsonObject,
  JsonValue,
  Preset,
  RawResourceLocator,
  ResourceFailureCode,
  ResourceGraphNode,
  ResourceOrigin,
  ResourceWatchRoot,
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

/** Neutral subject label for sources resolved outside a declared collection. */
const neutralBindingSubject = "binding";

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
  const resolver = new ResourceResolver(request.pack, request);
  return resolver.run(() => action(resolver));
}

class ResourceResolver {
  private readonly bindingCollections: readonly ResourceBindingCollectionSpec[];
  private readonly traversal = new ResolutionTraversal();
  private readonly facets: FacetLoader;
  private readonly normalizer: SlotNormalizer;
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

  private collectPack(pack: ResourcePack): void {
    this.traversal.collectPack(pack);
  }

  private collect<T>(loaded: LoadedResource<T>): void {
    this.traversal.collect(loaded);
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

  private failureContext(error?: ResourceResolutionError): {
    readonly dependencies: readonly string[];
    readonly unresolvedParents: readonly string[];
    readonly trustedRoots: readonly ResourceWatchRoot[];
  } {
    return this.traversal.failureContext(error);
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
    return this.traversal.failAt(code, message, context, details);
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

    if (!sourceContext.defaultTemplate) {
      return this.failAt(
        "invalid-resolved-input",
        "binding source object requires $template, $instance, or a collection default template",
        traversalContext(sourceContext.path, sourceContext.hops),
        {
          source: sourceContext.origin,
          pointer: sourceContext.sourcePointer || undefined,
        },
      );
    }

    const template = this.resolveTemplateAt(
      sourceContext.pack,
      sourceContext.defaultTemplate,
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
    subject: string,
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
    subject: string,
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
    spec?: ResourceBindingCollectionSpec,
    sourcePointer = "",
    sourceProvenance?: ResourceProvenance,
    sourceAuthoring?: AuthoringProvenance,
  ): SourceResult {
    const subject = spec?.subject ?? neutralBindingSubject;
    const selection = this.selectSource(source, context, {
      pack,
      authoringFile,
      path,
      hops,
      origin,
      subject,
      ...(spec?.defaultTemplate
        ? { defaultTemplate: spec.defaultTemplate }
        : {}),
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
        this.projectPack,
        join(this.projectPack.lexicalRoot, "atlante.jsonc"),
      );
    const traversal =
      contextAt(root.traversal, pointer) ??
      traversalContext(root.path, root.effectiveHops + 1);
    if (typeof source !== "string" && !isObject(source)) {
      return this.failAt(
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
      return this.failAt(
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
    return this.resolveSource(
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

  private resolveBindingCollection(
    spec: ResourceBindingCollectionSpec,
    collection: JsonValue | undefined,
    root: PresetResult,
  ): BindingCollection {
    if (collection === undefined) {
      return { bindings: {}, normalized: {}, provenance: {} };
    }
    if (!isObject(collection)) {
      return this.failAt(
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
      this.bindingCollections.map(({ key }) => key),
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
