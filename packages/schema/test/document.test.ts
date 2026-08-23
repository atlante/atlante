import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  agentBindingSchema,
  atlanteDocumentOverlaySchema,
  atlanteDocumentSchema,
  SCHEMA_URI,
  skillBindingSchema,
} from "../src/index.js";
import { safeRecord } from "../src/values.js";

const valid = {
  $schema: SCHEMA_URI,
  values: { project: "atlante", rule: "Never invent requirements." },
  agents: {
    reviewer: {
      description: "Reviews changes.",
      values: { rule: "Reviews only." },
      identity: "You are a reviewer.",
      mission: "Review changes.",
    },
  },
};

describe("atlanteDocumentSchema", () => {
  test("accepts a valid document", () => {
    const result = atlanteDocumentSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  test("accepts a document without values", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      agents: { a: { description: "Agent", identity: "x", mission: "y" } },
    });
    expect(result.success).toBe(true);
  });

  test("requires a non-empty agent description", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      agents: { reviewer: { identity: "x", mission: "y" } },
    });
    expect(result.success).toBe(false);
  });

  test("accepts a document with a skill binding", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      agents: {},
      skills: {
        testing: {
          description: "Testing guidance",
          content: "Run the tests.",
        },
      },
    });
    expect(result.success).toBe(true);
  });

  test("accepts a skill-only document and normalizes agents to an empty map", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      skills: {
        testing: { description: "Testing guidance", content: "Run tests." },
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.agents).toEqual({});
  });

  test("requires a non-empty skill description", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      agents: {},
      skills: { testing: { description: "", content: "Run the tests." } },
    });
    expect(result.success).toBe(false);
  });

  test("accepts a document without skills and normalizes skills to an empty map", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      agents: {},
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.skills).toEqual({});
  });

  test("rejects an unknown root field while allowing skills", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      agents: {},
      skills: {},
      rules: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects an unknown root field", () => {
    const result = atlanteDocumentSchema.safeParse({ ...valid, rules: [] });
    expect(result.success).toBe(false);
  });

  test("accepts a document without agents or skills and normalizes both maps", () => {
    const result = atlanteDocumentSchema.safeParse({ $schema: SCHEMA_URI });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.agents).toEqual({});
    expect(result.data.skills).toEqual({});
  });

  test("rejects an unsupported $schema URI", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      $schema: "https://example.com/other-schema.json",
    });
    expect(result.success).toBe(false);
  });

  test("rejects values that are not an object", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: "nope",
    });
    expect(result.success).toBe(false);
  });

  test("accepts a string-valued entry", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { language: "TypeScript" },
    });
    expect(result.success).toBe(true);
  });

  test("accepts a hyphenated value key supported by reference syntax", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { "project-name": "Atlante" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects a value key that cannot be referenced as a flat key", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { "project.name": "Atlante" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty value and agent keys without rewriting their diagnostics", () => {
    const emptyValue = atlanteDocumentSchema.safeParse(
      JSON.parse(`{"$schema":"${SCHEMA_URI}","values":{"":"x"},"agents":{}}`),
    );
    const emptyAgent = atlanteDocumentSchema.safeParse(
      JSON.parse(
        `{"$schema":"${SCHEMA_URI}","values":{},"agents":{"":{"identity":"x"}}}`,
      ),
    );
    expect(emptyValue.success).toBe(false);
    expect(emptyValue.success ? [] : emptyValue.error.issues[0]?.path).toEqual([
      "values",
      "",
    ]);
    expect(emptyAgent.success).toBe(false);
    expect(emptyAgent.success ? [] : emptyAgent.error.issues[0]?.path).toEqual([
      "agents",
      "",
    ]);
  });

  test("round-trips literal sentinel-like keys", () => {
    const result = atlanteDocumentSchema.safeParse(
      JSON.parse(
        `{"$schema":"${SCHEMA_URI}","values":{"$__atlante_key_61":"value","__proto__":"safe"},"agents":{"$__atlante_unknown_61":{"description":"Agent","identity":"x","mission":"y"}}}`,
      ),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(
      Object.getOwnPropertyDescriptor(
        result.data.values ?? {},
        "$__atlante_key_61",
      )?.value,
    ).toBe("value");
    expect(Object.hasOwn(result.data.values ?? {}, "__proto__")).toBe(true);
    expect(Object.hasOwn(result.data.agents, "$__atlante_unknown_61")).toBe(
      true,
    );
  });

  test("rejects an array-valued entry", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { list: ["one", "two"] },
    });
    expect(result.success).toBe(false);
  });

  test("rejects an object-valued entry", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { limits: { maxAgents: 5 } },
    });
    expect(result.success).toBe(false);
  });

  test("rejects a value of an unsupported type", () => {
    const result = atlanteDocumentSchema.safeParse({
      ...valid,
      values: { count: 3 },
    });
    expect(result.success).toBe(false);
  });

  test("keeps unknown agent fields, because the template owns them", () => {
    const result = atlanteDocumentSchema.safeParse(valid);
    if (!result.success) throw new Error("expected success");
    expect(result.data.agents.reviewer?.identity).toBe("You are a reviewer.");
  });

  test("preserves own __proto__ values and agent IDs without changing prototypes", () => {
    const raw = JSON.parse(
      `{"$schema":"${SCHEMA_URI}","values":{"__proto__":"safe"},"agents":{"__proto__":{"description":"Agent","identity":"x","mission":"y"}}}`,
    );
    const result = atlanteDocumentSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.hasOwn(result.data.values ?? {}, "__proto__")).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(result.data.values ?? {}, "__proto__")
        ?.value,
    ).toBe("safe");
    expect(Object.hasOwn(result.data.agents, "__proto__")).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(result.data.agents, "__proto__")?.value
        ?.identity,
    ).toBe("x");
  });
});

