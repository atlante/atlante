export type {
  AgentBinding,
  AgentBindingOverlay,
  AgentsOverlay,
  AtlanteDocument,
  AtlanteDocumentOverlay,
} from "./document.ts";
export {
  agentBindingSchema,
  atlanteDocumentSchema,
  SCHEMA_URI,
} from "./document.ts";
export type { Value, ValuesMap, ValuesMapOverlay } from "./values.ts";
export {
  VALUE_KEY_PATTERN,
  valueSchema,
  valuesMapOverlaySchema,
  valuesMapSchema,
} from "./values.ts";

import documentJsonSchemaRaw from "../schema/v0.1/schema.json" with {
  type: "json",
};

export const documentJsonSchema = documentJsonSchemaRaw as Record<
  string,
  unknown
>;
