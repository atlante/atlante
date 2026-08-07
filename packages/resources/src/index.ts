export type {
  BundledInstanceMigrationRecord,
  BundledStarterMigrationRecord,
} from "./bundled.js";
export {
  BUNDLED_RESOURCES_DIR,
  loadBundledInstanceMigrationRecords,
  loadBundledStarterMigrationRecord,
  loadBundledTemplateMigrationRegistry,
} from "./bundled.js";
export type { CompositionIssue, Slot } from "./composition.js";
export { slotsOf, walkComposition } from "./composition.js";
export type {
  FacetOriginKind,
  TemplateLoadError,
  TemplateLoaderDeps,
  TemplateMigrationRecord,
  TemplateRegistry,
} from "./loader.js";
export { loadTemplateMigrationRegistry, parseJsonc } from "./loader.js";
export type { RenderArgs } from "./renderer.js";
export {
  InvalidValueReferenceError,
  interpolateValues,
  MissingValueError,
  NonStringValueError,
  renderString,
  renderTemplate,
  SLOT_PARTIAL_PREFIX,
  slotPartialName,
  ValueReferenceCollisionError,
} from "./renderer.js";
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
