import { z } from "zod";
import { atlanteDocumentSchema, SCHEMA_URI } from "../src/document.ts";

export function buildDocumentJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(atlanteDocumentSchema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;

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
