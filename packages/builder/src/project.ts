import { dirname } from "node:path";
import type { ResolvedResourceDocument } from "@atlante/resources";
import type { AtlanteDocument } from "@atlante/schema";
import {
  type Diagnostic,
  loadDocument,
  type ResourceWatchContext,
} from "@atlante/validator";

export type ProjectContext = Record<string, never>;

export type LoadedProject = {
  document?: AtlanteDocument;
  configPath?: string;
  projectRoot?: string;
  resources?: ResolvedResourceDocument;
  resourceWatch?: ResourceWatchContext;
  diagnostics: Diagnostic[];
};

function loadedLocation(
  path: string,
): Pick<LoadedProject, "configPath" | "projectRoot"> {
  return { configPath: path, projectRoot: dirname(path) };
}

/** Loads one validated document and its unified resolved resource context. */
export function loadProject(
  target: string,
  context: ProjectContext = {},
): LoadedProject {
  void context;
  const loaded = loadDocument(target);
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
    diagnostics: loaded.diagnostics,
  };
}
