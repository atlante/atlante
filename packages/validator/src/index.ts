export type { Diagnostic } from "./diagnostic.js";
export {
  error,
  escapeJsonPointerSegment,
  formatDiagnostic,
  hasErrors,
  warning,
} from "./diagnostic.js";
export {
  CONFIG_FILENAMES,
  discoverConfigPath,
  findConfigFile,
} from "./discover.js";
export {
  loadDocument,
  parseDocumentOverlay,
  validateDocumentText,
} from "./document.js";
export type { PresetLoader } from "./expand.js";
export { expandDocument } from "./expand.js";
export { templateLoadDiagnostics } from "./loader-diagnostics.js";
export {
  createBundledPresetLoader,
  hasAnyExtends,
} from "./preset-loader.js";
export {
  expandInputSchema,
  promptInputOf,
  validateAgentInput,
  validateTemplates,
} from "./templates.js";
