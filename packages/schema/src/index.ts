export type {
  AgentBinding,
  AgentBindingOverlay,
  AgentsOverlay,
  AtlanteDocument,
  AtlanteDocumentOverlay,
  AuthoredBinding,
  AuthoredExtends,
  AuthoredResourceLocator,
  Hosts,
  HostTarget,
  RawBinding,
  RawResourceLocator,
  RawResourceSource,
  RawResourceSourceObject,
  ResourceSource,
  ResourceSourceObject,
  SkillBinding,
  SkillBindingOverlay,
  SkillsOverlay,
} from "./document.js";
export {
  agentBindingOverlaySchema,
  agentBindingSchema,
  atlanteDocumentOverlaySchema,
  atlanteDocumentSchema,
  authoredExtendsSchema,
  bindingDescriptionSchema,
  hostsSchema,
  hostTargetSchema,
  rawResourceLocatorSchema,
  resourceSourceObjectSchema,
  resourceSourceSchema,
  SCHEMA_URI,
  skillBindingOverlaySchema,
  skillBindingSchema,
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
