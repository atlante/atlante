import type { VerifiedAgentArtifact } from "@atlante/builder/artifacts";

export type InjectionWarning = {
  severity: "warning";
  code: string;
  message: string;
};

export type HostAgentConfig = {
  prompt?: string;
  description?: string;
} & Record<string, unknown>;
export type HostConfig = {
  agent?: Record<string, HostAgentConfig>;
} & Record<string, unknown>;

/**
 * Writes Atlante-owned `prompt` and `description`. Spreading the existing entry covers both cases in one
 * expression: a missing agent is created with OpenCode defaults, and an
 * existing one keeps its host-owned model, mode, permission and tool settings
 * (SPECIFICATION.md §7).
 */
export function injectAgents(
  config: HostConfig,
  artifacts: readonly VerifiedAgentArtifact[],
): InjectionWarning[] {
  const diagnostics: InjectionWarning[] = [];
  const ownAgent = Object.hasOwn(config, "agent") ? config.agent : undefined;
  const agents =
    ownAgent && typeof ownAgent === "object"
      ? ownAgent
      : ({} as Record<string, HostAgentConfig>);

  if (agents !== ownAgent) {
    Object.defineProperty(config, "agent", {
      configurable: true,
      enumerable: true,
      value: agents,
      writable: true,
    });
  }

  for (const artifact of artifacts) {
    const existing = Object.hasOwn(agents, artifact.hostAgentId)
      ? agents[artifact.hostAgentId]
      : undefined;

    if (existing?.prompt) {
      diagnostics.push({
        severity: "warning",
        code: "prompt-replaced",
        message: `replaced the existing prompt of host agent "${artifact.hostAgentId}"`,
      });
    }

    const replacement = {
      ...existing,
      prompt: artifact.prompt,
      description: artifact.description,
    };
    Object.defineProperty(agents, artifact.hostAgentId, {
      configurable: true,
      enumerable: true,
      value: replacement,
      writable: true,
    });
  }

  return diagnostics;
}
