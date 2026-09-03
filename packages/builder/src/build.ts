import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import type { Diagnostic, ResourceWatchContext } from "@atlante/validator";
import { error, hasErrors } from "@atlante/validator";
import type { HostMaterializer } from "./materializer.js";
import { loadProject, type ProjectContext } from "./project.js";
import { prepareResolvedDocument } from "./resource-prepare.js";

export type BuildDependencies = {
  /** Materializers available for the hosts a document declares. */
  materializers?: readonly HostMaterializer[];
};

export type MaterializationSummary = {
  host: string;
  writtenPaths: readonly string[];
  removedPaths: readonly string[];
};

export type BuildResult = {
  projectRoot: string;
  resourceWatch?: ResourceWatchContext;
  diagnostics: Diagnostic[];
  materializations: readonly MaterializationSummary[];
};

export function assertRealProjectRoot(projectRoot: string): void {
  const stats = lstatSync(projectRoot);
  if (stats.isSymbolicLink()) {
    throw new Error(`project root must not be a symlink: ${projectRoot}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`project root must be a directory: ${projectRoot}`);
  }
}

function hostSelection(
  hosts: readonly string[],
  dependencies: BuildDependencies,
): { selected: HostMaterializer[] } | { diagnostics: Diagnostic[] } {
  const selected: HostMaterializer[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const host of hosts) {
    const materializer = dependencies.materializers?.find(
      (candidate) => candidate.host === host,
    );
    if (materializer) {
      selected.push(materializer);
      continue;
    }
    diagnostics.push(
      error(
        "unsupported-host",
        `no materializer is registered for host "${host}"`,
        {
          next: "register a materializer for the declared host or remove the host from the document's hosts field",
        },
      ),
    );
  }
  return diagnostics.length > 0 ? { diagnostics } : { selected };
}

function failed(
  projectRoot: string,
  resourceWatch: ResourceWatchContext | undefined,
  diagnostics: Diagnostic[],
): BuildResult {
  return {
    projectRoot,
    ...(resourceWatch ? { resourceWatch } : {}),
    diagnostics,
    materializations: [],
  };
}

/** Prepares and materializes the complete project through selected hosts. */
export function buildProject(
  target: string,
  context: ProjectContext = {},
  dependencies: BuildDependencies = {},
): BuildResult {
  const loaded = loadProject(target, context);
  const projectRoot = loaded.projectRoot ?? resolve(target);

  const prepared =
    loaded.resources && !hasErrors(loaded.diagnostics)
      ? prepareResolvedDocument(loaded.resources, loaded.diagnostics)
      : { agents: [], skills: [], diagnostics: loaded.diagnostics };
  if (hasErrors(prepared.diagnostics)) {
    return failed(projectRoot, loaded.resourceWatch, prepared.diagnostics);
  }

  assertRealProjectRoot(projectRoot);

  const hosts = loaded.document?.hosts ?? ["opencode"];
  const selection = hostSelection(hosts, dependencies);
  if ("diagnostics" in selection)
    return failed(projectRoot, loaded.resourceWatch, selection.diagnostics);

  const diagnostics: Diagnostic[] = [];
  const materializations: MaterializationSummary[] = [];
  for (const materializer of selection.selected) {
    const outcome = materializer.materialize(projectRoot, prepared);
    diagnostics.push(...outcome.diagnostics);
    materializations.push({
      host: materializer.host,
      writtenPaths: outcome.writtenPaths,
      removedPaths: outcome.removedPaths,
    });
  }

  return {
    projectRoot,
    ...(loaded.resourceWatch ? { resourceWatch: loaded.resourceWatch } : {}),
    diagnostics,
    materializations,
  };
}
