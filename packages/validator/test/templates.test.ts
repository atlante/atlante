import { describe, expect, test } from "bun:test";
import { type AtlanteDocument, SCHEMA_URI } from "@atlante/schema";
import {
  loadBundledTemplates,
  loadTemplates,
  type TemplateRegistry,
} from "@atlante/templates";
import {
  expandInputSchema,
  validateAgentInput,
  validateSkillInput,
  validateTemplates,
} from "../src/index.js";

const cyclicRoot = new URL(
  "../../templates/test/fixtures/cyclic",
  import.meta.url,
).pathname;

const invalidSchemaRoot = new URL(
  "../../templates/test/fixtures/invalid-schema",
  import.meta.url,
).pathname;

const nestedSlotRoot = new URL(
  "../../templates/test/fixtures/nested-slot",
  import.meta.url,
).pathname;

function registryOf(
  definitions: Record<
    string,
    { inputSchema: Record<string, unknown>; source?: string }
  >,
): TemplateRegistry {
  const entries = new Map(
    Object.entries(definitions).map(([id, definition]) => [
      id,
      {
        id,
        source: definition.source ?? "",
        directory: "<memory>",
        inputSchema: definition.inputSchema,
      },
    ]),
  );
  return {
    get: (id) => entries.get(id),
    ids: () => [...entries.keys()],
  };
}

function documentWith(agent: Record<string, unknown>) {
  return {
    $schema: SCHEMA_URI,
    agents: { reviewer: agent },
  } as const;
}

