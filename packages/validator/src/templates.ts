import type { AtlanteDocument } from "@atlante/schema";
import type { TemplateRegistry } from "@atlante/templates";
import {
  interpolateValues,
  isValidValueKey,
  resolveSystemValues,
  slotsOf,
  UnknownSystemVariableError,
  ValueReferenceCollisionError,
  walkComposition,
  walkValueReferences,
} from "@atlante/templates";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Diagnostic } from "./diagnostic.js";
import { error, escapeJsonPointerSegment } from "./diagnostic.js";

/** Binding metadata, not template input (SPECIFICATION.md §4.3). */
const BINDING_KEYS = new Set(["template", "values"]);
const SKILL_BINDING_KEYS = new Set(["description", "template", "values"]);
const DEFAULT_SKILL_TEMPLATE_ID = "atlante/skill";

function unescapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

/**
 * Expands every slot reference into the referenced template's inputSchema,
 * producing one complete JSON Schema. Recursion happens through template ids,
 * so cycles are caught by the composition walk rather than by schema nesting.
 */
export function expandInputSchema(
  registry: TemplateRegistry,
  templateId: string,
  stack: string[] = [],
): { schema?: Record<string, unknown>; diagnostics: Diagnostic[] } {
  if (stack.includes(templateId)) {
    const chain = [...stack, templateId];
    return {
      diagnostics: [
        error(
          "cyclic-template",
          `circular template composition: ${chain.join(" -> ")}`,
        ),
      ],
    };
  }

  if (stack.length === 0) {
    const issues = walkComposition(registry, templateId);
    if (issues.length > 0) {
      return {
        diagnostics: issues.map((issue) =>
          error(issue.code, issue.message, {
            path: issue.slotPath?.length
              ? `/${issue.slotPath.map(escapeJsonPointerSegment).join("/")}`
              : undefined,
          }),
        ),
      };
    }
  }

  const template = registry.get(templateId);
  if (!template) {
    return {
      diagnostics: [
        error("unknown-template", `template "${templateId}" does not exist`),
      ],
    };
  }

  const schema = structuredClone(template.inputSchema);
  const properties = schema.properties as Record<string, unknown> | undefined;

  for (const slot of slotsOf(template.inputSchema)) {
    const expanded = expandInputSchema(registry, slot.templateId, [
      ...stack,
      templateId,
    ]);
    if (!expanded.schema) return expanded;
    if (properties) properties[slot.property] = expanded.schema;
  }

  // The dialect key is only meaningful on the root document.
  if (stack.length > 0) delete schema.$schema;

  return { schema, diagnostics: [] };
}

function bindingPath(
  root: "agents" | "skills",
  bindingId: string,
  segments: (string | number)[] = [],
): string {
  return `/${root}/${escapeJsonPointerSegment(bindingId)}${segments
    .map((segment) => `/${escapeJsonPointerSegment(String(segment))}`)
    .join("")}`;
}

function validateBindingInput(
  registry: TemplateRegistry,
  templateId: string,
  input: Record<string, unknown>,
  bindingId: string,
  root: "agents" | "skills",
  subject: "agent" | "skill",
): Diagnostic[] {
  const { schema, diagnostics } = expandInputSchema(registry, templateId);
  if (!schema) {
    return diagnostics.map((diagnostic) => {
      const slotPath = diagnostic.path ?? "";
      const path = bindingPath(root, bindingId) + slotPath;
      const slot = slotPath
        ? ` at slot "${slotPath
            .slice(1)
            .split("/")
            .map(unescapeJsonPointerSegment)
            .join(".")}"`
        : "";
      return {
        ...diagnostic,
        message: `${subject} "${bindingId}"${slot}: ${diagnostic.message}`,
        path,
      };
    });
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false });
  let validate: ReturnType<typeof ajv.compile>;
  try {
    validate = ajv.compile(schema);
  } catch {
    // A structurally invalid inputSchema (SPECIFICATION.md §8.2) must be
    // rejected as a diagnostic, not surfaced as Ajv's uncaught compile error.
    return [
      error(
        "invalid-input-schema",
        `${subject} "${bindingId}" template "${templateId}": inputSchema is invalid; expected a valid JSON Schema Draft 2020-12 object`,
        { path: bindingPath(root, bindingId) },
      ),
    ];
  }
  if (validate(input)) return [];

  return (validate.errors ?? []).map((issue) =>
    error(
      "invalid-prompt-input",
      `${subject} "${bindingId}": ${issue.instancePath || "<root>"} ${issue.message ?? "is invalid"}${
        issue.params && "additionalProperty" in issue.params
          ? ` (${String(issue.params.additionalProperty)})`
          : ""
      }${
        issue.params && "missingProperty" in issue.params
          ? ` (${String(issue.params.missingProperty)})`
          : ""
      }`,
      {
        path: `${bindingPath(root, bindingId)}${issue.instancePath}`,
      },
    ),
  );
}

