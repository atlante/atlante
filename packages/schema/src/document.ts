import { z } from "zod";
import type { ValuesMap } from "./values.ts";
import { valuesMapSchema } from "./values.ts";

export const SCHEMA_URI = "https://atlante.sh/schema/v0.1/schema.json";

/**
 * An agent binding cannot be strict here: its prompt fields are owned by the
 * selected template's inputSchema, which this package knows nothing about.
 * Unknown-field rejection happens at validation level 2 (SPECIFICATION.md §8.1).
 */
export const agentBindingSchema = z.looseObject({
  promptTemplate: z.string().min(1).optional(),
  values: valuesMapSchema.optional(),
});

export const atlanteDocumentSchema = z.strictObject({
  $schema: z.literal(SCHEMA_URI),
  values: valuesMapSchema.optional(),
  agents: z.record(z.string().min(1), agentBindingSchema),
});

export type AgentBinding = {
  promptTemplate?: string;
  values?: ValuesMap;
} & Record<string, unknown>;

export type AtlanteDocument = {
  $schema: string;
  values?: ValuesMap;
  agents: Record<string, AgentBinding>;
};
