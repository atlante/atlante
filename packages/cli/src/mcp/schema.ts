import { EVAL_SCENARIO_SCHEMA_URI, SCHEMA_URI } from "@atlante/schema";
import evalScenarioSchema from "@atlante/schema/eval-scenario.json" with {
  type: "json",
};
import documentSchema from "@atlante/schema/schema.json" with { type: "json" };

export { EVAL_SCENARIO_SCHEMA_URI };

export type SchemaDiagnostic = Readonly<{
  code: "schema-uri-required" | "schema-not-supported";
  message: string;
}>;

export type SchemaLookupResult =
  | Readonly<{
      status: "ok";
      uri: string;
      schema: unknown;
      diagnostic?: undefined;
    }>
  | Readonly<{
      status: "diagnostic";
      diagnostic: SchemaDiagnostic;
      uri?: undefined;
      schema?: undefined;
    }>;

const schemas: Readonly<Record<string, unknown>> = {
  [SCHEMA_URI]: documentSchema,
  [EVAL_SCENARIO_SCHEMA_URI]: evalScenarioSchema,
};

/** Returns only schema documents bundled by the CLI's versioned contracts. */
export function getBundledSchema(uri: string | undefined): SchemaLookupResult {
  if (!uri || uri.trim().length === 0)
    return {
      status: "diagnostic",
      diagnostic: {
        code: "schema-uri-required",
        message: "a supported Atlante schema URI is required",
      },
    };
  const schema = schemas[uri];
  if (schema === undefined)
    return {
      status: "diagnostic",
      diagnostic: {
        code: "schema-not-supported",
        message: `Atlante does not bundle the schema URI "${uri}"`,
      },
    };
  return { status: "ok", uri, schema };
}
