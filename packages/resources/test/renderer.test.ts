import { describe, expect, test } from "bun:test";
import {
  InvalidValueReferenceError,
  interpolateValues,
  type JsonObject,
  loadTemplateMigrationRegistry,
  MissingValueError,
  NonStringValueError,
  renderTemplate,
  slotPartialName,
  type TemplateMigrationRecord,
  type TemplateRegistry,
  ValueReferenceCollisionError,
} from "../src/index.js";

function templateRegistryOf(
  definitions: Record<string, { inputSchema: JsonObject; source: string }>,
): TemplateRegistry {
  const entries = new Map<string, TemplateMigrationRecord>(
    Object.entries(definitions).map(([id, definition]) => [
      id,
      {
        id,
        directory: "<memory>",
        locator: id,
        origin: { kind: "project", path: `<memory>/${id}/template.jsonc` },
        kind: "template" as const,
        ...definition,
      },
    ]),
  );
  return {
    get: (id: string) => entries.get(id),
    ids: () => [...entries.keys()],
  };
}

function slotPartial(path: string): string {
  return `{{> ${slotPartialName(path)}}}`;
}

function childSchema(): JsonObject {
  return {
    type: "object",
    properties: { value: { type: "string" } },
  };
}

const composedRoot = new URL("./fixtures/composed", import.meta.url).pathname;
const cyclicRoot = new URL("./fixtures/cyclic", import.meta.url).pathname;
const diamondRoot = new URL("./fixtures/diamond", import.meta.url).pathname;

function renderComposed(input: Record<string, unknown>): string {
  const { registry } = loadTemplateMigrationRegistry(composedRoot, "test");
  return renderTemplate({ registry, templateId: "test/outer", input });
}

/** Builds a one-off in-memory registry for a single inline template source. */
function registryOf(source: string): TemplateRegistry {
  const inputSchema: JsonObject = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {},
  };
  return {
    get: (id: string) =>
      id === "test/probe"
        ? {
            id,
            locator: id,
            origin: { kind: "project", path: `<memory>/${id}/template.jsonc` },
            kind: "template" as const,
            inputSchema,
            source,
            directory: "<memory>",
          }
        : undefined,
    ids: () => ["test/probe"],
  };
}

function slotRegistry(properties: string[], source: string): TemplateRegistry {
  const rootInputSchema: JsonObject = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: Object.fromEntries(
      properties.map((property) => [property, { template: "test/child" }]),
    ),
  };
  const childInputSchema: JsonObject = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { value: { type: "string" } },
  };
  const root: TemplateMigrationRecord = {
    id: "test/root",
    locator: "test/root",
    origin: { kind: "project", path: "<memory>/test/root/template.jsonc" },
    kind: "template",
    inputSchema: rootInputSchema,
    source,
    directory: "<memory>",
  };
  const child: TemplateMigrationRecord = {
    id: "test/child",
    locator: "test/child",
    origin: { kind: "project", path: "<memory>/test/child/template.jsonc" },
    kind: "template",
    inputSchema: childInputSchema,
    source: "Child: {{value}}",
    directory: "<memory>",
  };
  const entries = new Map([
    [root.id, root],
    [child.id, child],
  ]);
  return {
    get: (id: string) => entries.get(id),
    ids: () => ["test/child", "test/root"],
  };
}

