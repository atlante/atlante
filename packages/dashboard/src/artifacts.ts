import { ArtifactReadError, readArtifacts } from "@atlante/builder/artifacts";
import {
  type AgentNode,
  DASHBOARD_BOUNDS,
  dashboardId,
  type SkillNode,
} from "./model.js";

export type ArtifactProjection = {
  status: "available" | "missing" | "invalid";
  agents: AgentNode[];
  skills: SkillNode[];
  links: {
    configuration: "atlante.jsonc";
    artifacts: ".atlante/artifacts/";
  };
};

const links = {
  configuration: "atlante.jsonc",
  artifacts: ".atlante/artifacts/",
} as const;

function empty(status: ArtifactProjection["status"]): ArtifactProjection {
  return { status, agents: [], skills: [], links };
}

function safeMetadata(value: string): string {
  return value.slice(0, DASHBOARD_BOUNDS.maxSafeMessageLength);
}

export function projectArtifacts(projectRoot: string): ArtifactProjection {
  let artifacts: ReturnType<typeof readArtifacts>;
  try {
    artifacts = readArtifacts(projectRoot);
  } catch (error) {
    if (error instanceof ArtifactReadError) return empty("invalid");
    return empty("invalid");
  }

  if (!artifacts) return empty("missing");

  // Only copy manifest metadata. Prompt and skill content are intentionally
  // not read into the dashboard-owned projection.
  return {
    status: "available",
    agents: artifacts.agents
      .slice(0, DASHBOARD_BOUNDS.maxAgents)
      .map((agent) => ({
        kind: "agent",
        id: dashboardId("agent", agent.hostAgentId),
        sourceIdentity: agent.hostAgentId,
        label: safeMetadata(agent.hostAgentId),
        description: safeMetadata(agent.description),
        status: "configured",
        evidence: "artifact-manifest",
        relatedIds: [],
      })),
    skills: artifacts.skills
      .slice(0, DASHBOARD_BOUNDS.maxSkills)
      .map((skill) => ({
        kind: "skill",
        id: dashboardId("skill", skill.skillId),
        label: safeMetadata(skill.skillId),
        description: safeMetadata(skill.description),
        status: "configured",
        evidence: "artifact-manifest",
        relatedIds: [],
      })),
    links,
  };
}
