export type {
  AuthoredValueIssue,
  AuthoredValueLayerKind,
} from "./authored-values.js";
export { authoredValueLayerIssues } from "./authored-values.js";
export {
  BUNDLED_RESOURCE_PACK,
  BUNDLED_RESOURCES_DIR,
  createBundledResourcePack,
} from "./bundled.js";
export type { Slot } from "./composition.js";
export { isCompositionMarker, slotsOf } from "./composition.js";
export type {
  ResourcePack,
  ResourcePackKind,
} from "./content-root.js";
export {
  createProjectResourcePack,
  createResourcePack,
} from "./content-root.js";
export type { ResourceFailureContext } from "./errors.js";
export { ResourceResolutionError } from "./errors.js";
export type {
  LoadedResource,
  ResourceLoadOptions,
} from "./facets.js";
export {
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
} from "./facets.js";
export type {
  ResolvedResourceTarget,
  ResourceFile,
  ResourceFileName,
  ResourceTargetKind,
} from "./filesystem.js";
export {
  inspectResourceFile,
  isResourceResolutionError,
  readResourceFile,
  resolveResourceLocator,
} from "./filesystem.js";
export type {
  ResourceGraph,
  ResourceGraphEdge,
  ResourceGraphState,
} from "./graph.js";
export {
  addResourceGraphEdge,
  addResourceGraphNode,
  assertResourceGraphStep,
  canonicalGraphKey,
  createResourceGraphState,
  graphNodeLabel,
  MAX_REFERENCE_HOPS,
  snapshotResourceGraph,
} from "./graph.js";
export type { JsoncLocation, ParsedJsonc } from "./jsonc.js";
export {
  JsoncParseError,
  parseJsoncWithLocations,
  parseJsonWithLocations,
} from "./jsonc.js";
export type { ParsedResourceLocator } from "./locator.js";
export { parseResourceLocator, validateResourceLocator } from "./locator.js";
export type { ResourceMergeOptions, ResourceMergeResult } from "./merge.js";
export {
  mergeResource,
  mergeResourceValues,
  provenanceOfResourceValue,
} from "./merge.js";
export type { ResourceProvenance } from "./provenance.js";
export {
  childPointer,
  cloneResourceProvenance,
  originAt,
  prefixProvenance,
  provenanceForValue,
} from "./provenance.js";
export type { ResolvedRenderArgs } from "./renderer.js";
export {
  InvalidValueReferenceError,
  interpolateValues,
  MissingValueError,
  NonStringValueError,
  renderResolvedTemplate,
  renderString,
  SLOT_PARTIAL_PREFIX,
  slotPartialName,
  ValueReferenceCollisionError,
} from "./renderer.js";
export type {
  ResourceTemplateSelection,
  ResourceValueTombstones,
} from "./resolution.js";
export {
  resourceTemplateSelection,
  resourceValueTombstones,
  withResourceTemplateSelection,
} from "./resolution.js";
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
  ResourceResolveOptions,
} from "./resolve.js";
export {
  resolveDocument,
  resolveInstance,
  resolveResource,
  resolveResourceDocument,
  resolveResourceInstance,
  resolveResourceTemplate,
  resolveTemplate,
} from "./resolve.js";
export {
  JSON_SCHEMA_DRAFT_2020_12_URI,
  TEMPLATE_ID_PATTERN,
  TEMPLATE_NAME_PATTERN,
} from "./schema.js";
export {
  resolveSystemValues,
  SYSTEM_RESOLVERS,
  UnknownSystemVariableError,
} from "./system-values.js";
export type {
  AuthoredResourceLocator,
  BuiltinResourceLocator,
  BundledResourceOrigin,
  InstanceFacet,
  InstanceResourceGraphNode,
  JsonObject,
  JsonValue,
  LocalResourceLocator,
  Preset,
  PresetResourceGraphNode,
  ProjectResourceOrigin,
  RawBundledResourceOrigin,
  RawProjectResourceOrigin,
  RawResourceLocator,
  RawResourceOrigin,
  ResourceError,
  ResourceFacetKind,
  ResourceFailure,
  ResourceFailureCode,
  ResourceGraphChain,
  ResourceGraphFailure,
  ResourceGraphFailureCode,
  ResourceGraphNode,
  ResourceIdentity,
  ResourceLocation,
  ResourceLocator,
  ResourceOrigin,
  TemplateFacet,
  TemplateResourceGraphNode,
  ValidatedBuiltinResourceLocator,
  ValidatedLocalResourceLocator,
  ValidatedResourceLocator,
} from "./types.js";
export type { ValueReference, ValueReferenceVisitor } from "./values.js";
export {
  analyzeValueReferences,
  isValidValueKey,
  walkValueReferences,
} from "./values.js";
