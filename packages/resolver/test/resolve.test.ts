import { describe, expect, test } from "bun:test";
import type { AtlanteDocument } from "@atlante/schema";
import { SCHEMA_URI } from "@atlante/schema";
import { loadBundledTemplates, loadTemplates } from "@atlante/templates";
import { resolve } from "../src/index.js";

const { registry } = loadBundledTemplates();

const undeclaredPartialRoot = new URL(
  "../../templates/test/fixtures/undeclared-partial",
  import.meta.url,
).pathname;

// Values reach prompts only through {{values.x}} references in the document's
// own strings — templates never receive the values dictionary. So the fixture
// must reference them explicitly, which is also how a real user writes this.
const document: AtlanteDocument = {
  $schema: SCHEMA_URI,
  values: { project: "atlante", rule: "Global constraint." },
  agents: {
    reviewer: {
      promptTemplate: "atlante/agent",
      identity: "You are a reviewer.",
      mission: "Review changes to {{values.project}}.",
      constraints: ["{{values.rule}}"],
    },
    planner: {
      values: { rule: "Planner constraint." },
      identity: "You are a planner.",
      mission: "Plan work.",
      constraints: ["{{values.rule}}"],
      workflow: { steps: ["Read the request.", "Draft a plan."] },
    },
  },
};