export function validateAgentInput(
  registry: TemplateRegistry,
  templateId: string,
  input: Record<string, unknown>,
  agentId: string,
): Diagnostic[] {
  return validateBindingInput(
    registry,
    templateId,
    input,
    agentId,
    "agents",
    "agent",
  );
}

export function validateSkillInput(
  registry: TemplateRegistry,
  templateId: string,
  input: Record<string, unknown>,
  skillId: string,
): Diagnostic[] {
  return validateBindingInput(
    registry,
    templateId,
    input,
    skillId,
    "skills",
    "skill",
  );
}

function resolvedValue(values: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}

function missingValueDiagnostics(
  input: unknown,
  values: Record<string, unknown>,
  bindingId: string,
  templateId: string,
  root: "agents" | "skills",
  subject: "agent" | "skill",
  pathPrefix: (string | number)[] = [],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walkValueReferences(input, (reference, segments) => {
    const path = bindingPath(root, bindingId, [...pathPrefix, ...segments]);
    if (!reference.key || !isValidValueKey(reference.key)) {
      diagnostics.push(
        error(
          "invalid-value-reference",
          `${subject} "${bindingId}" template "${templateId}": invalid values reference "{{${reference.expression}}}"; value names must match [A-Za-z_$][A-Za-z0-9_$-]*`,
          { path },
        ),
      );
    } else if (resolvedValue(values, reference.key) == null) {
      diagnostics.push(
        error(
          "missing-value",
          `${subject} "${bindingId}" template "${templateId}": missing required value "{{values.${reference.key}}}"`,
          { path },
        ),
      );
    }
  });
  return diagnostics;
}

export function promptInputOf(
  binding: Record<string, unknown>,
  reservedKeys: ReadonlySet<string> = BINDING_KEYS,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(binding).filter(([key]) => !reservedKeys.has(key)),
  );
}

function validateAgentBinding(
  document: AtlanteDocument,
  registry: TemplateRegistry,
  defaultTemplateId: string,
  agentId: string,
  binding: AtlanteDocument["agents"][string],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const templateId = binding.template ?? defaultTemplateId;
  const input = promptInputOf(binding);
  let values: Record<string, unknown>;
  try {
    values = resolveSystemValues({
      ...(document.values ?? {}),
      ...(binding.values ?? {}),
    });
  } catch (cause) {
    if (cause instanceof UnknownSystemVariableError) {
      diagnostics.push(
        error(
          "unknown-system-variable",
          `agent "${agentId}" template "${templateId}": ${cause.message}`,
          {
            path: bindingPath("agents", agentId),
          },
        ),
      );
      return diagnostics;
    }
    throw cause;
  }
  const valueDiagnostics = missingValueDiagnostics(
    input,
    values,
    agentId,
    templateId,
    "agents",
    "agent",
  );
  if (valueDiagnostics.length > 0) {
    // Keep template/composition failures, but do not report schema failures
    // against raw `{{values.x}}` placeholders when a value is missing.
    diagnostics.push(
      ...validateAgentInput(registry, templateId, input, agentId).filter(
        (diagnostic) => diagnostic.code !== "invalid-prompt-input",
      ),
      ...valueDiagnostics,
    );
    return diagnostics;
  }

  // Template schemas must see the same values the renderer will see. A
  // hand-built document with a non-string value is left for the resolver's
  // defence-in-depth render diagnostic instead of making validation throw.
  let inputForValidation = input;
  try {
    inputForValidation = interpolateValues(input, values);
  } catch (cause) {
    if (cause instanceof ValueReferenceCollisionError) {
      diagnostics.push(
        error(
          "value-reference-collision",
          `agent "${agentId}" template "${templateId}": ${cause.message}`,
          {
            path: bindingPath("agents", agentId, cause.path),
          },
        ),
      );
      return diagnostics;
    }
    // The document schema rejects non-string values before normal resolution.
  }
  diagnostics.push(
    ...validateAgentInput(registry, templateId, inputForValidation, agentId),
  );
  return diagnostics;
}

