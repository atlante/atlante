import type { Slot } from "./composition.js";
import type {
  ResourcePack,
  ResourceResolutionContext,
} from "./content-root.js";
import type { LoadedResource } from "./facets.js";
import type { ResourceGraph } from "./graph.js";
import type { JsoncLocation } from "./jsonc.js";
import type { ResourceProvenance } from "./provenance.js";
import type { ResolvedResourceTarget } from "./resource-targets.js";
import type {
  InstanceFacet,
  JsonObject,
  JsonValue,
  PackageResourceLocator,
  Preset,
  RawResourceLocator,
  ResourceGraphNode,
  ResourceLocator,
  ResourceOrigin,
  ResourceWatchRoot,
  TemplateFacet,
} from "./types.js";

/**
 * Declares one named binding collection of a configuration document so the
 * resolver can materialize and resolve its entries.
 */
export type ResourceBindingCollectionSpec = Readonly<{
  /** Document key holding the collection. */
  readonly key: string;
  /** Subject label used in diagnostics for entries of this collection. */
  readonly subject: string;
  /** Default template locator for root sources that omit a selector. */
  readonly defaultTemplate?: RawResourceLocator;
}>;

export type ResourceResolveOptions = Readonly<{
  /** Existing facet read seam, also used by package metadata reads. */
  readonly beforeRead?: (path: string) => void;
  readonly resourceContext?: ResourceResolutionContext;
  /**
   * Declared binding collections materialized into the resolved document.
   * Undeclared collection keys stay ordinary merged document values; a root
   * binding source without a selector requires its collection's declared
   * default template.
   */
  readonly bindingCollections?: readonly ResourceBindingCollectionSpec[];
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
  readonly kind: string;
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
};

export type ResolvedResourceDocument = Readonly<{
  /** Authored root overlay, retained for the later semantic layer. */
  readonly raw: JsonObject;
  /** Effective root overlay after preset inheritance, still source-shaped. */
  readonly effectiveRaw: JsonObject;
  readonly normalized: NormalizedResourceDocument;
  readonly document: NormalizedResourceDocument;
  readonly bindings: Readonly<
    Record<string, Readonly<Record<string, ResolvedResourceBinding>>>
  >;
  readonly provenance: ResourceProvenance;
  readonly graph: ResourceGraph;
  readonly templates: readonly ResolvedTemplate[];
  readonly instances: readonly ResolvedResourceInstance[];
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
  readonly trustedRoots: readonly ResourceWatchRoot[];
  /** Package roots reached while resolving the selected project resources. */
  readonly packagePacks: readonly ResolvedResourcePackage[];
}>;

/** A selected package root and the package locators that reached it. */
export type ResolvedResourcePackage = Readonly<{
  readonly pack: ResourcePack;
  readonly locators: readonly PackageResourceLocator[];
}>;

/** A facet read through the locator checks, with its authoring context. */
export type LoadedFacet<T> = Readonly<{
  readonly pack: ResourcePack;
  readonly target: ResolvedResourceTarget;
  readonly loaded: LoadedResource<T>;
  readonly authoring: AuthoringContext;
}>;

export type AuthoringContext = Readonly<{
  readonly pack: ResourcePack;
  /** Lexical path used to resolve relative selectors. */
  readonly file: string;
  readonly locations?: Readonly<Record<string, JsoncLocation>>;
}>;

export type AuthoringProvenance = Readonly<Record<string, AuthoringContext>>;

export type TraversalContext = Readonly<{
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
}>;

export type TraversalProvenance = Readonly<Record<string, TraversalContext>>;

export type EnteredFacet<T extends TemplateFacet | InstanceFacet> = Readonly<{
  readonly loaded: LoadedFacet<T>;
  readonly node: ResourceGraphNode;
  readonly path: readonly ResourceGraphNode[];
  readonly key: string;
}>;

export type PresetResult = Readonly<{
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

export type SourceResult = Readonly<{
  readonly template: ResolvedTemplate;
  readonly input: JsonObject;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
  readonly description?: string;
  readonly values?: JsonObject;
}>;

export type SourceSelection = Readonly<{
  readonly template: ResolvedTemplate;
  readonly inherited?: JsonObject;
  readonly inheritedProvenance?: ResourceProvenance;
  readonly inheritedAuthoring?: AuthoringProvenance;
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
}>;

export type SourceResolutionContext = Readonly<{
  readonly pack: ResourcePack;
  readonly authoringFile: string;
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
  readonly origin: ResourceOrigin;
  readonly subject: string;
  /** Declared default template for root sources that omit a selector. */
  readonly defaultTemplate?: RawResourceLocator;
  readonly sourcePointer: string;
  readonly sourceProvenance?: ResourceProvenance;
  readonly sourceAuthoring?: AuthoringProvenance;
}>;

export type SourceSelectorContext = Readonly<{
  readonly selector?: string;
  readonly origin: ResourceOrigin;
  readonly pointer?: string;
  readonly location?: JsoncLocation;
  readonly authoring: AuthoringContext;
}>;

export type SourceLocalContext = Readonly<{
  readonly value: JsonObject;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
}>;

export type MergedResourceValue = Readonly<{
  readonly value: JsonValue | undefined;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
}>;

export type ResourceTraversal<T> = Readonly<{
  readonly value: T;
  readonly path: readonly ResourceGraphNode[];
  readonly hops: number;
}>;

export type InstanceTraversal = ResourceTraversal<ResolvedResourceInstance> & {
  readonly authoring: AuthoringProvenance;
};

export type SourceMetadata = Readonly<{
  readonly input: JsonObject;
  readonly provenance: ResourceProvenance;
  readonly description?: string;
  readonly values?: JsonObject;
}>;

export type BindingCollection = Readonly<{
  readonly bindings: Readonly<Record<string, ResolvedResourceBinding>>;
  readonly normalized: Readonly<Record<string, Record<string, unknown>>>;
  readonly provenance: Readonly<Record<string, ResourceOrigin>>;
}>;

export type NormalizedValue = Readonly<{
  readonly value: JsonValue;
  readonly provenance: ResourceProvenance;
  readonly authoring: AuthoringProvenance;
}>;

export type TraversalFailureDetails = Readonly<{
  readonly locator?: RawResourceLocator;
  readonly source?: ResourceOrigin;
  readonly pointer?: string;
  readonly location?: JsoncLocation;
}>;

export type LocatedValue = Readonly<{
  readonly pointer: string;
  readonly path: readonly string[];
  readonly value: JsonValue;
}>;

export type SlotGroup = Readonly<{
  readonly dataPath: readonly string[];
  readonly slots: readonly ResolvedTemplateSlot[];
}>;

export type SlotCandidateContext = Readonly<{
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
