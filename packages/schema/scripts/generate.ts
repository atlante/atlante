import { z } from "zod";
import { atlanteDocumentSchema, SCHEMA_URI } from "../src/document.js";
import { VALUE_KEY_PATTERN } from "../src/values.js";

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
    additionalProperties: { oneOf: [{ type: "string" }, { type: "null" }] },
  };
  const agentBindingSchema = {
    type: "object",
    properties: {
      promptTemplate: { type: "string", minLength: 1 },
      values: valuesSchema,
      extends: { type: "string", minLength: 1 },
    },
    additionalProperties: {},
  };
  documentProperties.values = valuesSchema;
  documentProperties.agents = {
    type: "object",
    propertyNames: { type: "string", minLength: 1 },
    additionalProperties: { oneOf: [agentBindingSchema, { type: "null" }] },
  };
  // `extends` is optional at the document level — a preset id to inherit from.
  documentProperties.extends = { type: "string", minLength: 1 };
  generated.required = ["$schema", "agents"];

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_URI,
    title: "Atlante configuration document",
    ...generated,
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
