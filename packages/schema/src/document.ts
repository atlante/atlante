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
  promptTemplate: z.string().min(1).optional(),
  values: valuesMapSchema.optional(),
});
type AgentBindingOutput = z.infer<typeof agentBindingBaseSchema>;

export const agentBindingSchema = z
  .unknown()
  .superRefine((input, context) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      context.addIssue({ code: "custom", message: "expected an object" });
      return;
    }
    const result = agentBindingBaseSchema.safeParse(input);
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
    const parsed = agentBindingBaseSchema.parse(input);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>)) {
      const value =
        key === "promptTemplate" || key === "values"
          ? parsed[key]
          : (input as Record<string, unknown>)[key];
      Object.defineProperty(output, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
    return output as AgentBindingOutput;
  });

/** Canonical document — after expansion, no `extends` or tombstone `null`s. */
export const atlanteDocumentSchema = z.strictObject({
  $schema: z.literal(SCHEMA_URI),
  values: valuesMapSchema.optional(),
  agents: safeRecord(z.string().min(1), agentBindingSchema),
});

export type AgentBinding = z.infer<typeof agentBindingSchema>;

export type AtlanteDocument = z.infer<typeof atlanteDocumentSchema>;

// ---------------------------------------------------------------------------
// Overlay types — used during expansion before canonical validation
// ---------------------------------------------------------------------------

/** An agent binding in an overlay document: allows `null` tombstones. */
export type AgentBindingOverlay = {
  promptTemplate?: string | null;
  values?: ValuesMapOverlay;
  [key: string]: unknown;
};

/** Agents map in an overlay document: values can be `null` (tombstone). */
export type AgentsOverlay = Record<string, AgentBindingOverlay | null>;

/** Raw overlay document before expansion: allows document-level `extends` and tombstone `null`s.
 * `agents` is optional — it can be inherited from a preset. */
export type AtlanteDocumentOverlay = {
  $schema: string;
  extends?: string;
  values?: ValuesMapOverlay;
  agents?: AgentsOverlay;
};
