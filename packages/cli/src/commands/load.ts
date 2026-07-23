import type { AtlanteDocument } from "@atlante/schema";
import {
  loadBundledTemplates,
  type TemplateRegistry,
} from "@atlante/templates";
import {
  type Diagnostic,
  loadDocument,
  templateLoadDiagnostics,
} from "@atlante/validator";

export type LoadedCliResources = {
  document?: AtlanteDocument;
  path?: string;
  registry?: TemplateRegistry;
  diagnostics: Diagnostic[];
};

/** Loads the user document and bundled templates without rendering it. */
export function loadCliResources(target: string): LoadedCliResources {
  const loaded = loadDocument(target);
  if (!loaded.document) return loaded;

  const { registry, errors } = loadBundledTemplates();
  if (errors.length > 0) {
    return {
      path: loaded.path,
      diagnostics: templateLoadDiagnostics(errors),
    };
  }

  return {
    document: loaded.document,
    path: loaded.path,
    registry,
    diagnostics: [],
  };
}
