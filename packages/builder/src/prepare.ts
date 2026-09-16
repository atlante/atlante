import type { OutputOptions } from "@atlante/schema";
import type { Diagnostic } from "@atlante/validator";
import { hasErrors } from "@atlante/validator";
import { defaultOutputOptions } from "./output-options.js";
import { loadProject, type ProjectContext } from "./project.js";
import { prepareResolvedDocument } from "./resource-prepare.js";

export type AgentArtifact = {
  hostAgentId: string;
  templateId: string;
  description: string;
  prompt: string;
};

export type SkillArtifact = {
  skillId: string;
  description: string;
  templateId: string;
  content: string;
};

export type PreparedProject = {
  options: OutputOptions;
  agents: AgentArtifact[];
  skills: SkillArtifact[];
  diagnostics: Diagnostic[];
};

function failedPreparation(diagnostics: Diagnostic[]): PreparedProject {
  return {
    options: defaultOutputOptions(),
    agents: [],
    skills: [],
    diagnostics,
  };
}

/** Prepares the exact resource context already returned by project loading. */
export function prepareProject(
  target: string,
  context: ProjectContext = {},
): PreparedProject {
  const loaded = loadProject(target, context);
  if (!loaded.resources || hasErrors(loaded.diagnostics))
    return failedPreparation(loaded.diagnostics);
  return prepareResolvedDocument(loaded.resources, loaded.diagnostics);
}
