import {
  type LoadedProject,
  loadProject,
  type ProjectContext,
} from "./project.js";

export type {
  BuildDependencies,
  BuildResult,
  MaterializationSummary,
} from "./build.js";
export { assertRealProjectRoot, buildProject } from "./build.js";
export type {
  HostMaterializer,
  MaterializationOutcome,
} from "./materializer.js";
export type {
  AgentArtifact,
  PreparedProject,
  SkillArtifact,
} from "./prepare.js";
export { prepareProject } from "./prepare.js";
export type {
  LoadedProject,
  ProjectContext,
} from "./project.js";
export { loadProject } from "./project.js";
export { prepareResolvedDocument } from "./resource-prepare.js";
export { mergeValues } from "./values.js";

export function validateProject(
  target: string,
  context: ProjectContext = {},
): LoadedProject {
  return loadProject(target, context);
}
