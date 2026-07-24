import { describe, expect, test } from "bun:test";
import { SCHEMA_URI } from "@atlante/schema";
import {
  loadBundledTemplates,
  loadTemplates,
  type TemplateRegistry,
} from "@atlante/templates";
import {
  expandInputSchema,
  validateAgentInput,
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
    expect(properties.workflow?.properties).toHaveProperty("steps");
  });

  test("reports a cycle instead of recursing forever", () => {
    const { registry } = loadTemplates(cyclicRoot);
    const { schema, diagnostics } = expandInputSchema(registry, "test/a");
    expect(schema).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("cyclic-template");
  });

  test("guards direct exported calls with a cyclic stack", () => {
    const { registry } = loadTemplates(cyclicRoot);
    const result = expandInputSchema(registry, "test/a", ["test/a"]);
    expect(result.schema).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("cyclic-template");
  });

  test("reports a slot pointing at a template that does not exist", () => {
    const { registry } = loadTemplates(cyclicRoot);
    const { diagnostics } = expandInputSchema(registry, "test/nope");
    expect(diagnostics[0]?.code).toBe("unknown-template");
  });

  test("rejects a slot reference nested below the top level instead of ignoring it", () => {
    const { registry } = loadTemplates(nestedSlotRoot);
    const { schema, diagnostics } = expandInputSchema(
      registry,
      "test/nested-slot",
    );
    expect(schema).toBeUndefined();
    expect(diagnostics[0]?.code).toBe("invalid-input-schema");
  });
});

describe("validateAgentInput", () => {
  test("rejects a template with a structurally invalid inputSchema instead of throwing", () => {
    const { registry } = loadTemplates(invalidSchemaRoot);
    const diagnostics = validateAgentInput(
      registry,
      "test/invalid-schema",
      {},
      "reviewer",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("invalid-input-schema");
    expect(diagnostics[0]?.message).toContain("test/invalid-schema");
    expect(diagnostics[0]?.message).not.toContain(
      "must be equal to one of the allowed values",
    );
  });

  test("retains agent and slot provenance with escaped JSON Pointer segments", () => {
    const { registry } = loadTemplates(cyclicRoot);
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
    const { registry } = loadTemplates(nestedSlotRoot);
    const diagnostics = validateAgentInput(
      registry,
      "test/nested-slot",
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
              manifest: {
                $schema: "https://atlante.sh/schema/template/v0.1/schema.json",
                id: "test/root",
                inputSchema: {
                  $schema: "https://json-schema.org/draft/2020-12/schema",
                  type: "object",
                  properties: {
                    "slot/a~b": { template: "test/missing" },
                  },
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

  test("rejects input under a nested slot instead of accepting it unchecked", () => {
    const { registry } = loadTemplates(nestedSlotRoot);
    const diagnostics = validateAgentInput(
      registry,
      "test/nested-slot",
      { outer: { inner: { anything: 123 } } },
      "reviewer",
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe("invalid-input-schema");
  });
});

describe("validateTemplates", () => {
  const { registry } = loadBundledTemplates();
  const check = (agent: Record<string, unknown>) =>
    validateTemplates(documentWith(agent), registry, "atlante/agent");

  test("accepts a valid agent binding", () => {
    expect(
      check({ promptTemplate: "atlante/agent", identity: "x", mission: "y" }),
    ).toEqual([]);
  });

  test("applies the default template when promptTemplate is omitted", () => {
    expect(check({ identity: "x", mission: "y" })).toEqual([]);
  });

  test("rejects an unknown promptTemplate", () => {
    const diagnostics = check({
      promptTemplate: "atlante/nope",
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
      workflow: { steps: [] },
    });
    expect(diagnostics[0]?.code).toBe("invalid-prompt-input");
  });

  test("does not treat promptTemplate or values as prompt input", () => {
    expect(
      check({
        promptTemplate: "atlante/agent",
        values: { project: "p" },
        identity: "x",
        mission: "y",
      }),
    ).toEqual([]);
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
});