function emptySkillDescriptionDiagnostics(
  description: unknown,
  descriptionValueDiagnostics: Diagnostic[],
  values: Record<string, unknown>,
  skillId: string,
  templateId: string,
): Diagnostic[] {
  if (typeof description !== "string" || descriptionValueDiagnostics.length > 0)
    return [];

  let interpolatedDescription = description;
  try {
    interpolatedDescription = interpolateValues(description, values);
  } catch {
    return [];
  }
  if (interpolatedDescription.length !== 0) return [];

  return [
    error(
      "invalid-skill-description",
      `skill "${skillId}" template "${templateId}": description must be a non-empty string`,
      { path: bindingPath("skills", skillId, ["description"]) },
    ),
  ];
}

function interpolatedSkillInput(
  input: Record<string, unknown>,
  values: Record<string, unknown>,
  skillId: string,
  templateId: string,
): { input: Record<string, unknown>; diagnostic?: Diagnostic } {
  try {
    return { input: interpolateValues(input, values) };
  } catch (cause) {
    if (cause instanceof ValueReferenceCollisionError) {
      return {
        input,
        diagnostic: error(
          "value-reference-collision",
          `skill "${skillId}" template "${templateId}": ${cause.message}`,
          { path: bindingPath("skills", skillId, cause.path) },
        ),
      };
    }
    return { input };
  }
}

function skillValues(
  document: AtlanteDocument,
  rawBinding: Record<string, unknown>,
  skillId: string,
  templateId: string,
): { values: Record<string, unknown>; diagnostic?: Diagnostic } {
  try {
    return {
      values: resolveSystemValues({
        ...(document.values ?? {}),
        ...((rawBinding.values as Record<string, unknown> | undefined) ?? {}),
      }),
    };
  } catch (cause) {
    if (cause instanceof UnknownSystemVariableError) {
      return {
        values: {},
        diagnostic: error(
          "unknown-system-variable",
          `skill "${skillId}" template "${templateId}": ${cause.message}`,
          { path: bindingPath("skills", skillId) },
        ),
      };
    }
    throw cause;
  }
}

function validateSkillBinding(
  document: AtlanteDocument,
  registry: TemplateRegistry,
  skillId: string,
  rawBinding: Record<string, unknown>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const templateId = (rawBinding.template ??
    DEFAULT_SKILL_TEMPLATE_ID) as string;
  const input = promptInputOf(rawBinding, SKILL_BINDING_KEYS);
  const resolvedValues = skillValues(document, rawBinding, skillId, templateId);
  if (resolvedValues.diagnostic) {
    diagnostics.push(resolvedValues.diagnostic);
    return diagnostics;
  }
  const { values } = resolvedValues;

  const description = rawBinding.description;
  if (typeof description !== "string") {
    diagnostics.push(
      error(
        "invalid-skill-description",
        `skill "${skillId}" template "${templateId}": description must be a non-empty string`,
        { path: bindingPath("skills", skillId, ["description"]) },
      ),
    );
  }

  const descriptionValueDiagnostics =
    typeof description === "string"
      ? missingValueDiagnostics(
          description,
          values,
          skillId,
          templateId,
          "skills",
          "skill",
          ["description"],
        )
      : [];
  const inputValueDiagnostics = missingValueDiagnostics(
    input,
    values,
    skillId,
    templateId,
    "skills",
    "skill",
  );
  diagnostics.push(...descriptionValueDiagnostics, ...inputValueDiagnostics);
  diagnostics.push(
    ...emptySkillDescriptionDiagnostics(
      description,
      descriptionValueDiagnostics,
      values,
      skillId,
      templateId,
    ),
  );

  if (inputValueDiagnostics.length > 0) {
    diagnostics.push(
      ...validateSkillInput(registry, templateId, input, skillId).filter(
        (diagnostic) => diagnostic.code !== "invalid-prompt-input",
      ),
    );
    return diagnostics;
  }

  const interpolated = interpolatedSkillInput(
    input,
    values,
    skillId,
    templateId,
  );
  if (interpolated.diagnostic) {
    diagnostics.push(interpolated.diagnostic);
    return diagnostics;
  }
  diagnostics.push(
    ...validateSkillInput(registry, templateId, interpolated.input, skillId),
  );
  return diagnostics;
}

export function validateTemplates(
  document: AtlanteDocument,
  registry: TemplateRegistry,
  defaultTemplateId: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [agentId, binding] of Object.entries(document.agents)) {
    diagnostics.push(
      ...validateAgentBinding(
        document,
        registry,
        defaultTemplateId,
        agentId,
        binding,
      ),
    );
  }

  for (const [skillId, binding] of Object.entries(document.skills ?? {})) {
    diagnostics.push(
      ...validateSkillBinding(
        document,
        registry,
        skillId,
        binding as Record<string, unknown>,
      ),
    );
  }

  return diagnostics;
}
