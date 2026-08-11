import { z } from "zod";
import { atlanteDocumentOverlaySchema, SCHEMA_URI } from "../src/document.js";
import { VALUE_KEY_PATTERN } from "../src/values.js";

export function buildDocumentJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(atlanteDocumentOverlaySchema, {
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
  const sourceVariants = [sourceStringSchema, sourceObjectSchema];
  const bindingVariants = [...sourceVariants, { type: "null" }];
  const bindingProperties = {
    type: "object",
    propertyNames: { type: "string", minLength: 1 },
    additionalProperties: { oneOf: bindingVariants },
  };
  documentProperties.extends = sourceStringSchema;
  documentProperties.values = valuesSchema;
  documentProperties.agents = bindingProperties;
  documentProperties.skills = bindingProperties;
  generated.required = ["$schema"];

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: SCHEMA_URI,
    title: "Atlante configuration document",
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
}
