import {
  interpolateValues,
  loadBundledTemplateMigrationRegistry,
  MissingValueError,
  renderTemplate,
  resolveSystemValues,
} from "@atlante/resources";
import type { AtlanteDocument, ValuesMap } from "@atlante/schema";
import type { Diagnostic } from "@atlante/validator";
import {
  error,
  escapeJsonPointerSegment,
  hasErrors,
  promptInputOf,
  templateLoadDiagnostics,
  validateTemplates,
} from "@atlante/validator";
import { loadProject, type ProjectContext } from "./project.js";
import { prepareResolvedDocument } from "./resource-prepare.js";
import {
  type DirectTemplateRegistry,
  toResourceTemplateRegistry,
} from "./template-compat.js";
import { mergeValues } from "./values.js";

const DEFAULT_TEMPLATE_ID = "atlante/agent";
const DEFAULT_SKILL_TEMPLATE_ID = "atlante/skill";

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
  agents: AgentArtifact[];
  skills: SkillArtifact[];
  diagnostics: Diagnostic[];
};

function isTemplateRegistry(value: unknown): value is DirectTemplateRegistry {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DirectTemplateRegistry).get === "function" &&
    typeof (value as DirectTemplateRegistry).ids === "function"
  );
}

function failedPreparation(diagnostics: Diagnostic[]): PreparedProject {
  return { agents: [], skills: [], diagnostics };
}

type PreparedBinding = {
  input: Record<string, unknown>;
  description: string;
};

function interpolateBindingDescription(
  binding: Record<string, unknown>,
  values: Record<string, unknown>,
  subject: "agent" | "skill",
): string {
  const description = interpolateValues(binding.description, values);
  if (typeof description !== "string" || description.length === 0)
    throw new Error(`${subject} description must be a non-empty string`);
  return description;
}

function renderBinding(
  registry: DirectTemplateRegistry,
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
    content: renderTemplate({
      registry: toResourceTemplateRegistry(registry),
      templateId,
      input: prepared.input,
    }),
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
 * Validate, resolve, and render one canonical document. Preparation is
 * globally fail-closed: a failure in any binding discards every descriptor.
 */
function prepareDocument(
  document: AtlanteDocument,
  registry: DirectTemplateRegistry,
  initialDiagnostics: Diagnostic[] = [],
): PreparedProject {
  const diagnostics = [
    ...initialDiagnostics,
    ...validateTemplates(document, registry, DEFAULT_TEMPLATE_ID),
  ];
  if (hasErrors(diagnostics)) return { agents: [], skills: [], diagnostics };

  const agents: AgentArtifact[] = [];

  for (const [hostAgentId, binding] of Object.entries(document.agents ?? {})) {
    // Direct preparation keeps value interpolation before template rendering.
    const templateId = DEFAULT_TEMPLATE_ID;
    try {
      const rendered = renderBinding(
        registry,
        document.values,
        binding,
        templateId,
        (values) => ({
          // §6.4 and §7: resolve every {{values.x}} reference before rendering.
          input: interpolateValues(promptInputOf(binding), values),
          description: interpolateBindingDescription(binding, values, "agent"),
        }),
      );

      agents.push({
        hostAgentId,
        templateId,
        description: rendered.description,
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
    // Direct preparation keeps value interpolation before template rendering.
    const templateId = DEFAULT_SKILL_TEMPLATE_ID;
    try {
      const rendered = renderBinding(
        registry,
        document.values,
        binding,
        templateId,
        (values) => {
          const input = interpolateValues(promptInputOf(binding), values);
          return {
            description: interpolateBindingDescription(
              binding,
              values,
              "skill",
            ),
            input,
          };
        },
      );

      skills.push({
        skillId,
        description: rendered.description,
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

export function prepareProject(
  target: string | AtlanteDocument,
  context?: ProjectContext | DirectTemplateRegistry,
): PreparedProject {
  if (typeof target !== "string") {
    const loaded = isTemplateRegistry(context)
      ? { registry: context, errors: [] }
      : loadBundledTemplateMigrationRegistry();
    if (loaded.errors.length > 0) {
      return failedPreparation(templateLoadDiagnostics(loaded.errors));
    }
    return prepareDocument(target, loaded.registry);
  }

  const projectContext: ProjectContext | undefined = isTemplateRegistry(context)
    ? undefined
    : (context as ProjectContext | undefined);
  const loaded = loadProject(target, projectContext);
  if (!loaded.resources || hasErrors(loaded.diagnostics)) {
    return failedPreparation(loaded.diagnostics);
  }
  return prepareResolvedDocument(loaded.resources, loaded.diagnostics);
}