describe("expandInputSchema", () => {
  test("replaces a slot with the referenced template's inputSchema", () => {
    const { registry } = loadBundledTemplates();
    const { schema, diagnostics } = expandInputSchema(
      registry,
      "atlante/agent",
    );
    expect(diagnostics).toEqual([]);
    const properties = schema?.properties as Record<
      string,
      { properties?: unknown }
    >;
    expect(properties.sections).toBeDefined();
  });

  test("expands slots in nested objects, array items, and oneOf branches", () => {
    const childSchema = {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    };
    const { schema, diagnostics } = expandInputSchema(
      registryOf({
        "test/root": {
          inputSchema: {
            $schema: SCHEMA_URI,
            type: "object",
            properties: {
              metadata: {
                type: "object",
                properties: { summary: { template: "test/child" } },
              },
              sections: {
                type: "array",
                items: { template: "test/child" },
              },
              choice: {
                oneOf: [
                  {
                    type: "object",
                    properties: { markdown: { template: "test/child" } },
                  },
                  {
                    type: "object",
                    properties: { instructions: { template: "test/child" } },
                  },
                ],
              },
            },
          },
        },
        "test/child": { inputSchema: childSchema },
      }),
      "test/root",
    );

    expect(diagnostics).toEqual([]);
    if (!schema) throw new Error("expanded schema missing");
    const root = schema.properties as {
      metadata: { properties: { summary: unknown } };
      sections: { items: unknown };
      choice: {
        oneOf: Array<{
          properties: Record<string, unknown>;
        }>;
      };
    };
    expect(root.metadata.properties.summary).toEqual(childSchema);
    expect(root.sections.items).toEqual(childSchema);
    expect(root.choice.oneOf[0]?.properties.markdown).toEqual(childSchema);
    expect(root.choice.oneOf[1]?.properties.instructions).toEqual(childSchema);
  });

  test("reports a cycle instead of recursing forever", () => {
    const { registry } = loadTemplates(cyclicRoot, "test");
    const { schema, diagnostics } = expandInputSchema(registry, "test/a");
    expect(schema).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("cyclic-template");
  });

  test("guards direct exported calls with a cyclic stack", () => {
    const { registry } = loadTemplates(cyclicRoot, "test");
    const result = expandInputSchema(registry, "test/a", ["test/a"]);
    expect(result.schema).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("cyclic-template");
  });

  test("reports a slot pointing at a template that does not exist", () => {
    const { registry } = loadTemplates(cyclicRoot, "test");
    const { diagnostics } = expandInputSchema(registry, "test/nope");
    expect(diagnostics[0]?.code).toBe("unknown-template");
  });

  test("reports an unknown nested template at its schema path", () => {
    const { registry } = loadTemplates(nestedSlotRoot, "test");
    const { schema, diagnostics } = expandInputSchema(registry, "test/holder");
    expect(schema).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("unknown-template");
    expect(diagnostics[0]?.path).toBe("/outer/inner");
    expect(diagnostics[0]?.message).toContain("test/does-not-exist");
  });

  test("reports nested cycles with the complete schema slot path", () => {
    const { schema, diagnostics } = expandInputSchema(
      registryOf({
        "test/root": {
          inputSchema: {
            type: "object",
            properties: {
              envelope: {
                type: "object",
                properties: { child: { template: "test/a" } },
              },
            },
          },
        },
        "test/a": {
          inputSchema: {
            type: "object",
            properties: { payload: { template: "test/b" } },
          },
        },
        "test/b": {
          inputSchema: {
            type: "object",
            properties: { payload: { template: "test/a" } },
          },
        },
      }),
      "test/root",
    );

    expect(schema).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("cyclic-template");
    expect(diagnostics[0]?.path).toBe("/envelope/child/payload/payload");
  });

  test("reports malformed nested markers at their schema paths", () => {
    const { diagnostics } = expandInputSchema(
      registryOf({
        "test/root": {
          inputSchema: {
            type: "object",
            properties: {
              metadata: {
                type: "object",
                properties: {
                  invalid: { template: 42 },
                  sections: { type: "array", items: { template: "" } },
                  choice: {
                    oneOf: [
                      {
                        type: "object",
                        properties: { branch: { template: "not-namespaced" } },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      }),
      "test/root",
    );

    expect(diagnostics).toHaveLength(3);
    expect(
      diagnostics.every(
        (diagnostic) => diagnostic.code === "invalid-input-schema",
      ),
    ).toBe(true);
    expect(diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
      "/metadata/invalid",
      "/metadata/sections/items",
      "/metadata/choice/oneOf/0/branch",
    ]);
  });
});

describe("validateAgentInput", () => {
  test("rejects a template with a structurally invalid inputSchema instead of throwing", () => {
    const { registry } = loadTemplates(invalidSchemaRoot, "test");
    const diagnostics = validateAgentInput(
      registry,
      "test/broken",
      {},
      "reviewer",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("invalid-input-schema");
    expect(diagnostics[0]?.message).toContain("test/broken");
    expect(diagnostics[0]?.message).not.toContain(
      "must be equal to one of the allowed values",
    );
  });

  test("retains agent and slot provenance with escaped JSON Pointer segments", () => {
    const { registry } = loadTemplates(cyclicRoot, "test");
    const diagnostics = validateAgentInput(
      registry,
      "test/a",
      {},
      "agent/id~one",
    );
    expect(diagnostics[0]?.message).toContain('agent "agent/id~one"');
    expect(diagnostics[0]?.message).toContain('at slot "child.child"');
    expect(diagnostics[0]?.path).toBe("/agents/agent~1id~0one/child/child");
  });

  test("retains nested-slot provenance instead of replacing it with the agent path", () => {
    const { registry } = loadTemplates(nestedSlotRoot, "test");
    const diagnostics = validateAgentInput(
      registry,
      "test/holder",
      {},
      "agent/id~one",
    );
    expect(diagnostics[0]?.message).toContain('agent "agent/id~one"');
    expect(diagnostics[0]?.message).toContain('at slot "outer.inner"');
    expect(diagnostics[0]?.path).toBe("/agents/agent~1id~0one/outer/inner");
  });

  test("escapes slot property segments in JSON Pointer paths", () => {
    const registry: TemplateRegistry = {
      get: (id) =>
        id === "test/root"
          ? {
              id,
              inputSchema: {
                $schema: "https://json-schema.org/draft/2020-12/schema",
                type: "object",
                properties: {
                  "slot/a~b": { template: "test/missing" },
                },
              },
              source: "",
              directory: "<memory>",
            }
          : undefined,
      ids: () => ["test/root"],
    };
    const diagnostics = validateAgentInput(
      registry,
      "test/root",
      {},
      "agent/id~one",
    );
    expect(diagnostics[0]?.message).toContain('at slot "slot/a~b"');
    expect(diagnostics[0]?.path).toBe("/agents/agent~1id~0one/slot~1a~0b");
  });

  test("reports input under an unknown nested slot instead of accepting it unchecked", () => {
    const { registry } = loadTemplates(nestedSlotRoot, "test");
    const diagnostics = validateAgentInput(
      registry,
      "test/holder",
      { outer: { inner: { anything: 123 } } },
      "reviewer",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("unknown-template");
    expect(diagnostics[0]?.path).toBe("/agents/reviewer/outer/inner");
  });

  test("reports invalid child input at its nested object data path", () => {
    const childSchema = {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
      additionalProperties: false,
    };
    const diagnostics = validateAgentInput(
      registryOf({
        "test/root": {
          inputSchema: {
            type: "object",
            properties: {
              metadata: {
                type: "object",
                properties: { summary: { template: "test/child" } },
              },
            },
          },
        },
        "test/child": { inputSchema: childSchema },
      }),
      "test/root",
      { metadata: { summary: {} } },
      "reviewer",
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
    expect(diagnostics[0]?.path).toBe(
      "/agents/reviewer/metadata/summary/title",
    );
  });

  test("reports invalid array child input at its indexed data path", () => {
    const diagnostics = validateAgentInput(
      registryOf({
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
        },
        "test/section": {
          inputSchema: {
            type: "object",
            properties: { title: { type: "string" } },
            required: ["title"],
            additionalProperties: false,
          },
        },
      }),
      "test/root",
      { sections: [{ title: "first" }, {}] },
      "reviewer",
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
    expect(diagnostics[0]?.path).toBe("/agents/reviewer/sections/1/title");
  });

  test("validates skill input with skill paths", () => {
    const { registry } = loadBundledTemplates();
    const diagnostics = validateSkillInput(
      registry,
      "atlante/skill",
      { title: "Testing", overview: "Run tests.", sections: 42 },
      "skill/id~one",
    );
    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
    expect(diagnostics[0]?.path).toBe("/skills/skill~1id~0one/sections");
  });

  test("accepts a skill constraints section", () => {
    const { registry } = loadBundledTemplates();
    expect(
      validateSkillInput(
        registry,
        "atlante/skill",
        {
          title: "Testing",
          overview: "Run tests.",
          sections: [{ constraints: ["Keep scope focused."] }],
        },
        "testing",
      ),
    ).toEqual([]);
  });

  test("rejects empty skill constraints", () => {
    const { registry } = loadBundledTemplates();
    const diagnostics = validateSkillInput(
      registry,
      "atlante/skill",
      {
        title: "Testing",
        overview: "Run tests.",
        sections: [{ constraints: [""] }],
      },
      "testing",
    );

    expect(diagnostics.map((diagnostic) => diagnostic.path)).toContain(
      "/skills/testing/sections/0/constraints/0",
    );
  });

  test("rejects object-shaped instruction, gotcha, and constraint sections", () => {
    const { registry } = loadBundledTemplates();

    for (const section of [
      { instructions: { steps: ["Do the work."] } },
      { gotchas: { items: ["Do the work."] } },
      { constraints: { items: ["Do the work."] } },
    ]) {
      expect(
        validateSkillInput(
          registry,
          "atlante/skill",
          { title: "Testing", overview: "Run tests.", sections: [section] },
          "testing",
        ),
      ).not.toEqual([]);
    }
  });
});

describe("validateTemplates", () => {
  const { registry } = loadBundledTemplates();
  const check = (agent: Record<string, unknown>) =>
    validateTemplates(documentWith(agent), registry, "atlante/agent");

  test("accepts a valid agent binding", () => {
    expect(
      check({ template: "atlante/agent", identity: "x", mission: "y" }),
    ).toEqual([]);
  });

  test("accepts an agent instructions section", () => {
    expect(
      check({
        identity: "x",
        mission: "y",
        sections: [{ instructions: ["Do the work."] }],
      }),
    ).toEqual([]);
  });

  test("accepts an agent constraints section", () => {
    expect(
      check({
        identity: "x",
        mission: "y",
        sections: [{ constraints: ["Do the work."] }],
      }),
    ).toEqual([]);
  });

  test("applies the default template when template is omitted", () => {
    expect(check({ identity: "x", mission: "y" })).toEqual([]);
  });

  test("rejects an unknown template", () => {
    const diagnostics = check({
      template: "atlante/nope",
      identity: "x",
    });
    expect(diagnostics[0]?.code).toBe("unknown-template");
  });

  test("rejects a missing required prompt field", () => {
    const diagnostics = check({ identity: "x" });
    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
    expect(diagnostics[0]?.message).toContain("mission");
  });

  test("rejects an unknown prompt field", () => {
    const diagnostics = check({ identity: "x", mission: "y", tone: "snarky" });
    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
  });

  test("rejects an invalid slot input", () => {
    const diagnostics = check({
      identity: "x",
      mission: "y",
      sections: [{ workflow: { phases: [] } }],
    });
    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
  });

  test("accepts phase instructions, output, and inline validation", () => {
    expect(
      validateSkillInput(
        registry,
        "atlante/skill",
        {
          title: "Workflow",
          overview: "Coordinate the change.",
          sections: [
            {
              workflow: {
                phases: [
                  {
                    name: "Execute",
                    subagent: "implement",
                    output: { description: "The aggregate result." },
                    validation: {
                      description: "Confirm the phase result.",
                      command: "bun test",
                    },
                    instructions: ["Make the change."],
                  },
                ],
              },
            },
          ],
        },
        "workflow",
      ),
    ).toEqual([]);
  });

  test.each([
    { description: "Confirm the phase result." },
    { command: "bun test" },
    { description: "Confirm the phase result.", command: "bun test" },
  ])("accepts validation with description, command, or both", (validation) => {
    expect(
      validateSkillInput(
        registry,
        "atlante/skill",
        {
          title: "Workflow",
          overview: "Coordinate the change.",
          sections: [
            {
              workflow: {
                phases: [
                  {
                    name: "Execute",
                    instructions: ["Make the change."],
                    validation,
                  },
                ],
              },
            },
          ],
        },
        "workflow",
      ),
    ).toEqual([]);
  });

  test.each([
    {},
    { description: "" },
    { command: "" },
    { description: "Valid", extra: "not allowed" },
  ])("rejects invalid inline validation %j", (validation) => {
    const diagnostics = validateSkillInput(
      registry,
      "atlante/skill",
      {
        title: "Workflow",
        overview: "Coordinate the change.",
        sections: [
          {
            workflow: {
              phases: [
                {
                  name: "Execute",
                  instructions: ["Make the change."],
                  validation,
                },
              ],
            },
          },
        ],
      },
      "workflow",
    );

    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
  });

  test.each(["tasks", "check"])(
    "rejects removed workflow property %s",
    (property) => {
      const diagnostics = validateSkillInput(
        registry,
        "atlante/skill",
        {
          title: "Workflow",
          overview: "Coordinate the change.",
          sections: [
            {
              workflow: {
                phases: [
                  {
                    name: "Execute",
                    instructions: ["Make the change."],
                    [property]:
                      property === "tasks"
                        ? [{ description: "removed task object" }]
                        : { command: "bun test" },
                  },
                ],
              },
            },
          ],
        },
        "workflow",
      );

      expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
    },
  );

  test("rejects task objects in the phase instructions array", () => {
    const diagnostics = validateSkillInput(
      registry,
      "atlante/skill",
      {
        title: "Workflow",
        overview: "Coordinate the change.",
        sections: [
          {
            workflow: {
              phases: [
                {
                  name: "Execute",
                  instructions: [{ description: "Make the change." }],
                },
              ],
            },
          },
        ],
      },
      "workflow",
    );

    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
  });

  test("does not treat template or values as prompt input", () => {
    expect(
      check({
        template: "atlante/agent",
        values: { project: "p" },
        identity: "x",
        mission: "y",
      }),
    ).toEqual([]);
  });

  test("does not retain promptTemplate as legacy binding metadata", () => {
    const diagnostics = check({
      promptTemplate: "atlante/agent",
      identity: "x",
      mission: "y",
    });

    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
    expect(diagnostics[0]?.message).toContain("promptTemplate");
  });

  test("rejects an unknown values reference before rendering", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        values: { project: "p" },
        agents: {
          "agent/id~one": {
            identity: "work on {{values.missing}}",
            mission: "y",
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics[0]?.code).toBe("missing-value");
    expect(diagnostics[0]?.path).toBe("/agents/agent~1id~0one/identity");
    expect(diagnostics[0]?.message).toContain("{{values.missing}}");
  });

  test("validates template input after values interpolation", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        values: { identity: "" },
        agents: {
          reviewer: {
            identity: "{{values.identity}}",
            mission: "y",
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
    expect(diagnostics[0]?.message).toContain("fewer than 1 characters");
    expect(diagnostics[0]?.message).not.toContain("missing required value");
  });

  test("rejects values-like references outside the flat key syntax", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            identity: "{{values.project.name}}",
            mission: "y",
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("invalid-value-reference");
  });

  test("diagnoses bracket and spaced-dot values-like references", () => {
    for (const identity of ["{{values[project]}}", "{{ values . project }}"]) {
      const diagnostics = check({ identity, mission: "y" });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.code).toBe("invalid-value-reference");
    }
  });

  test("checks references used in object keys", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            identity: "x",
            mission: "y",
            "{{values.missing}}": "field",
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics[0]?.code).toBe("missing-value");
    expect(diagnostics[0]?.path).toBe("/agents/reviewer");
  });

  test("surfaces interpolated object-key collisions before resolution", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        values: { project: "atlante" },
        agents: {
          reviewer: {
            identity: "x",
            mission: "y",
            "{{values.project}}": "first",
            atlante: "second",
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("value-reference-collision");
    expect(diagnostics[0]?.path).toBe("/agents/reviewer");
  });

  test("accepts a skill with the default bundled template", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {},
        skills: {
          testing: {
            description: "Testing",
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "Run tests." }],
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics).toEqual([]);
  });

  test("requires a skill description and reports its path", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {},
        skills: {
          testing: {
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "Run tests." }],
          } as never,
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics[0]?.code).toBe("invalid-skill-description");
    expect(diagnostics[0]?.path).toBe("/skills/testing/description");
  });

  test("interpolates skill descriptions and local values", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        values: { project: "Atlante", emphasis: "deterministic" },
        agents: {},
        skills: {
          testing: {
            description:
              "Testing {{values.project}} with {{values.emphasis}} guidance",
            values: { emphasis: "repeatable" },
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "Run tests." }],
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics).toEqual([]);
  });

  test("reports an empty interpolated skill description at the description path", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        values: { description: "" },
        agents: {},
        skills: {
          testing: {
            description: "{{values.description}}",
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "Run tests." }],
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics[0]?.code).toBe("invalid-skill-description");
    expect(diagnostics[0]?.path).toBe("/skills/testing/description");
  });

  test("reports description and template-input errors together", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        values: { description: "" },
        agents: {},
        skills: {
          testing: {
            description: "{{values.description}}",
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "{{values.missing}}" }],
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(({ code }) => code)).toEqual([
      "missing-value",
      "invalid-skill-description",
    ]);
    expect(diagnostics[0]?.path).toBe("/skills/testing/sections/0/markdown");
    expect(diagnostics[1]?.path).toBe("/skills/testing/description");
  });

  test("retains description diagnostics when template input interpolation collides", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        values: { description: "", project: "atlante" },
        agents: {},
        skills: {
          testing: {
            description: "{{values.description}}",
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "Run tests." }],
            "{{values.project}}": "first",
            atlante: "second",
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(({ code }) => code)).toEqual([
      "invalid-skill-description",
      "value-reference-collision",
    ]);
    expect(diagnostics[0]?.path).toBe("/skills/testing/description");
    expect(diagnostics[1]?.path).toBe("/skills/testing");
  });

  test("does not pass description or values to the skill template", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {},
        skills: {
          testing: {
            description: "Testing",
            values: { project: "Atlante" },
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "Run tests." }],
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics).toEqual([]);
  });

  test("reports missing skill value references with a skill path", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {},
        skills: {
          "skill/id": {
            description: "Use {{values.missing}}",
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "Run tests." }],
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics[0]?.code).toBe("missing-value");
    expect(diagnostics[0]?.path).toBe("/skills/skill~1id/description");
  });

  test("rejects an unknown skill template", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {},
        skills: {
          testing: {
            description: "Testing",
            template: "atlante/nope",
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "Run tests." }],
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics[0]?.code).toBe("unknown-template");
    expect(diagnostics[0]?.path).toBe("/skills/testing");
  });

  test("rejects invalid bundled skill content", () => {
    const document = {
      $schema: SCHEMA_URI,
      agents: {},
      skills: {
        testing: {
          description: "Testing",
          title: "Testing",
          overview: "Run tests.",
          sections: 42,
        },
      },
    } as unknown as AtlanteDocument;
    const diagnostics = validateTemplates(document, registry, "atlante/agent");
    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
    expect(diagnostics[0]?.path).toBe("/skills/testing/sections");
  });

  test("requires exactly one kind of skill section", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {},
        skills: {
          testing: {
            description: "Testing",
            title: "Testing",
            overview: "Run tests.",
            sections: [
              {
                markdown: "Run tests.",
                gotchas: ["Do not skip validation."],
              },
            ],
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(
      diagnostics.some((issue) => issue.path === "/skills/testing/sections/0"),
    ).toBe(true);
  });

  test("reports skill composition cycles", () => {
    const { registry: cyclicRegistry } = loadTemplates(cyclicRoot, "test");
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {},
        skills: {
          testing: {
            description: "Testing",
            template: "test/a",
          },
        },
      },
      cyclicRegistry,
      "atlante/agent",
    );
    expect(diagnostics[0]?.code).toBe("cyclic-template");
    expect(diagnostics[0]?.path).toMatch(/^\/skills\/testing/);
  });

  test("rejects unsupported values-like syntax in skill input", () => {
    const diagnostics = validateTemplates(
      {
        $schema: SCHEMA_URI,
        agents: {},
        skills: {
          testing: {
            description: "Testing",
            title: "Testing",
            overview: "Run tests.",
            sections: [{ markdown: "{{values.project.name}}" }],
          },
        },
      },
      registry,
      "atlante/agent",
    );
    expect(diagnostics[0]?.code).toBe("invalid-value-reference");
    expect(diagnostics[0]?.path).toBe("/skills/testing/sections/0/markdown");
  });
});
