import { dirname } from "node:path";
import type { ResourceResolutionContext } from "@atlante/resources";
import { type LoadResult, loadDocument } from "@atlante/validator";

export type ProjectContext = ResourceResolutionContext;

export type LoadedProject = Omit<LoadResult, "path"> & {
  configPath?: string;
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
  const loaded = loadDocument(target, { resourceContext: context });
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
