export type { Diagnostic, DiagnosticChainEntry } from "./diagnostic.js";
export {
  error,
  escapeJsonPointerSegment,
  formatDiagnostic,
  hasErrors,
  sortDiagnostics,
  warning,
} from "./diagnostic.js";
export {
  CONFIG_FILENAMES,
  discoverConfigPath,
  findConfigFile,
} from "./discover.js";
export type { DocumentLoadOptions } from "./document.js";
export {
  loadDocument,
  parseDocumentOverlay,
  validateDocumentText,
} from "./document.js";
export type { PresetLoader } from "./expand.js";
export { expandDocument, MAX_PRESET_DEPTH } from "./expand.js";
export { templateLoadDiagnostics } from "./loader-diagnostics.js";
export {
  createBundledPresetLoader,
  hasAnyExtends,
} from "./preset-loader.js";
export type { TemplateRegistry } from "./templates.js";
export {
  expandInputSchema,
  promptInputOf,
  validateAgentInput,
  validateResolvedDocument,
  validateSkillInput,
  validateTemplates,
} from "./templates.js";
