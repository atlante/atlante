import { z } from "zod";

export const TEMPLATE_MANIFEST_URI =
  "https://atlante.sh/schema/template/v0.1/schema.json";

/** `namespace/name`, both segments lowercase alphanumeric with dashes. */
export const TEMPLATE_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export const templateManifestSchema = z.strictObject({
  $schema: z.literal(TEMPLATE_MANIFEST_URI),
  id: z.string().regex(TEMPLATE_ID_PATTERN),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()),
});

export type TemplateManifest = {
  $schema: string;
  id: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};
