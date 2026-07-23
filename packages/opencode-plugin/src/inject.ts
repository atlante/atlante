import type { AgentArtifact } from "@atlante/resolver";
import type { Diagnostic } from "@atlante/validator";
import { warning } from "@atlante/validator";

export type HostAgentConfig = { prompt?: string } & Record<string, unknown>;
export type HostConfig = {
  agent?: Record<string, HostAgentConfig>;
} & Record<string, unknown>;

/**
 * Writes only `prompt`. Spreading the existing entry covers both cases in one
 * expression: a missing agent is created with OpenCode defaults, and an
 * existing one keeps its host-owned model, mode, permission and tool settings
 * (SPECIFICATION.md §7).
 */
export function injectAgents(
  config: HostConfig,
  artifacts: AgentArtifact[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  config.agent ??= {};
  const agents = config.agent;

  for (const artifact of artifacts) {
    const existing = Object.hasOwn(agents, artifact.hostAgentId)
      ? agents[artifact.hostAgentId]
      : undefined;

    if (existing?.prompt) {
      diagnostics.push(
        warning(
          "prompt-replaced",
          `replaced the existing prompt of host agent "${artifact.hostAgentId}"`,
        ),
      );
    }

    const replacement = { ...existing, prompt: artifact.prompt };
    Object.defineProperty(agents, artifact.hostAgentId, {
      configurable: true,
      enumerable: true,
      value: replacement,
      writable: true,
    });
  }

  return diagnostics;
}
