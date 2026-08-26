import {
  interpolateValues,
  MissingValueError,
  type ResolvedResourceBinding,
  type ResolvedResourceDocument,
  renderResolvedTemplate,
  resolveSystemValues,
  resourceValueTombstones,
} from "@atlante/resources";
import type { ValuesMap } from "@atlante/schema";
import type { Diagnostic } from "@atlante/validator";
import { error, escapeJsonPointerSegment, hasErrors } from "@atlante/validator";
import type {
  AgentArtifact,
  PreparedProject,
  SkillArtifact,
} from "./prepare.js";
import { mergeValues } from "./values.js";

function failedPreparation(diagnostics: Diagnostic[]): PreparedProject {
  return { agents: [], skills: [], diagnostics };
}

function renderDiagnostic(
  subject: "agent" | "skill",
  binding: ResolvedResourceBinding,
  cause: unknown,
): Diagnostic {
  const message = cause instanceof Error ? cause.message : String(cause);
  const code =
    cause instanceof MissingValueError
      ? "missing-value"
      : "template-render-failed";
  return error(
    code,
    `${subject} "${binding.id}" template "${String(binding.template.locator)}": ${message}`,
    {
      path: `/${subject === "agent" ? "agents" : "skills"}/${escapeJsonPointerSegment(binding.id)}`,
    },
  );
}

function renderBinding(
  resources: ResolvedResourceDocument,
  binding: ResolvedResourceBinding,
  subject: "agent" | "skill",
): { description: string; content: string } {
  const values = resolveSystemValues(
    mergeValues(
      resources.document.values as ValuesMap | undefined,
      binding.values as ValuesMap | undefined,
      resourceValueTombstones(binding.values),
    ),
  );
  const description = interpolateValues(binding.description, values);
  if (typeof description !== "string" || description.length === 0)
    throw new Error(`${subject} description must be a non-empty string`);
  const input = interpolateValues(binding.input, values);
  return {
    description,
    content: renderResolvedTemplate({ template: binding.template, input }),
  };
}

/** Prepares the exact context that validator loading already resolved. */
export function prepareResolvedDocument(
  resources: ResolvedResourceDocument,
  initialDiagnostics: Diagnostic[] = [],
): PreparedProject {
  if (hasErrors(initialDiagnostics))
    return failedPreparation(initialDiagnostics);

  const agents: AgentArtifact[] = [];
  for (const binding of Object.values(resources.bindings.agents ?? {})) {
    try {
      const rendered = renderBinding(resources, binding, "agent");
      agents.push({
        hostAgentId: binding.id,
        templateId: String(binding.template.locator),
        description: rendered.description,
        prompt: rendered.content,
      });
    } catch (cause) {
      return failedPreparation([
        ...initialDiagnostics,
        renderDiagnostic("agent", binding, cause),
      ]);
    }
  }

  const skills: SkillArtifact[] = [];
  for (const binding of Object.values(resources.bindings.skills ?? {})) {
    try {
      const rendered = renderBinding(resources, binding, "skill");
      skills.push({
        skillId: binding.id,
        templateId: String(binding.template.locator),
        description: rendered.description,
        content: rendered.content,
      });
    } catch (cause) {
      return failedPreparation([
        ...initialDiagnostics,
        renderDiagnostic("skill", binding, cause),
      ]);
    }
  }

  return { agents, skills, diagnostics: initialDiagnostics };
}
