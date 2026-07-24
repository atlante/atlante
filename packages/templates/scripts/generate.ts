import { z } from "zod";
import {
  TEMPLATE_MANIFEST_URI,
  templateManifestSchema,
} from "../src/manifest.js";

function buildTemplateManifestJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(templateManifestSchema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: TEMPLATE_MANIFEST_URI,
    title: "Atlante template manifest",
    ...generated,
  };
}

if (import.meta.main) {
  const out = new URL("../schema/template/v0.1/schema.json", import.meta.url);
  await Bun.write(
    out,
    `${JSON.stringify(buildTemplateManifestJsonSchema(), null, 2)}\n`,
  );
  console.log(`wrote ${out.pathname}`);
}
