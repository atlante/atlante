import type { AtlanteDocument, ValuesMap } from "@atlante/schema";
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
import { mergeValues } from "./values.js";

export const DEFAULT_TEMPLATE_ID = "atlante/agent";
export const DEFAULT_SKILL_TEMPLATE_ID = "atlante/skill";

const SKILL_BINDING_KEYS = new Set(["description", "template", "values"]);

export type AgentArtifact = {
  hostAgentId: string;
  templateId: string;
  prompt: string;
};

export type SkillArtifact = {
  skillId: string;
  description: string;
  templateId: string;
  content: string;
};

export type ResolvedHarness = {
  agents: AgentArtifact[];
  skills: SkillArtifact[];
  diagnostics: Diagnostic[];
};

type PreparedBinding = {
  input: Record<string, unknown>;
  description?: string;
};

function renderBinding(
  registry: TemplateRegistry,
  documentValues: ValuesMap | undefined,
  binding: Record<string, unknown>,
  templateId: string,
  prepare: (values: Record<string, unknown>) => PreparedBinding,
): PreparedBinding & { content: string } {
  const values = resolveSystemValues(
    mergeValues(documentValues, binding.values as ValuesMap | undefined),
  );
  const prepared = prepare(values);
  return {
    ...prepared,
    content: renderTemplate({ registry, templateId, input: prepared.input }),
  };
}

function renderDiagnostic(
  subject: "agent" | "skill",
  bindingId: string,
  templateId: string,
  cause: unknown,
  path: string,
): Diagnostic {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code =
    cause instanceof MissingValueError
      ? "missing-value"
      : "template-render-failed";
  return error(
    code,
    `${subject} "${bindingId}" template "${templateId}": ${message}`,
    { path },
  );
}

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
  if (hasErrors(diagnostics)) return { agents: [], skills: [], diagnostics };

  const agents: AgentArtifact[] = [];

  for (const [hostAgentId, binding] of Object.entries(document.agents ?? {})) {
    const templateId = binding.template ?? DEFAULT_TEMPLATE_ID;
    try {
      const rendered = renderBinding(
        registry,
        document.values,
        binding,
        templateId,
        (values) => ({
          // §6.4 and §7: resolve every {{values.x}} reference before rendering.
          input: interpolateValues(promptInputOf(binding), values),
        }),
      );

      agents.push({
        hostAgentId,
        templateId,
        prompt: rendered.content,
      });
    } catch (cause) {
      return {
        agents: [],
        skills: [],
        diagnostics: [
          ...diagnostics,
          renderDiagnostic(
            "agent",
            hostAgentId,
            templateId,
            cause,
            `/agents/${escapeJsonPointerSegment(hostAgentId)}`,
          ),
        ],
      };
    }
  }

  const skills: SkillArtifact[] = [];

  for (const [skillId, binding] of Object.entries(document.skills ?? {})) {
    const templateId = binding.template ?? DEFAULT_SKILL_TEMPLATE_ID;
    try {
      const rendered = renderBinding(
        registry,
        document.values,
        binding,
        templateId,
        (values) => {
          const description = interpolateValues(binding.description, values);
          const input = interpolateValues(
            promptInputOf(binding, SKILL_BINDING_KEYS),
            values,
          );
          if (typeof description !== "string" || description.length === 0) {
            throw new Error("skill description must be a non-empty string");
          }
          return { description, input };
        },
      );

      skills.push({
        skillId,
        description: rendered.description as string,
        templateId,
        content: rendered.content,
      });
    } catch (cause) {
      return {
        agents: [],
        skills: [],
        diagnostics: [
          ...diagnostics,
          renderDiagnostic(
            "skill",
            skillId,
            templateId,
            cause,
            `/skills/${escapeJsonPointerSegment(skillId)}`,
          ),
        ],
      };
    }
  }

  return { agents, skills, diagnostics };
}
