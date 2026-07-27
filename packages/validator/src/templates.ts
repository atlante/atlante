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

export function validateAgentInput(
  registry: TemplateRegistry,
  templateId: string,
  input: Record<string, unknown>,
  agentId: string,
): Diagnostic[] {
  const { schema, diagnostics } = expandInputSchema(registry, templateId);
  if (!schema) {
    return diagnostics.map((diagnostic) => {
      const slotPath = diagnostic.path ?? "";
      const path = `/agents/${escapeJsonPointerSegment(agentId)}${slotPath}`;
      const slot = slotPath
        ? ` at slot "${slotPath
            .slice(1)
            .split("/")
            .map(unescapeJsonPointerSegment)
            .join(".")}"`
        : "";
      return {
        ...diagnostic,
        message: `agent "${agentId}"${slot}: ${diagnostic.message}`,
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
        `agent "${agentId}" template "${templateId}": inputSchema is invalid; expected a valid JSON Schema Draft 2020-12 object`,
        { path: `/agents/${escapeJsonPointerSegment(agentId)}` },
      ),
    ];
  }
  if (validate(input)) return [];

  return (validate.errors ?? []).map((issue) =>
    error(
      "invalid-prompt-input",
      `agent "${agentId}": ${issue.instancePath || "<root>"} ${issue.message ?? "is invalid"}${
        issue.params && "additionalProperty" in issue.params
          ? ` (${String(issue.params.additionalProperty)})`
          : ""
      }${
        issue.params && "missingProperty" in issue.params
          ? ` (${String(issue.params.missingProperty)})`
          : ""
      }`,
      {
        path: `/agents/${escapeJsonPointerSegment(agentId)}${issue.instancePath}`,
      },
    ),
  );
}

function resolvedValue(values: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(values, key) ? values[key] : undefined;
}

function missingValueDiagnostics(
  input: Record<string, unknown>,
  values: Record<string, unknown>,
  agentId: string,
  templateId: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  walkValueReferences(input, (reference, segments) => {
    const path = `/agents/${escapeJsonPointerSegment(agentId)}${segments
      .map((segment) => `/${escapeJsonPointerSegment(String(segment))}`)
      .join("")}`;
    if (!reference.key || !isValidValueKey(reference.key)) {
      diagnostics.push(
        error(
          "invalid-value-reference",
          `agent "${agentId}" template "${templateId}": invalid values reference "{{${reference.expression}}}"; value names must match [A-Za-z_$][A-Za-z0-9_$-]*`,
          { path },
        ),
      );
    } else if (resolvedValue(values, reference.key) == null) {
      diagnostics.push(
        error(
          "missing-value",
          `agent "${agentId}" template "${templateId}": missing required value "{{values.${reference.key}}}"`,
          { path },
        ),
      );
    }
  });
  return diagnostics;
}

export function promptInputOf(
  binding: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(binding).filter(([key]) => !BINDING_KEYS.has(key)),
  );
}

export function validateTemplates(
  document: AtlanteDocument,
  registry: TemplateRegistry,
  defaultTemplateId: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const [agentId, binding] of Object.entries(document.agents)) {
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
              path: `/agents/${escapeJsonPointerSegment(agentId)}`,
            },
          ),
        );
        continue;
      }
      throw cause;
    }
    const valueDiagnostics = missingValueDiagnostics(
      input,
      values,
      agentId,
      templateId,
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
      continue;
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
              path: `/agents/${escapeJsonPointerSegment(agentId)}${cause.path
                .map(
                  (segment) => `/${escapeJsonPointerSegment(String(segment))}`,
                )
                .join("")}`,
            },
          ),
        );
        continue;
      }
      // The document schema rejects non-string values before normal resolution.
    }
    diagnostics.push(
      ...validateAgentInput(registry, templateId, inputForValidation, agentId),
    );
  }

  return diagnostics;
}
