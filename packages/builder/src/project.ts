import { dirname } from "node:path";
import type {
  ResolvedResourceDocument,
  ResourcePack,
} from "@atlante/resources";
import type { AtlanteDocument } from "@atlante/schema";
import {
  type Diagnostic,
  loadDocument,
  type ResourceWatchContext,
} from "@atlante/validator";
import { resourceTemplateRegistry } from "./resource-registry.js";
import type { DirectTemplateRegistry } from "./template-compat.js";

export type ProjectContext = {
  bundledPack?: ResourcePack;
};

export type LoadedProject = {
  document?: AtlanteDocument;
  configPath?: string;
  projectRoot?: string;
  registry?: DirectTemplateRegistry;
  resources?: ResolvedResourceDocument;
  resourceWatch?: ResourceWatchContext;
  diagnostics: Diagnostic[];
};

function loadedLocation(
  path: string,
): Pick<LoadedProject, "configPath" | "projectRoot"> {
  return { configPath: path, projectRoot: dirname(path) };
}

/**
 * Loads one validated resource context. No second template or preset registry
 * is selected for resource-backed projects.
 */
export function loadProject(
  target: string,
  context: ProjectContext = {},
): LoadedProject {
  const loaded = loadDocument(
    target,
    context.bundledPack ? { bundledPack: context.bundledPack } : {},
  );
  if (!loaded.path) return { diagnostics: loaded.diagnostics };

  if (!loaded.document)
    return {
      ...loadedLocation(loaded.path),
      resourceWatch: loaded.resourceWatch,
      diagnostics: loaded.diagnostics,
    };

  return {
    ...loadedLocation(loaded.path),
    document: loaded.document,
    resources: loaded.resources,
    resourceWatch: loaded.resourceWatch,
    registry: loaded.resources
      ? resourceTemplateRegistry(loaded.resources)
      : undefined,
    diagnostics: loaded.diagnostics,
  };
}
