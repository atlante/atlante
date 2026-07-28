import { describe, expect, test } from "bun:test";
import {
  InvalidValueReferenceError,
  interpolateValues,
  loadTemplates,
  MissingValueError,
  NonStringValueError,
  renderTemplate,
  slotPartialName,
} from "../src/index.js";
import type { TemplateRegistry } from "../src/loader.js";

const root = new URL("./fixtures/composed", import.meta.url).pathname;
const cyclicRoot = new URL("./fixtures/cyclic", import.meta.url).pathname;
const diamondRoot = new URL("./fixtures/diamond", import.meta.url).pathname;

function render(input: Record<string, unknown>): string {
  const { registry } = loadTemplates(root, "test");
  return renderTemplate({
    registry,
    templateId: "test/outer",
    input,
  });
}

/** Builds a one-off in-memory registry for a single inline template source. */
function registryOf(source: string): TemplateRegistry {
  const inputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {},
  };
  return {
    get: (id) =>
      id === "test/probe"
        ? {
            id,
            inputSchema,
            source,
            directory: "<memory>",
          }
        : undefined,
    ids: () => ["test/probe"],
  };
}

function slotRegistry(properties: string[], source: string): TemplateRegistry {
  const rootInputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: Object.fromEntries(
      properties.map((property) => [property, { template: "test/child" }]),
    ),
  };
  const childInputSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { value: { type: "string" } },
  };
  return {
    get: (id) => {
      if (id === "test/root")
        return {
          id,
          inputSchema: rootInputSchema,
          source,
          directory: "<memory>",
        };
      if (id === "test/child")
        return {
          id,
          inputSchema: childInputSchema,
          source: "Child: {{value}}",
          directory: "<memory>",
        };
      return undefined;
    },
    ids: () => ["test/child", "test/root"],
  };
}

function templateRegistryOf(
  definitions: Record<
    string,
    { inputSchema: Record<string, unknown>; source: string }
  >,
): TemplateRegistry {
  const entries = new Map(
    Object.entries(definitions).map(([id, definition]) => [
      id,
      { id, directory: "<memory>", ...definition },
    ]),
  );
  return {
    get: (id) => entries.get(id),
    ids: () => [...entries.keys()],
  };
}

function slotPartial(path: string): string {
  return `{{> ${slotPartialName(path)}}}`;
}

