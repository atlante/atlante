import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProjectResourcePack,
  InvalidValueReferenceError,
  interpolateValues,
  MissingValueError,
  NonStringValueError,
  renderResolvedTemplate,
  resolveTemplate,
  slotPartialName,
  ValueReferenceCollisionError,
  withResourceTemplateSelection,
} from "../src/index.js";

const DRAFT_URI = "https://json-schema.org/draft/2020-12/schema";
const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-renderer-"));
  created.push(root);
  writeFileSync(join(root, "atlante.jsonc"), "{}\n");
  return root;
}

function writeTemplate(
  root: string,
  name: string,
  schema: Record<string, unknown>,
  source: string,
): void {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "template.jsonc"),
    `${JSON.stringify({ $schema: DRAFT_URI, ...schema })}\n`,
  );
  writeFileSync(join(directory, "template.md"), source);
}

function render(root: string, name: string, input: unknown): string {
  const template = resolveTemplate(
    createProjectResourcePack(root),
    `./${name}`,
    join(root, "atlante.jsonc"),
  );
  return renderResolvedTemplate({ template, input });
}

function partial(path: string): string {
  return `{{> ${slotPartialName(path)}}}`;
}

describe("resource renderer", () => {
  test("renders nested object slots with each child input", () => {
    const root = project();
    writeTemplate(
      root,
      "root",
      {
        type: "object",
        properties: {
          container: {
            type: "object",
            properties: { child: { template: "../child" } },
          },
        },
      },
      partial("container/child"),
    );
    writeTemplate(
      root,
      "child",
      {
        type: "object",
        properties: { value: { type: "string" } },
      },
      "Child: {{value}}",
    );

    expect(
      render(root, "root", { container: { child: { value: "nested" } } }),
    ).toBe("Child: nested");
  });

  test("renders nested array children in source order", () => {
    const root = project();
    writeTemplate(
      root,
      "root",
      {
        type: "object",
        properties: {
          groups: {
            type: "array",
            items: {
              type: "object",
              properties: {
                rows: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { detail: { template: "../detail" } },
                  },
                },
              },
            },
          },
        },
      },
      `{{#each groups}}{{#each rows}}${partial("groups/rows/detail")}{{/each}}{{/each}}`,
    );
    writeTemplate(
      root,
      "detail",
      {
        type: "object",
        properties: { value: { type: "string" } },
      },
      "[{{value}}]",
    );

    expect(
      render(root, "root", {
        groups: [
          {
            rows: [{ detail: { value: "one" } }, { detail: { value: "two" } }],
          },
          { rows: [{ detail: { value: "three" } }] },
        ],
      }),
    ).toBe("[one][two][three]");
  });

  test("renders bare array-valued slot partials identically regardless of section order", () => {
    const root = project();
    const sectionsSchema = {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            oneOf: [
              {
                type: "object",
                properties: { markdown: { template: "../blocks" } },
                required: ["markdown"],
                additionalProperties: false,
              },
              {
                type: "object",
                properties: { notes: { template: "../note" } },
                required: ["notes"],
                additionalProperties: false,
              },
            ],
          },
        },
      },
    };
    writeTemplate(
      root,
      "parent",
      sectionsSchema,
      `{{#each sections}}{{#if markdown}}${partial("sections/markdown")}{{/if}}{{/each}}`,
    );
    writeTemplate(
      root,
      "blocks",
      { type: "array", items: { type: "string" } },
      "[{{#each (input)}}{{this}}{{/each}}]",
    );
    writeTemplate(
      root,
      "note",
      { type: "object", properties: { value: { type: "string" } } },
      "({{value}})",
    );

    const markdownFirst = render(root, "parent", {
      sections: [{ markdown: ["a", "b"] }, { notes: { value: "n" } }],
    });
    const markdownLast = render(root, "parent", {
      sections: [{ notes: { value: "n" } }, { markdown: ["a", "b"] }],
    });

    expect(markdownFirst).toBe("[ab]");
    expect(markdownLast).toBe("[ab]");
  });

  test("renders a bare top-level array-valued slot across every section in order", () => {
    const root = project();
    writeTemplate(
      root,
      "parent",
      {
        type: "object",
        properties: {
          sections: {
            type: "array",
            items: {
              type: "object",
              oneOf: [
                {
                  type: "object",
                  properties: { markdown: { template: "../blocks" } },
                  required: ["markdown"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: { notes: { template: "../note" } },
                  required: ["notes"],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
      },
      partial("sections/markdown"),
    );
    writeTemplate(
      root,
      "blocks",
      { type: "array", items: { type: "string" } },
      "[{{#each (input)}}{{this}}{{/each}}]",
    );
    writeTemplate(
      root,
      "note",
      { type: "object", properties: { value: { type: "string" } } },
      "({{value}})",
    );

    expect(
      render(root, "parent", {
        sections: [
          { markdown: ["a", "b"] },
          { notes: { value: "n" } },
          { markdown: ["c"] },
        ],
      }),
    ).toBe("[ab][c]");
  });

  test("renders array-root item slots per element", () => {
    const root = project();
    writeTemplate(
      root,
      "parent",
      {
        type: "object",
        properties: {
          sections: { type: "array", items: { template: "../item" } },
        },
      },
      partial("sections"),
    );
    writeTemplate(
      root,
      "item",
      { type: "object", properties: { value: { type: "string" } } },
      "[{{value}}]",
    );

    expect(
      render(root, "parent", {
        sections: [{ value: "one" }, { value: "two" }],
      }),
    ).toBe("[one][two]");
  });

  test("renders explicit-arg array-valued slot partials identically regardless of section order", () => {
    const root = project();
    writeTemplate(
      root,
      "parent",
      {
        type: "object",
        properties: {
          sections: {
            type: "array",
            items: {
              type: "object",
              oneOf: [
                {
                  type: "object",
                  properties: { markdown: { template: "../blocks" } },
                  required: ["markdown"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: { notes: { template: "../note" } },
                  required: ["notes"],
                  additionalProperties: false,
                },
              ],
            },
          },
        },
      },
      `{{#each sections}}{{#if markdown}}{{> slot/sections/markdown markdown}}{{/if}}{{/each}}`,
    );
    writeTemplate(
      root,
      "blocks",
      { type: "array", items: { type: "string" } },
      "[{{#each (input)}}{{this}}{{/each}}]",
    );
    writeTemplate(
      root,
      "note",
      { type: "object", properties: { value: { type: "string" } } },
      "({{value}})",
    );

    const markdownFirst = render(root, "parent", {
      sections: [{ markdown: ["a", "b"] }, { notes: { value: "n" } }],
    });
    const markdownLast = render(root, "parent", {
      sections: [{ notes: { value: "n" } }, { markdown: ["a", "b"] }],
    });

    expect(markdownFirst).toBe("[ab]");
    expect(markdownLast).toBe("[ab]");
  });

  test("renders the selected child when branches share a data path", () => {
    const root = project();
    writeTemplate(
      root,
      "root",
      {
        type: "object",
        properties: {
          choice: {
            oneOf: [
              {
                type: "object",
                properties: { payload: { template: "../first" } },
              },
              {
                type: "object",
                properties: { payload: { template: "../second" } },
              },
            ],
          },
        },
      },
      partial("choice/payload"),
    );
    writeTemplate(
      root,
      "first",
      { type: "object", properties: { value: { type: "string" } } },
      "first: {{value}}",
    );
    writeTemplate(
      root,
      "second",
      { type: "object", properties: { value: { type: "string" } } },
      "second: {{value}}",
    );

    const payload = withResourceTemplateSelection(
      { value: "chosen" },
      "../second",
    );
    expect(render(root, "root", { choice: { payload } })).toBe(
      "second: chosen",
    );
  });

  test("keeps child Markdown opaque and does not reinterpret or escape it", () => {
    const root = project();
    writeTemplate(
      root,
      "root",
      {
        type: "object",
        properties: { content: { template: "../child" } },
      },
      `Before ${partial("content")} After`,
    );
    writeTemplate(
      root,
      "child",
      {
        type: "object",
        properties: { markdown: { type: "string" } },
      },
      "{{markdown}}",
    );

    expect(
      render(root, "root", {
        content: { markdown: "{{parent}} & <b>markdown</b>" },
      }),
    ).toBe("Before {{parent}} & <b>markdown</b> After");
  });

  test("does not HTML-escape scalar prompt content", () => {
    const root = project();
    writeTemplate(
      root,
      "root",
      { type: "object", properties: { text: { type: "string" } } },
      "{{text}}",
    );

    expect(render(root, "root", { text: '"quoted" & <raw>' })).toBe(
      '"quoted" & <raw>',
    );
  });

  test("isolates sibling slot input and omits a missing optional slot", () => {
    const root = project();
    writeTemplate(
      root,
      "root",
      {
        type: "object",
        properties: {
          left: { template: "../child" },
          right: { template: "../child" },
          missing: { template: "../child" },
        },
      },
      `${partial("left")}|${partial("right")}|${partial("missing")}`,
    );
    writeTemplate(
      root,
      "child",
      {
        type: "object",
        properties: { value: { type: "string" } },
      },
      "{{value}}",
    );

    expect(
      render(root, "root", {
        left: { value: "LEFT" },
        right: { value: "RIGHT" },
      }),
    ).toBe("LEFT|RIGHT|");
  });
});

describe("generic template predicates", () => {
  test("matches exact values and safely scans arbitrary paths", () => {
    const root = project();
    writeTemplate(
      root,
      "root",
      {
        type: "object",
        properties: {
          record: { type: "object" },
          entries: { type: "array" },
          bag: { type: "object" },
          rows: { type: "array" },
        },
      },
      [
        '{{#if (isEqual (lookup record "enabled") true)}}E{{else}}N{{/if}}',
        '{{#if (anyEqual entries "enabled" true)}}M{{else}}N{{/if}}',
        '{{#if (anyTruthy bag rows "meta")}}C{{else}}N{{/if}}',
      ].join("|"),
    );

    const cases = [
      [
        "exact values",
        {
          record: { enabled: true },
          entries: [{ enabled: true }],
          bag: { first: false, second: 0 },
          rows: [{ meta: { first: false } }, { meta: { second: "present" } }],
        },
        "E|M|C",
      ],
      [
        "truthy non-boolean values",
        {
          record: { enabled: "true" },
          entries: [{ enabled: "true" }, { enabled: 1 }],
          bag: { first: "present" },
          rows: [{ meta: { first: false } }],
        },
        "N|N|C",
      ],
      [
        "falsey values",
        {
          record: { enabled: false },
          entries: [{ enabled: false }, { enabled: 0 }],
          bag: { first: false, second: 0 },
          rows: [{ meta: { first: false } }, { meta: { second: 0 } }],
        },
        "N|N|N",
      ],
      ["missing values", {}, "N|N|N"],
      [
        "malformed values",
        {
          record: "true",
          entries: { enabled: true },
          bag: [],
          rows: { meta: { enabled: true } },
        },
        "N|N|N",
      ],
      [
        "malformed members",
        {
          record: { enabled: true },
          entries: [null, "true", { enabled: "true" }],
          bag: { first: false },
          rows: [null, "true", { meta: "present" }],
        },
        "E|N|N",
      ],
    ] as const;

    for (const [label, input, expected] of cases)
      expect(render(root, "root", input), label).toBe(expected);
  });
});

describe("resource value interpolation", () => {
  test("interpolates nested objects, arrays, and object keys", () => {
    expect(
      interpolateValues(
        {
          "{{values.project}}": ["{{values.lang}}"],
          nested: { value: "{{values.project}}" },
        } as Record<string, unknown>,
        { project: "atlante", lang: "it" },
      ),
    ).toEqual({ atlante: ["it"], nested: { value: "atlante" } });
  });

  test("reports missing and non-string values without stringifying them", () => {
    expect(() => interpolateValues("{{values.missing}}", {})).toThrow(
      MissingValueError,
    );
    expect(() =>
      interpolateValues("{{values.list}}", { list: ["one", "two"] }),
    ).toThrow(NonStringValueError);
    expect(() =>
      interpolateValues("{{values.config}}", { config: { enabled: true } }),
    ).toThrow(/values\.config.*object/);
  });

  test("rejects interpolated object-key collisions and unsupported references", () => {
    expect(() =>
      interpolateValues(
        { "{{values.project}}": "first", atlante: "second" },
        { project: "atlante" },
      ),
    ).toThrow(ValueReferenceCollisionError);
    expect(() => interpolateValues("{{values.project.name}}", {})).toThrow(
      InvalidValueReferenceError,
    );
    expect(() => interpolateValues("{{values[project]}}", {})).toThrow(
      InvalidValueReferenceError,
    );
  });

  test("leaves unrelated Handlebars prose and non-string leaves untouched", () => {
    const source = "Use {{variableName}} and {{#if x}} without a closing block";

    expect(interpolateValues(source, {})).toBe(source);
    expect(
      interpolateValues({ count: 1, enabled: true, empty: null }, {}),
    ).toEqual({ count: 1, enabled: true, empty: null });
  });
});
