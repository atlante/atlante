import { z } from "zod";
import {
  atlanteDocumentOverlaySchema,
  atlanteDocumentOverlayV02Schema,
  SCHEMA_URI,
  SCHEMA_URI_V02,
} from "../src/document.js";
import {
  EVAL_SCENARIO_SCHEMA_URI,
  evalScenarioBaseSchema,
} from "../src/eval.js";
import { VALUE_KEY_PATTERN } from "../src/values.js";

export function buildDocumentJsonSchema(): Record<string, unknown> {
  return buildDocumentJsonSchemaFrom(atlanteDocumentOverlaySchema, SCHEMA_URI, {
    const: "opencode",
  });
}

export function buildDocumentV02JsonSchema(): Record<string, unknown> {
  return buildDocumentJsonSchemaFrom(
    atlanteDocumentOverlayV02Schema,
    SCHEMA_URI_V02,
    { enum: ["opencode", "claude-code"] },
  );
}

function buildDocumentJsonSchemaFrom(
  overlaySchema: z.ZodTypeAny,
  uri: string,
  hostsItems: Record<string, unknown>,
): Record<string, unknown> {
  const generated = z.toJSONSchema(overlaySchema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;

  const documentProperties = generated.properties as Record<string, unknown>;
  const valuesSchema = {
    type: "object",
    propertyNames: {
      type: "string",
      pattern: VALUE_KEY_PATTERN.source,
    },
    additionalProperties: { oneOf: [{ type: "string" }, { type: "null" }] },
  };
  const sourceObjectSchema = {
    type: "object",
    properties: {
      $instance: { type: "string", minLength: 1 },
      $template: { type: "string", minLength: 1 },
      description: {
        oneOf: [{ type: "string", minLength: 1 }, { type: "null" }],
      },
      values: valuesSchema,
    },
    additionalProperties: {},
    not: { required: ["template"] },
    allOf: [
      {
        not: { required: ["$instance", "$template"] },
      },
    ],
  };
  const sourceStringSchema = { type: "string", minLength: 1 };
  const extendsArraySchema = {
    type: "array",
    items: sourceStringSchema,
    minItems: 1,
  };
  const sourceVariants = [sourceStringSchema, sourceObjectSchema];
  const bindingVariants = [...sourceVariants, { type: "null" }];
  const bindingProperties = {
    type: "object",
    propertyNames: { type: "string", minLength: 1 },
    additionalProperties: { oneOf: bindingVariants },
  };
  documentProperties.extends = {
    oneOf: [sourceStringSchema, extendsArraySchema],
  };
  documentProperties.hosts = {
    type: "array",
    items: hostsItems,
    minItems: 1,
    uniqueItems: true,
  };
  documentProperties.values = valuesSchema;
  documentProperties.agents = bindingProperties;
  documentProperties.skills = bindingProperties;
  markEvalIncludesUnique(documentProperties.eval);
  generated.required = ["$schema"];

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: uri,
    title: "Atlante configuration document",
    ...generated,
  };
}

/** JSON Schema cannot derive uniqueness from Zod's semantic refinement. */
function markEvalIncludesUnique(schema: unknown): void {
  if (Array.isArray(schema)) {
    for (const entry of schema) markEvalIncludesUnique(entry);
    return;
  }
  if (typeof schema !== "object" || schema === null) return;
  const record = schema as Record<string, unknown>;
  const properties = record.properties;
  if (typeof properties === "object" && properties !== null) {
    const propertyMap = properties as Record<string, unknown>;
    const include = propertyMap.include;
    if (typeof include === "object" && include !== null)
      (include as Record<string, unknown>).uniqueItems = true;
  }
  for (const key of ["anyOf", "allOf", "oneOf"]) {
    markEvalIncludesUnique(record[key]);
  }
}

function buildEvalScenarioJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(evalScenarioBaseSchema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;
  return {
    $schema: "https://json-schema.org/draft-2020-12/schema",
    $id: EVAL_SCENARIO_SCHEMA_URI,
    title: "Atlante eval scenario document",
    ...generated,
  };
}

function serializeDocumentJsonSchema(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)
    .replaceAll(
      /"required": \[\n\s+"([^"\n]+)",\n\s+"([^"\n]+)"\n\s+\]/g,
      '"required": ["$1", "$2"]',
    )
    .replaceAll(
      /"required": \[\n\s+"([^"\n]+)"\n\s+\]/g,
      '"required": ["$1"]',
    )}\n`;
}

if (import.meta.main) {
  const out = new URL("../schema/v0.1/schema.json", import.meta.url);
  await Bun.write(out, serializeDocumentJsonSchema(buildDocumentJsonSchema()));
  console.log(`wrote ${out.pathname}`);
  const v02Out = new URL("../schema/v0.2/schema.json", import.meta.url);
  await Bun.write(
    v02Out,
    serializeDocumentJsonSchema(buildDocumentV02JsonSchema()),
  );
  console.log(`wrote ${v02Out.pathname}`);
  const scenarioOut = new URL(
    "../schema/v0.1/eval-scenario.json",
    import.meta.url,
  );
  await Bun.write(
    scenarioOut,
    serializeDocumentJsonSchema(buildEvalScenarioJsonSchema()),
  );
  console.log(`wrote ${scenarioOut.pathname}`);
  // Regeneration must be reproducible against the committed artifacts: the
  // repo formatter defines the canonical style for the generated JSON.
  await Bun.$`bunx biome format --write ${out.pathname} ${v02Out.pathname} ${scenarioOut.pathname}`.quiet();
  console.log("formatted generated schemas with biome");
}
