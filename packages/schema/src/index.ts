export type { AgentBinding, AtlanteDocument } from "./document.ts";
export {
  agentBindingSchema,
  atlanteDocumentSchema,
  SCHEMA_URI,
} from "./document.ts";
export type { Value, ValuesMap } from "./values.ts";
export {
  VALUE_KEY_PATTERN,
  valueSchema,
  valuesMapSchema,
} from "./values.ts";

import documentJsonSchemaRaw from "../schema/v0.1/schema.json" with {
  type: "json",
};

export const documentJsonSchema = documentJsonSchemaRaw as Record<
  string,
  unknown
>;
