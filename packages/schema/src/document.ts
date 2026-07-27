import { z } from "zod";
import type { ValuesMapOverlay } from "./values.js";
import { safeRecord, valuesMapSchema } from "./values.js";

export const SCHEMA_URI = "https://atlante.sh/schema/v0.1/schema.json";

/**
 * An agent binding cannot be strict here: its prompt fields are owned by the
 * selected template's inputSchema, which this package knows nothing about.
 * Unknown-field rejection happens at validation level 2 (SPECIFICATION.md §8.1).
 */
const agentBindingBaseSchema = z.looseObject({
  template: z.string().min(1).optional(),
  values: valuesMapSchema.optional(),
});
type AgentBindingOutput = z.infer<typeof agentBindingBaseSchema>;

/**
 * A skill binding reserves metadata fields while leaving its content fields to
 * the selected template, just like an agent binding.
 */
const skillBindingBaseSchema = z.looseObject({
  description: z.string().min(1),
  template: z.string().min(1).optional(),
  values: valuesMapSchema.optional(),
});
type SkillBindingOutput = z.infer<typeof skillBindingBaseSchema>;

function bindingSchema<Output>(
  baseSchema: z.ZodType<Output>,
  reservedKeys: ReadonlySet<string>,
) {
  return z
    .unknown()
    .superRefine((input, context) => {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        context.addIssue({ code: "custom", message: "expected an object" });
        return;
      }
      const result = baseSchema.safeParse(input);
      if (!result.success) {
        for (const issue of result.error.issues)
          context.addIssue({
            code: "custom",
            message: issue.message,
            path: issue.path,
          });
      }
    })
    .transform((input) => {
      const parsed = baseSchema.parse(input) as Record<string, unknown>;
      const source = input as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      for (const key of Object.keys(source)) {
        const value = reservedKeys.has(key) ? parsed[key] : source[key];
        Object.defineProperty(output, key, {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        });
      }
      return output as Output;
    });
}

export const agentBindingSchema = bindingSchema<AgentBindingOutput>(
  agentBindingBaseSchema,
  new Set(["template", "values"]),
);

export const skillBindingSchema = bindingSchema<SkillBindingOutput>(
  skillBindingBaseSchema,
  new Set(["description", "template", "values"]),
);

/** Canonical document — after expansion, no `extends` or tombstone `null`s. */
export const atlanteDocumentSchema = z.strictObject({
  $schema: z.literal(SCHEMA_URI),
  values: valuesMapSchema.optional(),
  agents: safeRecord(z.string().min(1), agentBindingSchema),
  skills: safeRecord(z.string().min(1), skillBindingSchema).optional(),
});

export type AgentBinding = z.infer<typeof agentBindingSchema>;
export type SkillBinding = z.infer<typeof skillBindingSchema>;

export type AtlanteDocument = z.infer<typeof atlanteDocumentSchema>;

// ---------------------------------------------------------------------------
// Overlay types — used during expansion before canonical validation
// ---------------------------------------------------------------------------

/** An agent binding in an overlay document: allows `null` tombstones. */
export type AgentBindingOverlay = {
  template?: string | null;
  values?: ValuesMapOverlay;
  [key: string]: unknown;
};

/** Agents map in an overlay document: values can be `null` (tombstone). */
export type AgentsOverlay = Record<string, AgentBindingOverlay | null>;

/** A skill binding in an overlay document: allows `null` tombstones. */
export type SkillBindingOverlay = {
  description?: string | null;
  template?: string | null;
  values?: ValuesMapOverlay;
  [key: string]: unknown;
};

/** Skills map in an overlay document: values can be `null` (tombstone). */
export type SkillsOverlay = Record<string, SkillBindingOverlay | null>;

/** Raw overlay document before expansion: allows document-level `extends` and tombstone `null`s.
 * `agents` is optional — it can be inherited from a preset. */
export type AtlanteDocumentOverlay = {
  $schema: string;
  extends?: string;
  values?: ValuesMapOverlay;
  agents?: AgentsOverlay;
  skills?: SkillsOverlay;
};
