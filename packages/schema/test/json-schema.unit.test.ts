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

  test("does not reserve extends as an agent binding property", () => {
    const documentProperties = buildDocumentJsonSchema().properties as Record<
      string,
      unknown
    >;
    const agents = documentProperties.agents as {
      additionalProperties: {
        oneOf: Array<{ type?: string; properties?: Record<string, unknown> }>;
      };
    };
    const binding = agents.additionalProperties.oneOf.find(
      (entry) => entry.type === "object",
    );

    expect(binding?.properties).not.toHaveProperty("extends");
  });

  test("publishes the string-or-array extends union for overlays", () => {
    const properties = buildDocumentJsonSchema().properties as Record<
      string,
      unknown
    >;

    expect(properties.extends).toEqual({
      oneOf: [
        { type: "string", minLength: 1 },
        {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
        },
      ],
    });
  });

  test("does not require either binding map in the published schema", () => {
    expect(buildDocumentJsonSchema().required).toEqual(["$schema"]);
  });

  test("allows unresolved descriptions in the generated skill source schema", () => {
    const properties = buildDocumentJsonSchema().properties as Record<
      string,
      unknown
    >;
    const skills = properties.skills as {
      additionalProperties: { oneOf: Array<Record<string, unknown>> };
    };
    const binding = skills.additionalProperties.oneOf.find(
      (entry) => entry.type === "object",
    );
    expect(binding).toBeDefined();
    expect(binding?.required ?? []).not.toContain("description");
    expect(binding?.properties).toHaveProperty("$instance");
    expect(binding?.properties).toHaveProperty("$template");
    expect(binding?.properties).not.toHaveProperty("template");
    expect(binding?.properties).toHaveProperty("values");
  });

  test("publishes string source shorthand for agents", () => {
    const properties = buildDocumentJsonSchema().properties as Record<
      string,
      unknown
    >;
    const agents = properties.agents as {
      additionalProperties: { oneOf: Array<Record<string, unknown>> };
    };
    expect(agents.additionalProperties.oneOf).toContainEqual({
      type: "string",
      minLength: 1,
    });
  });

  test("publishes the supported host targets for editors", () => {
    const properties = buildDocumentJsonSchema().properties as Record<
      string,
      unknown
    >;

    expect(properties.hosts).toEqual({
      type: "array",
      items: { const: "opencode" },
      minItems: 1,
      uniqueItems: true,
    });
  });

  test("publishes independent native output directory options", () => {
    const properties = buildDocumentJsonSchema().properties as Record<
      string,
      unknown
    >;
    expect(properties.options).toEqual({
      type: "object",
      properties: {
        agents: {
          type: "object",
          properties: { outDir: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
        skills: {
          type: "object",
          properties: { outDir: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    });
  });

  test("publishes pack eval metadata and unique pack includes", () => {
    const properties = buildDocumentJsonSchema().properties as Record<
      string,
      unknown
    >;
    const evalSchema = properties.eval as {
      anyOf: Array<{
        properties?: Record<string, Record<string, unknown>>;
      }>;
    };

    expect(
      evalSchema.anyOf.some(
        (entry) =>
          entry.properties?.fixtures !== undefined &&
          entry.properties?.report !== undefined,
      ),
    ).toBe(true);
    for (const entry of evalSchema.anyOf) {
      const include = entry.properties?.include;
      if (include !== undefined) expect(include.uniqueItems).toBe(true);
    }
  });

  test("the committed file matches the generated output", () => {
    expect(documentJsonSchema).toEqual(buildDocumentJsonSchema());
  });
});