describe("atlanteDocumentOverlaySchema", () => {
  test("accepts a string binding as $instance shorthand for agents and skills", () => {
    const result = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      agents: { architect: "./resources/architect" },
      skills: { testing: "@atlante/pack/skill" },
    });

    expect(result.success).toBe(true);
  });

  test("accepts $instance and $template source objects with local overlays", () => {
    const result = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $instance: "./resources/architect",
          values: { scope: "review" },
          mission: "Review the change.",
        },
      },
      skills: {
        testing: {
          $template: "./resources/skill",
          description: "Testing guidance.",
          content: "Run the tests.",
        },
      },
    });

    expect(result.success).toBe(true);
  });

  test("accepts local and built-in root extends locators", () => {
    for (const extendsValue of ["./base", "@atlante/pack"]) {
      const result = atlanteDocumentOverlaySchema.safeParse({
        $schema: SCHEMA_URI,
        extends: extendsValue,
      });

      expect(result.success).toBe(true);
    }
  });

  test("accepts a non-empty ordered extends locator array", () => {
    const extendsValue: [string, ...string[]] = [
      "@acme/review-pack/strict",
      "./local",
    ];
    const result = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      extends: extendsValue,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.extends).toEqual(extendsValue);
  });

  test("rejects empty and non-string extends arrays at the authored shape", () => {
    for (const extendsValue of [[], ["./base", 42], [null]]) {
      const result = atlanteDocumentOverlaySchema.safeParse({
        $schema: SCHEMA_URI,
        extends: extendsValue,
      });

      expect(result.success).toBe(false);
    }
  });

  test("leaves locator grammar to semantic resource validation", () => {
    const result = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      extends: "https://example.com/review-pack",
    });

    expect(result.success).toBe(true);
  });

  test("keeps extends, values tombstones, and binding tombstones in raw overlays", () => {
    const result = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      extends: "./base",
      values: { inherited: null },
      agents: { removed: null },
      skills: { removed: null },
    });

    expect(result.success).toBe(true);
  });

  test("allows unresolved descriptions in authored sources but requires them canonically", () => {
    const authored = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      agents: { architect: "./resources/architect" },
      skills: { testing: { $instance: "./resources/testing" } },
    });
    const canonical = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      agents: { architect: { identity: "You are an architect." } },
      skills: { testing: { content: "Run the tests." } },
    });

    expect(authored.success).toBe(true);
    expect(canonical.success).toBe(false);
  });

  test("rejects conflicting selectors", () => {
    const result = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $instance: "./resources/architect",
          $template: "./resources/agent",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  test("rejects malformed and non-string selectors", () => {
    for (const source of [
      { $instance: 42 },
      { $template: null },
      { $instance: "" },
    ]) {
      const result = atlanteDocumentOverlaySchema.safeParse({
        $schema: SCHEMA_URI,
        agents: { reviewer: source },
      });

      expect(result.success).toBe(false);
    }
  });

  test("rejects the legacy binding template selector", () => {
    const authored = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          template: "@atlante/pack/agent",
          description: "Review changes.",
        },
      },
    });
    const canonical = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          template: "@atlante/pack/agent",
          description: "Review changes.",
        },
      },
    });

    expect(authored.success).toBe(false);
    expect(canonical.success).toBe(false);
  });

  test("keeps template-owned fields open, including nested template markers", () => {
    const authored = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      skills: {
        workflow: {
          description: "Workflow guidance.",
          sections: [
            { template: "@atlante/pack/section", content: "Run tests." },
          ],
        },
      },
    });
    const canonical = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      skills: {
        workflow: {
          description: "Workflow guidance.",
          sections: [
            { template: "@atlante/pack/section", content: "Run tests." },
          ],
        },
      },
    });

    expect(authored.success).toBe(true);
    expect(canonical.success).toBe(true);
  });

  test("removes overlay metadata from the canonical shape", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      extends: "./base",
      agents: { removed: null, reviewer: { $template: "./agent" } },
    });

    expect(result.success).toBe(false);
  });

  test("preserves unknown-root rejection and empty ID rules for overlays", () => {
    const unknownRoot = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      rules: [],
    });
    const emptyAgent = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      agents: { "": "./resources/agent" },
    });
    const emptySkill = atlanteDocumentOverlaySchema.safeParse({
      $schema: SCHEMA_URI,
      skills: { "": "./resources/skill" },
    });

    expect(unknownRoot.success).toBe(false);
    expect(emptyAgent.success).toBe(false);
    expect(emptySkill.success).toBe(false);
  });
});

