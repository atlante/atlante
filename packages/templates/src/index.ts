export { BUNDLED_TEMPLATES_DIR, loadBundledTemplates } from "./bundled.js";
export type { CompositionIssue, Slot } from "./composition.js";
export { slotsOf, walkComposition } from "./composition.js";
export type {
  Template,
  TemplateLoadError,
  TemplateRegistry,
} from "./loader.js";
export { loadTemplates } from "./loader.js";
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
export type { ValueReference, ValueReferenceVisitor } from "./values.js";
export {
  analyzeValueReferences,
  isValidValueKey,
  walkValueReferences,
} from "./values.js";
