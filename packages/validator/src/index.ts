export type { Diagnostic } from "./diagnostic.ts";
export {
  error,
  escapeJsonPointerSegment,
  formatDiagnostic,
  hasErrors,
  warning,
} from "./diagnostic.ts";
export { CONFIG_FILENAMES, discoverConfigPath } from "./discover.ts";
export {
  loadDocument,
  parseDocumentOverlay,
  validateDocumentText,
} from "./document.ts";
export type { PresetLoader } from "./expand.ts";
export { expandDocument } from "./expand.ts";
export { templateLoadDiagnostics } from "./loader-diagnostics.ts";
export {
  expandInputSchema,
  promptInputOf,
  validateAgentInput,
  validateTemplates,
} from "./templates.ts";