describe("renderTemplate", () => {
  test("renders template input into the output", () => {
    const output = render({ title: "Report" });
    expect(output).toContain("# Report");
  });

  test("renders a slot's child with the slot's own input", () => {
    const output = render({ title: "Report", detail: { body: "ok" } });
    expect(output).toContain("Detail: ok");
  });

  test("renders a child from a nested object data path", () => {
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
          inputSchema: {
            type: "object",
            properties: { label: { type: "string" } },
          },
          source: "Child: {{label}}",
        },
      }),
      templateId: "test/root",
      input: { container: { child: { label: "nested" } } },
    });

    expect(output).toBe("Child: nested");
  });

  test("renders array-item children in input order", () => {
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
          inputSchema: {
            type: "object",
            properties: { label: { type: "string" } },
          },
          source: "[{{label}}]",
        },
      }),
      templateId: "test/root",
      input: {
        sections: [{ label: "first" }, { label: "second" }, { label: "third" }],
      },
    });

    expect(output).toBe("[first][second][third]");
  });

  test("renders slots nested inside multiple arrays", () => {
    const output = renderTemplate({
      registry: templateRegistryOf({
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
                        properties: {
                          detail: { template: "test/detail" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          source: `{{#each sections}}{{#each rows}}${slotPartial(
            "sections/rows/detail",
          )}{{/each}}{{/each}}`,
        },
        "test/detail": {
          inputSchema: {
            type: "object",
            properties: { value: { type: "string" } },
          },
          source: "Detail: {{value}}",
        },
      }),
      templateId: "test/root",
      input: {
        sections: [{ rows: [{ detail: { value: "nested" } }] }],
      },
    });

    expect(output).toBe("Detail: nested");
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

  test("inserts child Markdown as opaque output", () => {
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

  test("renders repeated child templates with each slot's own input", () => {
    const { registry } = loadTemplates(diamondRoot, "test");
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

  test("omits the slot section when the slot input is absent", () => {
    const output = render({ title: "Report" });
    expect(output).not.toContain("Detail:");
  });

  test("does not HTML-escape prompt content", () => {
    const output = render({ title: `He said "no" & left` });
    expect(output).toContain(`He said "no" & left`);
  });

  test("is deterministic across repeated renders", () => {
    const input = { title: "Report", detail: { body: "ok" } };
    expect(render(input)).toBe(render(input));
  });

  test("throws a clear error instead of a RangeError on a cyclic composition", () => {
    const { registry } = loadTemplates(cyclicRoot, "test");
    const input = { child: { child: {} } };
    expect(() =>
      renderTemplate({ registry, templateId: "test/a", input }),
    ).toThrow("circular template composition: test/a -> test/b -> test/a");
  });

  test("does not give templates access to the values dictionary", () => {
    const registry = registryOf("[{{values.project}}]");
    const output = renderTemplate({
      registry,
      templateId: "test/probe",
      input: {},
    });
    expect(output).toBe("[]");
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
    const registry = slotRegistry(
      [property],
      `{{> "${slotPartialName(property)}"}}`,
    );
    const output = renderTemplate({
      registry,
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

describe("interpolateValues", () => {
  const values = { project: "atlante", lang: "it" };

  test("resolves a values reference inside a string", () => {
    expect(interpolateValues("for {{values.project}}", values)).toBe(
      "for atlante",
    );
  });

  test("resolves a hyphenated flat value key", () => {
    expect(
      interpolateValues("for {{values.project-name}}", {
        "project-name": "atlante",
      }),
    ).toBe("for atlante");
  });

  test("diagnoses unsupported bracket and spaced-dot values forms", () => {
    expect(() => interpolateValues("{{values[project]}}", values)).toThrow(
      InvalidValueReferenceError,
    );
    expect(() => interpolateValues("{{ values . project }}", values)).toThrow(
      InvalidValueReferenceError,
    );
    expect(() => interpolateValues("{{values}}", values)).toThrow(
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

  test("interpolates object keys and rejects collisions safely", () => {
    expect(
      interpolateValues(
        { "{{values.project}}": "value" } as Record<string, unknown>,
        values,
      ),
    ).toEqual({ atlante: "value" });
    expect(() =>
      interpolateValues({ "{{values.project}}": "a", atlante: "b" }, values),
    ).toThrow(/collide/);
  });

  test("leaves strings without references untouched", () => {
    expect(interpolateValues("plain", values)).toBe("plain");
  });

  test("leaves non-string leaves untouched", () => {
    expect(interpolateValues({ n: 1, b: true, z: null }, values)).toEqual({
      n: 1,
      b: true,
      z: null,
    });
  });

  test("rejects an unknown key instead of silently using an empty string", () => {
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

  test("preserves values-dictionary enumeration syntax verbatim, without leaking values", () => {
    const secrets = { project: "atlante", apiKey: "sk-SECRET-123" };
    const source = "{{#each values}}{{@key}}={{this}} {{/each}}";
    expect(interpolateValues(source, secrets)).toBe(source);
  });

  test("preserves unrelated {{variableName}} prose verbatim", () => {
    const source = "Use {{variableName}} to format.";
    expect(interpolateValues(source, values)).toBe(source);
  });

  test("preserves an unbalanced {{#if}} block verbatim without throwing", () => {
    const source = "Docs: {{#if x}} opens a block";
    expect(() => interpolateValues(source, values)).not.toThrow();
    expect(interpolateValues(source, values)).toBe(source);
  });

  // @atlante/schema restricts `values` to strings (SPECIFICATION.md §4.2), so
  // an array or object here can only occur in a document assembled by hand
  // that bypassed that validation. This guard is defence-in-depth for that
  // case, exactly like the cycle guard in `renderTemplate`.
  test("throws NonStringValueError instead of comma-joining an array value", () => {
    const withArray = { list: ["one", "two"] };
    expect(() => interpolateValues("{{values.list}}", withArray)).toThrow(
      NonStringValueError,
    );
  });

  test("throws NonStringValueError instead of stringifying an object value", () => {
    const withObject = { config: { a: 1 } };
    expect(() => interpolateValues("{{values.config}}", withObject)).toThrow(
      NonStringValueError,
    );
  });

  test("NonStringValueError names the offending path and resolved type", () => {
    const withArray = { list: ["one", "two"] };
    expect(() => interpolateValues("{{values.list}}", withArray)).toThrow(
      /values\.list.*object/,
    );
  });
});
