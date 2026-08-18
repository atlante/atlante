import { dirname } from "node:path";
import { type LoadResult, loadDocument } from "@atlante/validator";

export type ProjectContext = Record<string, never>;

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
