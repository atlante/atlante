import type { AtlanteDocument } from "@atlante/schema";
import {
  loadBundledTemplates,
  type TemplateRegistry,
} from "@atlante/templates";
import {
  createBundledPresetLoader,
  type Diagnostic,
  expandDocument,
  findConfigFile,
  loadDocument,
  parseDocumentOverlay,
  templateLoadDiagnostics,
} from "@atlante/validator";

export type LoadedCliResources = {
  document?: AtlanteDocument;
  path?: string;
  registry?: TemplateRegistry;
  diagnostics: Diagnostic[];
};

/**
 * Loads the user document, expands preset inheritance, and loads bundled
 * templates. Returns a canonical document ready for validation or resolution.
 */
export function loadCliResources(target: string): LoadedCliResources {
  const config = findConfigFile(target);
  if (!config) {
    return loadDocument(target);
  }

  // Parse as overlay first — this accepts extends and tombstone nulls.
  const parsed = parseDocumentOverlay(config.text, config.path);
  if (!parsed.overlay) {
    return { path: config.path, diagnostics: parsed.diagnostics };
  }

  // Load bundled templates.
  const { registry, errors } = loadBundledTemplates();
  if (errors.length > 0) {
    return {
      path: config.path,
      diagnostics: [...parsed.diagnostics, ...templateLoadDiagnostics(errors)],
    };
  }

  const presetLoader = createBundledPresetLoader();
  const expanded = expandDocument(parsed.overlay, presetLoader);
  return {
    document: expanded.document,
    path: config.path,
    registry,
    diagnostics: [...parsed.diagnostics, ...expanded.diagnostics],
  };
}
