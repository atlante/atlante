import { lstatSync } from "node:fs";
import { resolve } from "node:path";
import {
  type ArtifactPublicationWarning,
  createArtifacts,
  type PublishDependencies,
  publishArtifacts,
} from "@atlante/artifacts";
import type { Diagnostic, ResourceWatchContext } from "@atlante/validator";
import { hasErrors } from "@atlante/validator";
import { loadProject, type ProjectContext } from "./project.js";
import { prepareResolvedDocument } from "./resource-prepare.js";

export type BuildDependencies = PublishDependencies;

export function assertRealProjectRoot(projectRoot: string): void {
  const stats = lstatSync(projectRoot);
  if (stats.isSymbolicLink()) {
    throw new Error(`project root must not be a symlink: ${projectRoot}`);
  }
  if (!stats.isDirectory()) {
    throw new Error(`project root must be a directory: ${projectRoot}`);
  }
}

export type BuildResult = {
  projectRoot: string;
  artifactsPath: string;
  resourceWatch?: ResourceWatchContext;
  diagnostics: Diagnostic[];
  warnings: ArtifactPublicationWarning[];
};

/**
 * Prepare the complete project in memory, then publish one complete artifact
 * replacement. This is deliberately the only caller of the publisher.
 */
export function buildProject(
  target: string,
  context: ProjectContext = {},
  dependencies: BuildDependencies = {},
): BuildResult {
  const loaded = loadProject(target, context);
  const projectRoot = loaded.projectRoot ?? resolve(target);
  const artifactsPath = resolve(projectRoot, ".atlante", "artifacts");

  const prepared =
    loaded.resources && !hasErrors(loaded.diagnostics)
      ? prepareResolvedDocument(loaded.resources, loaded.diagnostics)
      : { agents: [], skills: [], diagnostics: loaded.diagnostics };
  if (hasErrors(prepared.diagnostics)) {
    return {
      projectRoot,
      artifactsPath,
      resourceWatch: loaded.resourceWatch,
      diagnostics: prepared.diagnostics,
      warnings: [],
    };
  }

  assertRealProjectRoot(projectRoot);
  const created = createArtifacts({
    agents: prepared.agents,
    skills: prepared.skills,
  });
  const published = publishArtifacts(projectRoot, created, dependencies);
  return {
    projectRoot,
    artifactsPath: published.artifactsPath,
    resourceWatch: loaded.resourceWatch,
    diagnostics: prepared.diagnostics,
    warnings: published.warnings,
  };
}
