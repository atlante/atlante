import { z } from "zod";
import { atlanteDocumentSchema, SCHEMA_URI } from "../src/document.ts";
import { VALUE_KEY_PATTERN } from "../src/values.ts";

export function buildDocumentJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(atlanteDocumentSchema, {
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
    additionalProperties: { type: "string" },
  };
  const agentBindingSchema = {
    type: "object",
    properties: {
      promptTemplate: { type: "string", minLength: 1 },
      values: valuesSchema,
    },
    additionalProperties: {},
  };
  documentProperties.values = valuesSchema;
  documentProperties.agents = {
    type: "object",
    propertyNames: { type: "string", minLength: 1 },
    additionalProperties: agentBindingSchema,
  };

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_URI,
    title: "Atlante configuration document",
    ...generated,
    required: ["$schema", "agents"],
  };
}

if (import.meta.main) {
  const out = new URL("../schema/v0.1/schema.json", import.meta.url);
  await Bun.write(
    out,
    `${JSON.stringify(buildDocumentJsonSchema(), null, 2)}\n`,
  );
  console.log(`wrote ${out.pathname}`);
}