describe("resolve", () => {
  test("produces one artifact per binding in ECMAScript property-enumeration order", () => {
    const { agents, diagnostics } = resolve(document, registry);
    expect(diagnostics).toEqual([]);
    expect(agents.map((a) => a.hostAgentId)).toEqual(["reviewer", "planner"]);
  });

  test("preserves the host-agent ID and records the template", () => {
    const { agents } = resolve(document, registry);
    expect(agents[0]?.hostAgentId).toBe("reviewer");
    expect(agents[0]?.templateId).toBe("atlante/agent");
  });

  test("resolves a valid __proto__ value and agent ID end to end", () => {
    const protoDocument = JSON.parse(
      `{"$schema":"${SCHEMA_URI}","values":{"__proto__":"safe"},"agents":{"__proto__":{"identity":"Work on {{values.__proto__}}.","mission":"Help."}}}`,
    ) as AtlanteDocument;
    const result = resolve(protoDocument, registry);
    expect(result.diagnostics).toEqual([]);
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0]?.hostAgentId).toBe("__proto__");
    expect(result.agents[0]?.prompt).toContain("Work on safe.");
  });

  test("falls back to the default template when promptTemplate is omitted", () => {
    const { agents } = resolve(document, registry);
    expect(agents[1]?.templateId).toBe("atlante/agent");
  });

  test("resolves global values referenced by the prompt definition", () => {
    const { agents } = resolve(document, registry);
    expect(agents[0]?.prompt).toContain("Review changes to atlante.");
    expect(agents[0]?.prompt).toContain("Global constraint.");
  });

  test("applies per-agent overrides", () => {
    const { agents } = resolve(document, registry);
    expect(agents[1]?.prompt).toContain("Planner constraint.");
    expect(agents[1]?.prompt).not.toContain("Global constraint.");
  });

  test("leaves no unresolved values references in the prompt", () => {
    const { agents } = resolve(document, registry);
    for (const artifact of agents) {
      expect(artifact.prompt).not.toContain("{{values.");
    }
  });

  test("renders the workflow slot only where it is bound", () => {
    const { agents } = resolve(document, registry);
    expect(agents[1]?.prompt).toContain("# Workflow");
    expect(agents[0]?.prompt).not.toContain("# Workflow");
  });

  test("resolves values referenced inside document fields", () => {
    const withReference: AtlanteDocument = {
      $schema: SCHEMA_URI,
      values: { project: "atlante" },
      agents: {
        a: { identity: "You work on {{values.project}}.", mission: "Help." },
      },
    };
    const { agents } = resolve(withReference, registry);
    expect(agents[0]?.prompt).toContain("You work on atlante.");
    expect(agents[0]?.prompt).not.toContain("{{values.project}}");
  });

  test("resolves values inside slot input too", () => {
    const withReference: AtlanteDocument = {
      $schema: SCHEMA_URI,
      values: { project: "atlante" },
      agents: {
        a: {
          identity: "x",
          mission: "y",
          workflow: { steps: ["Build {{values.project}}."] },
        },
      },
    };
    const { agents } = resolve(withReference, registry);
    expect(agents[0]?.prompt).toContain("Build atlante.");
  });

  test("is deterministic", () => {
    expect(resolve(document, registry)).toEqual(resolve(document, registry));
  });

  test("returns diagnostics and no artifacts on invalid input", () => {
    const broken: AtlanteDocument = {
      $schema: SCHEMA_URI,
      agents: { a: { identity: "x" } },
    };
    const result = resolve(broken, registry);
    expect(result.agents).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("invalid-prompt-input");
  });

  test("validates interpolated values against the template schema", () => {
    const emptyResolved: AtlanteDocument = {
      $schema: SCHEMA_URI,
      values: { identity: "" },
      agents: {
        reviewer: { identity: "{{values.identity}}", mission: "Help." },
      },
    };
    const result = resolve(emptyResolved, registry);
    expect(result.agents).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("invalid-prompt-input");
    expect(result.diagnostics[0]?.message).toContain("fewer than 1 characters");
  });

  test("resolves a hyphenated flat value key", () => {
    const hyphenated: AtlanteDocument = {
      $schema: SCHEMA_URI,
      values: { "project-name": "atlante" },
      agents: {
        reviewer: {
          identity: "Work on {{values.project-name}}.",
          mission: "Help.",
        },
      },
    };
    const result = resolve(hyphenated, registry);
    expect(result.diagnostics).toEqual([]);
    expect(result.agents[0]?.prompt).toContain("Work on atlante.");
  });

  test("rejects an unsupported values-like reference without artifacts", () => {
    const invalidReference: AtlanteDocument = {
      $schema: SCHEMA_URI,
      agents: {
        reviewer: { identity: "{{values.project.name}}", mission: "Help." },
      },
    };
    const result = resolve(invalidReference, registry);
    expect(result.agents).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("invalid-value-reference");
  });

  test("returns a diagnostic instead of throwing when a template renders an undeclared partial", () => {
    const { registry: brokenRegistry } = loadTemplates(undeclaredPartialRoot);
    const broken: AtlanteDocument = {
      $schema: SCHEMA_URI,
      agents: { a: { promptTemplate: "test/undeclared-partial" } },
    };
    const result = resolve(broken, brokenRegistry);
    expect(result.agents).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("template-render-failed");
  });

  test("attributes a render failure to its agent and template and emits no partial artifacts", () => {
    const { registry: brokenRegistry } = loadTemplates(undeclaredPartialRoot);
    const combinedRegistry = {
      get: (id: string) => brokenRegistry.get(id) ?? registry.get(id),
      ids: () => [...new Set([...brokenRegistry.ids(), ...registry.ids()])],
    };
    const broken: AtlanteDocument = {
      $schema: SCHEMA_URI,
      agents: {
        good: { identity: "x", mission: "y" },
        "bad/id~one": { promptTemplate: "test/undeclared-partial" },
      },
    };
    const result = resolve(broken, combinedRegistry);
    expect(result.agents).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("template-render-failed");
    expect(result.diagnostics[0]?.message).toContain(
      'agent "bad/id~one" template "test/undeclared-partial"',
    );
    expect(result.diagnostics[0]?.path).toBe("/agents/bad~1id~0one");
  });

  test("reports a missing value with the agent path before rendering", () => {
    const missing: AtlanteDocument = {
      $schema: SCHEMA_URI,
      agents: {
        "bad/id~one": {
          identity: "Work on {{values.missing}}.",
          mission: "Help.",
        },
      },
    };
    const result = resolve(missing, registry);
    expect(result.agents).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("missing-value");
    expect(result.diagnostics[0]?.path).toBe("/agents/bad~1id~0one/identity");
  });

  test("keeps integer-like agent keys in ECMAScript enumeration order", () => {
    const integerKeys: AtlanteDocument = {
      $schema: SCHEMA_URI,
      agents: {
        "10": { identity: "ten", mission: "y" },
        "2": { identity: "two", mission: "y" },
        alpha: { identity: "alpha", mission: "y" },
      },
    };
    const result = resolve(integerKeys, registry);
    expect(result.diagnostics).toEqual([]);
    expect(result.agents.map((agent) => agent.hostAgentId)).toEqual([
      "2",
      "10",
      "alpha",
    ]);
  });

  // @atlante/schema restricts `values` to strings, so this can only happen for
  // a document assembled by hand that bypassed that validation — the resolver
  // must still turn it into a diagnostic rather than emit `one,two` or
  // `[object Object]` into a rendered prompt.
  test("returns a diagnostic instead of stringifying a non-string values reference", () => {
    const handBuilt = {
      $schema: SCHEMA_URI,
      values: { list: ["one", "two"] },
      agents: {
        a: { identity: "{{values.list}}", mission: "y" },
      },
    } as unknown as AtlanteDocument;
    const result = resolve(handBuilt, registry);
    expect(result.agents).toEqual([]);
    expect(result.diagnostics[0]?.code).toBe("template-render-failed");
    expect(result.diagnostics[0]?.message).toContain("values.list");
  });
});
