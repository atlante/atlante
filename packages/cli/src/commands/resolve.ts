import {
  type AgentArtifact,
  resolve as resolveHarness,
  type SkillArtifact,
} from "@atlante/resolver";
import { type Diagnostic, error, hasErrors } from "@atlante/validator";
import { printDiagnostics } from "../report.js";
import { loadCliResources } from "./load.js";

export type ResolveOptions = { agent?: string; json?: boolean };

function jsonEnvelope(
  agents: AgentArtifact[],
  skills: SkillArtifact[],
  diagnostics: Diagnostic[],
): string {
  return JSON.stringify({ agents, skills, diagnostics }, null, 2);
}

function reportFailure(
  options: ResolveOptions,
  diagnostics: Diagnostic[],
): number {
  if (options.json) {
    console.log(jsonEnvelope([], [], diagnostics));
  } else {
    printDiagnostics(diagnostics);
  }
  return 1;
}

export async function runResolve(
  target: string,
  options: ResolveOptions,
): Promise<number> {
  const loaded = loadCliResources(target);
  if (!loaded.document || !loaded.registry) {
    return reportFailure(options, loaded.diagnostics);
  }
  if (hasErrors(loaded.diagnostics)) {
    return reportFailure(options, loaded.diagnostics);
  }

  const resolved = resolveHarness(loaded.document, loaded.registry);
  const diagnostics = [...loaded.diagnostics, ...resolved.diagnostics];
  if (hasErrors(diagnostics)) return reportFailure(options, diagnostics);

  const hasSelectedAgent = options.agent !== undefined;
  const selected = hasSelectedAgent
    ? resolved.agents.filter((a) => a.hostAgentId === options.agent)
    : resolved.agents;

  if (selected.length === 0 && hasSelectedAgent) {
    return reportFailure(options, [
      ...diagnostics,
      error("agent-not-found", `no agent named "${options.agent}"`),
    ]);
  }

  if (options.json) {
    console.log(jsonEnvelope(selected, resolved.skills, diagnostics));
    return 0;
  }

  printDiagnostics(diagnostics);
  for (const artifact of selected) {
    console.log(`--- ${artifact.hostAgentId} (${artifact.templateId}) ---`);
    console.log(artifact.prompt);
  }
  if (resolved.skills.length > 0) {
    console.log("--- Skills ---");
    for (const skill of resolved.skills) {
      console.log(`--- ${skill.skillId} (${skill.templateId}) ---`);
      console.log(`Description: ${skill.description}`);
      console.log(skill.content);
    }
  }
  return 0;
}
