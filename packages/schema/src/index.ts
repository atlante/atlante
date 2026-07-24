export type {
  AgentBinding,
  AgentBindingOverlay,
  AgentsOverlay,
  AtlanteDocument,
  AtlanteDocumentOverlay,
} from "./document.js";
export {
  agentBindingSchema,
  atlanteDocumentSchema,
  SCHEMA_URI,
} from "./document.js";
export type { Value, ValuesMap, ValuesMapOverlay } from "./values.js";
export {
  VALUE_KEY_PATTERN,
  valueSchema,
  valuesMapOverlaySchema,
  valuesMapSchema,
} from "./values.js";

import documentJsonSchemaRaw from "../schema/v0.1/schema.json" with {
  type: "json",
};

export const documentJsonSchema = documentJsonSchemaRaw as Record<
  string,
  unknown
>;
