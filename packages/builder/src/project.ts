import { dirname } from "node:path";
import type { AtlanteDocument } from "@atlante/schema";
import {
  loadBundledTemplates,
  type TemplateLoadError,
  type TemplateRegistry,
} from "@atlante/templates";
import {
  createBundledPresetLoader,
  type Diagnostic,
  expandDocument,
  findConfigFile,
  loadDocument,
  type PresetLoader,
  parseDocumentOverlay,
  templateLoadDiagnostics,
} from "@atlante/validator";

export type TemplateLoader = () => {
  registry: TemplateRegistry;
  errors: TemplateLoadError[];
};

export type ProjectContext = {
  loadTemplates?: TemplateLoader;
  presetLoader?: PresetLoader;
};

export type LoadedProject = {
  document?: AtlanteDocument;
  configPath?: string;
  projectRoot?: string;
  registry?: TemplateRegistry;
  diagnostics: Diagnostic[];
};

function loadedLocation(
  path: string,
): Pick<LoadedProject, "configPath" | "projectRoot"> {
  return { configPath: path, projectRoot: dirname(path) };
}

/**
 * Loads a project overlay, bundled templates, and bundled preset inheritance
 * into one canonical document. No template rendering occurs here.
 */
export function loadProject(
  target: string,
  context: ProjectContext = {},
): LoadedProject {
  const config = findConfigFile(target);
  if (!config) {
    const loaded = loadDocument(target);
    if (!loaded.path) return { diagnostics: loaded.diagnostics };
    return {
      ...loadedLocation(loaded.path),
      document: loaded.document,
      diagnostics: loaded.diagnostics,
    };
  }

  const location = loadedLocation(config.path);
  const parsed = parseDocumentOverlay(config.text, config.path);
  if (!parsed.overlay) {
    return { ...location, diagnostics: parsed.diagnostics };
  }

  const { registry, errors } = (
    context.loadTemplates ?? loadBundledTemplates
  )();
  if (errors.length > 0) {
    return {
      ...location,
      diagnostics: [...parsed.diagnostics, ...templateLoadDiagnostics(errors)],
    };
  }

  const expanded = expandDocument(
    parsed.overlay,
    context.presetLoader ?? createBundledPresetLoader(),
  );
  return {
    ...location,
    document: expanded.document,
    registry,
    diagnostics: [...parsed.diagnostics, ...expanded.diagnostics],
  };
}
