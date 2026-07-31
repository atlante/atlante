import { hasErrors, validateTemplates } from "@atlante/validator";
import { DEFAULT_TEMPLATE_ID } from "./prepare.js";
import {
  type LoadedProject,
  loadProject,
  type ProjectContext,
} from "./project.js";

export type {
  BuildDependencies,
  BuildResult,
} from "./build.js";
export { assertRealProjectRoot, buildProject } from "./build.js";
export type {
  AgentArtifact,
  PreparedProject,
  SkillArtifact,
} from "./prepare.js";
export { prepareProject } from "./prepare.js";
export type {
  LoadedProject,
  ProjectContext,
  TemplateLoader,
} from "./project.js";
export { loadProject } from "./project.js";
export type { PublishOperation } from "./publish.js";
export { mergeValues } from "./values.js";

export function validateProject(
  target: string,
  context: ProjectContext = {},
): LoadedProject {
  const loaded = loadProject(target, context);
  if (!loaded.document || !loaded.registry || hasErrors(loaded.diagnostics)) {
    return loaded;
  }

  return {
    ...loaded,
    diagnostics: [
      ...loaded.diagnostics,
      ...validateTemplates(
        loaded.document,
        loaded.registry,
        DEFAULT_TEMPLATE_ID,
      ),
    ],
  };
}