describe("canonical binding schemas", () => {
  test("keeps the public agent and skill schemas behaviorally symmetric", () => {
    const inputs: unknown[] = [
      {
        description: "Binding description.",
        values: { scope: "review" },
        content: "Binding content.",
      },
      { description: "" },
      { description: "Binding description.", values: { scope: 42 } },
      { description: "Binding description.", $instance: "./agent" },
      "not an object",
    ];

    for (const input of inputs) {
      const agent = agentBindingSchema.safeParse(input);
      const skill = skillBindingSchema.safeParse(input);

      expect(skill.success).toBe(agent.success);
      if (agent.success && skill.success) {
        expect(skill.data).toEqual(agent.data);
      } else if (!agent.success && !skill.success) {
        expect(skill.error.issues).toEqual(agent.error.issues);
      }
    }
  });
});

describe("safeRecord", () => {
  test("preserves key and union-value issue paths and branch inputs", () => {
    const schema = safeRecord(
      z.string().min(1),
      z.union([z.string().min(3), z.number().min(10)]),
    );
    const result = schema.safeParse({ "": "value", count: 2 });

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues).toEqual([
      {
        code: "custom",
        message: "Too small: expected string to have >=1 characters",
        path: [""],
      },
      {
        code: "custom",
        message: "Too small: expected number to be >=10",
        path: ["count"],
      },
    ]);
  });

  test("copies transformed values and own __proto__ keys safely", () => {
    const schema = safeRecord(
      z.string().min(1),
      z.string().transform((value) => value.toUpperCase()),
    );
    const result = schema.safeParse(
      JSON.parse('{"name":"value","__proto__":"safe"}'),
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.name).toBe("VALUE");
    expect(Object.hasOwn(result.data, "__proto__")).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(result.data, "__proto__")?.value,
    ).toBe("SAFE");
  });
});
