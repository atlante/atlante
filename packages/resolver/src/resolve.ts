import type { AtlanteDocument } from "@atlante/schema";
import type { TemplateRegistry } from "@atlante/templates";
import {
  interpolateValues,
  MissingValueError,
  renderTemplate,
  resolveSystemValues,
} from "@atlante/templates";
import type { Diagnostic } from "@atlante/validator";
import {
  error,
  escapeJsonPointerSegment,
  hasErrors,
  promptInputOf,
  validateTemplates,
} from "@atlante/validator";
import { mergeValues } from "./values.ts";

export const DEFAULT_TEMPLATE_ID = "atlante/agent";

export type AgentArtifact = {
  hostAgentId: string;
  templateId: string;
  prompt: string;
};

export type ResolvedHarness = {
  agents: AgentArtifact[];
  diagnostics: Diagnostic[];
};

/**
 * SPECIFICATION.md §9: validate, resolve values, load templates, render, emit
 * one descriptor per binding. Artifacts follow ECMAScript property-enumeration
 * order, which is stable across parses of the same input.
 */
export function resolve(
  document: AtlanteDocument,
  registry: TemplateRegistry,
): ResolvedHarness {
  const diagnostics = validateTemplates(
    document,
    registry,
    DEFAULT_TEMPLATE_ID,
  );
  if (hasErrors(diagnostics)) return { agents: [], diagnostics };

  const agents: AgentArtifact[] = [];

  for (const [hostAgentId, binding] of Object.entries(document.agents)) {
    const templateId = binding.promptTemplate ?? DEFAULT_TEMPLATE_ID;
    try {
      const values = mergeValues(document.values, binding.values);
      const resolvedValues = resolveSystemValues(values);
      // §6.4 and §7: resolve every {{values.x}} reference before rendering.
      const input = interpolateValues(promptInputOf(binding), resolvedValues);

      agents.push({
        hostAgentId,
        templateId,
        prompt: renderTemplate({ registry, templateId, input }),
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      const code =
        cause instanceof MissingValueError
          ? "missing-value"
          : "template-render-failed";
      return {
        agents: [],
        diagnostics: [
          ...diagnostics,
          error(
            code,
            `agent "${hostAgentId}" template "${templateId}": ${message}`,
            { path: `/agents/${escapeJsonPointerSegment(hostAgentId)}` },
          ),
        ],
      };
    }
  }

  return { agents, diagnostics };
}