describe("resource renderer", () => {
  test("renders nested slots from a JSONC template facet", () => {
    const output = renderTemplate({
      registry: templateRegistryOf({
        "test/root": {
          inputSchema: {
            type: "object",
            properties: {
              container: {
                type: "object",
                properties: { child: { template: "test/child" } },
              },
            },
          },
          source: slotPartial("container/child"),
        },
        "test/child": {
          inputSchema: childSchema(),
          source: "Child: {{value}}",
        },
      }),
      templateId: "test/root",
      input: { container: { child: { value: "nested" } } },
    });

    expect(output).toBe("Child: nested");
  });

  test("renders template input from composed JSONC fixtures", () => {
    const output = renderComposed({ title: "Report" });

    expect(output).toContain("# Report");
  });

  test("renders a fixture child with the slot's own input", () => {
    const output = renderComposed({ title: "Report", detail: { body: "ok" } });

    expect(output).toContain("Detail: ok");
  });

  test("preserves array slot order", () => {
    const output = renderTemplate({
      registry: templateRegistryOf({
        "test/root": {
          inputSchema: {
            type: "object",
            properties: {
              sections: {
                type: "array",
                items: { template: "test/section" },
              },
            },
          },
          source: slotPartial("sections"),
        },
        "test/section": {
          inputSchema: childSchema(),
          source: "[{{value}}]",
        },
      }),
      templateId: "test/root",
      input: {
        sections: [{ value: "first" }, { value: "second" }, { value: "third" }],
      },
    });

    expect(output).toBe("[first][second][third]");
  });

  test("keeps child Markdown opaque", () => {
    const output = renderTemplate({
      registry: templateRegistryOf({
        "test/root": {
          inputSchema: {
            type: "object",
            properties: {
              content: {
                type: "object",
                properties: { body: { template: "test/child" } },
              },
            },
          },
          source: `Before ${slotPartial("content/body")} After`,
        },
        "test/child": {
          inputSchema: {
            type: "object",
            properties: { markdown: { type: "string" } },
          },
          source: "{{markdown}}",
        },
      }),
      templateId: "test/root",
      input: { content: { body: { markdown: "{{parent}} & *markdown*" } } },
    });

    expect(output).toBe("Before {{parent}} & *markdown* After");
  });

  test("renders children from nested arrays and oneOf branches", () => {
    const registry = templateRegistryOf({
      "test/root": {
        inputSchema: {
          type: "object",
          properties: {
            sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  rows: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { detail: { template: "test/detail" } },
                    },
                  },
                },
              },
            },
            choice: {
              oneOf: [
                { properties: { markdown: { template: "test/detail" } } },
                { properties: { instructions: { template: "test/detail" } } },
              ],
            },
          },
        },
        source: `{{#each sections}}{{#each rows}}${slotPartial(
          "sections/rows/detail",
        )}{{/each}}{{/each}} {{#if choice.instructions}}${slotPartial(
          "choice/instructions",
        )}{{/if}}`,
      },
      "test/detail": {
        inputSchema: childSchema(),
        source: "{{value}}",
      },
    });

    expect(
      renderTemplate({
        registry,
        templateId: "test/root",
        input: {
          sections: [{ rows: [{ detail: { value: "nested" } }] }],
          choice: { instructions: { value: "branch" } },
        },
      }),
    ).toBe("nested branch");
  });

  test("renders a child from the selected oneOf branch data path", () => {
    const output = renderTemplate({
      registry: templateRegistryOf({
        "test/root": {
          inputSchema: {
            type: "object",
            properties: {
              choice: {
                oneOf: [
                  {
                    type: "object",
                    properties: { markdown: { template: "test/markdown" } },
                  },
                  {
                    type: "object",
                    properties: {
                      instructions: { template: "test/instructions" },
                    },
                  },
                ],
              },
            },
          },
          source: `{{#if choice.instructions}}${slotPartial(
            "choice/instructions",
          )}{{/if}}`,
        },
        "test/markdown": {
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
          },
          source: "Markdown: {{text}}",
        },
        "test/instructions": {
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
          },
          source: "Instructions: {{text}}",
        },
      }),
      templateId: "test/root",
      input: { choice: { instructions: { text: "selected" } } },
    });

    expect(output).toBe("Instructions: selected");
  });

  test("omits absent optional slot inputs", () => {
    const registry = templateRegistryOf({
      "test/root": {
        inputSchema: {
          type: "object",
          properties: { detail: { template: "test/child" } },
        },
        source: `Before ${slotPartial("detail")} After`,
      },
      "test/child": { inputSchema: childSchema(), source: "Child" },
    });

    expect(
      renderTemplate({ registry, templateId: "test/root", input: {} }),
    ).toBe("Before  After");
  });

  test("renders repeated child templates with each slot's own input", () => {
    const { registry } = loadTemplateMigrationRegistry(diamondRoot, "test");
    const output = renderTemplate({
      registry,
      templateId: "test/diamond",
      input: {
        left: { label: "LEFT" },
        right: { label: "RIGHT" },
      },
    });

    expect(output).toContain("Leaf: LEFT");
    expect(output).toContain("Leaf: RIGHT");
  });

  test("is deterministic across repeated renders", () => {
    const input = { title: "Report", detail: { body: "ok" } };

    expect(renderComposed(input)).toBe(renderComposed(input));
  });

  test("throws a clear error for cyclic composition", () => {
    const registry = templateRegistryOf({
      "test/a": {
        inputSchema: {
          type: "object",
          properties: { child: { template: "test/b" } },
        },
        source: slotPartial("child"),
      },
      "test/b": {
        inputSchema: {
          type: "object",
          properties: { child: { template: "test/a" } },
        },
        source: slotPartial("child"),
      },
    });

    expect(() =>
      renderTemplate({
        registry,
        templateId: "test/a",
        input: { child: { child: {} } },
      }),
    ).toThrow("circular template composition: test/a -> test/b -> test/a");
  });

  test("throws a clear error instead of a RangeError on a cyclic fixture", () => {
    const { registry } = loadTemplateMigrationRegistry(cyclicRoot, "test");

    expect(() =>
      renderTemplate({
        registry,
        templateId: "test/a",
        input: { child: { child: {} } },
      }),
    ).toThrow("circular template composition: test/a -> test/b -> test/a");
  });

  test("does not HTML-escape prompt content", () => {
    const registry = templateRegistryOf({
      "test/probe": {
        inputSchema: { type: "object" },
        source: "{{title}}",
      },
    });

    expect(
      renderTemplate({
        registry,
        templateId: "test/probe",
        input: { title: 'He said "no" & left' },
      }),
    ).toBe('He said "no" & left');
  });

  test("does not expose the values dictionary to templates", () => {
    const registry = registryOf("[{{values.project}}]");

    expect(
      renderTemplate({ registry, templateId: "test/probe", input: {} }),
    ).toBe("[]");
  });

  test("does not render inherited optional slot inputs", () => {
    const input = Object.create({ detail: { body: "inherited" } }) as Record<
      string,
      unknown
    >;
    const output = renderTemplate({
      registry: slotRegistry(["detail"], `{{> ${slotPartialName("detail")}}}`),
      templateId: "test/root",
      input,
    });

    expect(output).toBe("");
  });

  test("does not render inherited __proto__ or constructor-like slots", () => {
    const properties = ["__proto__", "constructor"];
    const prototype: Record<string, unknown> = {};
    for (const property of properties)
      Object.defineProperty(prototype, property, {
        enumerable: true,
        value: { value: "inherited" },
      });
    const input = Object.create(prototype) as Record<string, unknown>;
    const output = renderTemplate({
      registry: slotRegistry(
        properties,
        properties
          .map((property) => `{{> ${slotPartialName(property)}}}`)
          .join(" "),
      ),
      templateId: "test/root",
      input,
    });

    expect(output).toBe(" ");
  });

  test("handles arbitrary slot properties", () => {
    const property = "part/name %";
    const output = renderTemplate({
      registry: slotRegistry(
        [property],
        `{{> "${slotPartialName(property)}"}}`,
      ),
      templateId: "test/root",
      input: { [property]: { value: "encoded" } },
    });

    expect(output).toBe("Child: encoded");
  });

  test("does not register template-id aliases for slots", () => {
    expect(() =>
      renderTemplate({
        registry: slotRegistry(["left"], "{{> test/child}}"),
        templateId: "test/root",
        input: { left: { value: "left" } },
      }),
    ).toThrow(/partial test\/child/);
  });
});

