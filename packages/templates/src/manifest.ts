import { z } from "zod";

export const TEMPLATE_MANIFEST_URI =
  "https://atlante.sh/schema/template/v0.1/schema.json";
export const JSON_SCHEMA_DRAFT_2020_12_URI =
  "https://json-schema.org/draft/2020-12/schema";

/** `namespace/name`, both segments lowercase alphanumeric with dashes. */
export const TEMPLATE_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export const inputSchemaSchema = z.looseObject({
  $schema: z.literal(JSON_SCHEMA_DRAFT_2020_12_URI),
});

export const templateManifestSchema = z.strictObject({
  $schema: z.literal(TEMPLATE_MANIFEST_URI),
  id: z.string().regex(TEMPLATE_ID_PATTERN),
  description: z.string().optional(),
  inputSchema: inputSchemaSchema,
});

export type TemplateManifest = z.infer<typeof templateManifestSchema>;
