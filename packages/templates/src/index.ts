export { BUNDLED_TEMPLATES_DIR, loadBundledTemplates } from "./bundled.ts";
export type { CompositionIssue, Slot } from "./composition.ts";
export { slotsOf, walkComposition } from "./composition.ts";
export type {
  Template,
  TemplateLoadError,
  TemplateRegistry,
} from "./loader.ts";
export { loadTemplates } from "./loader.ts";
export type { TemplateManifest } from "./manifest.ts";
export {
  TEMPLATE_ID_PATTERN,
  TEMPLATE_MANIFEST_URI,
  templateManifestSchema,
} from "./manifest.ts";
export type { RenderArgs } from "./renderer.ts";
export {
  InvalidValueReferenceError,
  interpolateValues,
  MissingValueError,
  NonStringValueError,
  renderString,
  renderTemplate,
} from "./renderer.ts";