describe("resource value interpolation", () => {
  const values = { project: "atlante", lang: "it" };

  test("resolves a values reference inside a string", () => {
    expect(interpolateValues("for {{values.project}}", values)).toBe(
      "for atlante",
    );
  });

  test("resolves nested strings and object keys", () => {
    expect(
      interpolateValues(
        { "{{values.project}}": ["{{values.lang}}"] } as Record<
          string,
          unknown
        >,
        values,
      ),
    ).toEqual({ atlante: ["it"] });
  });

  test("supports hyphenated keys and rejects unsupported forms", () => {
    expect(
      interpolateValues("{{values.project-name}}", { "project-name": "ok" }),
    ).toBe("ok");
    expect(() => interpolateValues("{{values[project]}}", values)).toThrow(
      InvalidValueReferenceError,
    );
    expect(() => interpolateValues("{{ values . project }}", values)).toThrow(
      InvalidValueReferenceError,
    );
    expect(() => interpolateValues("{{values}}", values)).toThrow(
      InvalidValueReferenceError,
    );
    expect(() => interpolateValues("{{values.project.name}}", values)).toThrow(
      InvalidValueReferenceError,
    );
  });

  test("walks nested objects and arrays", () => {
    expect(
      interpolateValues(
        { a: ["{{values.project}}"], b: { c: "{{values.lang}}" } },
        values,
      ),
    ).toEqual({ a: ["atlante"], b: { c: "it" } });
  });

  test("rejects missing and non-string values", () => {
    expect(() => interpolateValues("{{values.nope}}", values)).toThrow(
      MissingValueError,
    );
    expect(() =>
      interpolateValues("{{values.list}}", { list: ["one"] }),
    ).toThrow(NonStringValueError);
    expect(() =>
      interpolateValues({ "{{values.project}}": "a", atlante: "b" }, values),
    ).toThrow(ValueReferenceCollisionError);
  });

  test("leaves strings without references and non-string leaves untouched", () => {
    expect(interpolateValues("plain", values)).toBe("plain");
    expect(interpolateValues({ n: 1, b: true, z: null }, values)).toEqual({
      n: 1,
      b: true,
      z: null,
    });
  });

  test("rejects unknown keys and nested value paths", () => {
    expect(() => interpolateValues("[{{values.nope}}]", values)).toThrow(
      MissingValueError,
    );
    expect(() => interpolateValues("[{{values.nope}}]", values)).toThrow(
      /values\.nope/,
    );
    expect(() => interpolateValues("{{values.toString}}", values)).toThrow(
      MissingValueError,
    );
    expect(() => interpolateValues("{{values.project.name}}", values)).toThrow(
      InvalidValueReferenceError,
    );
  });

  test("preserves values-dictionary enumeration syntax without leaking values", () => {
    const secrets = { project: "atlante", apiKey: "sk-SECRET-123" };
    const source = "{{#each values}}{{@key}}={{this}} {{/each}}";

    expect(interpolateValues(source, secrets)).toBe(source);
  });

  test("preserves unrelated Handlebars prose verbatim", () => {
    const source = "Use {{variableName}} to format.";

    expect(interpolateValues(source, values)).toBe(source);
  });

  test("preserves an unbalanced Handlebars block verbatim without throwing", () => {
    const source = "Docs: {{#if x}} opens a block";

    expect(() => interpolateValues(source, values)).not.toThrow();
    expect(interpolateValues(source, values)).toBe(source);
  });

  test("rejects array and object values instead of stringifying them", () => {
    expect(() =>
      interpolateValues("{{values.list}}", { list: ["one", "two"] }),
    ).toThrow(NonStringValueError);
    expect(() =>
      interpolateValues("{{values.config}}", { config: { a: 1 } }),
    ).toThrow(NonStringValueError);
  });

  test("NonStringValueError names the offending path and resolved type", () => {
    expect(() =>
      interpolateValues("{{values.list}}", { list: ["one", "two"] }),
    ).toThrow(/values\.list.*object/);
  });

  test("leaves unrelated Handlebars prose and unbalanced syntax untouched", () => {
    const source = "Use {{variableName}} and {{#if x}} without a closing block";
    expect(interpolateValues(source, values)).toBe(source);
  });
});
