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
export type { DocumentLoadOptions, ResourceWatchContext } from "./document.js";
export {
  loadDocument,
  parseDocumentOverlay,
  validateDocumentText,
} from "./document.js";
export { validateResolvedDocument } from "./templates.js";
