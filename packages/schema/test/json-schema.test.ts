import { describe, expect, test } from "bun:test";
import { buildDocumentJsonSchema } from "../scripts/generate.js";
import { documentJsonSchema, SCHEMA_URI } from "../src/index.js";

describe("document JSON Schema", () => {
  test("identifies itself with the versioned $id", () => {
    expect(documentJsonSchema.$id).toBe(SCHEMA_URI);
  });

  test("declares the Draft 2020-12 dialect", () => {
    expect(documentJsonSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  test("the committed file matches the generated output", () => {
    expect(documentJsonSchema).toEqual(buildDocumentJsonSchema());
  });
});
