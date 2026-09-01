export type { Diagnostic, DiagnosticChainEntry } from "./diagnostic.js";
export {
  error,
  escapeJsonPointerSegment,
  formatDiagnostic,
  hasErrors,
  sortDiagnostics,
  warning,
} from "./diagnostic.js";
export type { ConfigFilename } from "./discover.js";
export {
  CONFIG_FILENAMES,
  discoverConfigPath,
  findConfigFile,
} from "./discover.js";
export type {
  DocumentLoadOptions,
  LoadResult,
  ResourceWatchContext,
} from "./document.js";
export {
  loadDocument,
  parseDocumentOverlay,
  validateDocumentText,
} from "./document.js";
export { validateResolvedDocument } from "./templates.js";
