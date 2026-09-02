import { describe, expect, test } from "bun:test";
import {
  atlanteDocumentSchema,
  EVAL_BUDGET_DEFAULTS,
  EVAL_SCENARIO_SCHEMA_URI,
  evalConfigSchema,
  evalScenarioJsonSchema,
  evalScenarioSchema,
  SCHEMA_URI,
} from "../src/index.js";

const validConfig = {
  host: "opencode",
  scenarios: "eval/scenarios/*.eval.jsonc",
} as const;

const validScenario = {
  $schema: EVAL_SCENARIO_SCHEMA_URI,
  version: "0.1",
  name: "add-endpoint",
  task: {
    fixture: "eval/fixtures/api",
    prompt: "Add a DELETE /users/:id endpoint.",
  },
  checks: [
    { type: "command", run: ["bun", "test"] },
    {
      type: "file-contains",
      path: "src/routes/users.ts",
      pattern: "requireAdmin",
    },
    { type: "diff-allowlist", allow: ["src/routes/users.ts"] },
  ],
} as const;

describe("evalConfigSchema", () => {
  test("accepts a minimal config section", () => {
    const result = evalConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  test("rejects an unknown host", () => {
    const result = evalConfigSchema.safeParse({
      ...validConfig,
      host: "claude",
    });
    expect(result.success).toBe(false);
  });

  test("rejects an empty scenarios glob", () => {
    const result = evalConfigSchema.safeParse({
      ...validConfig,
      scenarios: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown properties", () => {
    const result = evalConfigSchema.safeParse({
      ...validConfig,
      parallel: true,
    });
    expect(result.success).toBe(false);
  });

  test("applies budget defaults to a partial budget", () => {
    const result = evalConfigSchema.parse({
      ...validConfig,
      budget: { timeoutMs: 300_000 },
    });
    expect(result.budget).toEqual({
      ...EVAL_BUDGET_DEFAULTS,
      timeoutMs: 300_000,
    });
  });

  test("rejects a zero or negative budget value", () => {
    for (const budget of [
      { trials: 0 },
      { timeoutMs: -1 },
      { maxSessions: 0 },
      { maxTokens: 1.5 },
    ]) {
      const result = evalConfigSchema.safeParse({ ...validConfig, budget });
      expect(result.success).toBe(false);
    }
  });
});

describe("evalScenarioSchema", () => {
  test("accepts a valid scenario", () => {
    const result = evalScenarioSchema.safeParse(validScenario);
    expect(result.success).toBe(true);
  });

  test("applies command check defaults", () => {
    const result = evalScenarioSchema.parse({
      ...validScenario,
      checks: [{ type: "command", run: ["bun", "test"] }],
    });
    const check = result.checks[0];
    if (check.type !== "command") throw new Error("expected command check");
    expect(check.expectExit).toBe(0);
    expect(check.timeoutMs).toBe(120_000);
  });

  test("rejects a wrong $schema URI", () => {
    const result = evalScenarioSchema.safeParse({
      ...validScenario,
      $schema: SCHEMA_URI,
    });
    expect(result.success).toBe(false);
  });

  test("rejects a wrong version", () => {
    const result = evalScenarioSchema.safeParse({
      ...validScenario,
      version: "1.0",
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid scenario names", () => {
    for (const name of ["Add Endpoint", "UPPER", "-leading", "a_b", ""]) {
      const result = evalScenarioSchema.safeParse({ ...validScenario, name });
      expect(result.success).toBe(false);
    }
  });

  test("rejects an empty prompt", () => {
    const result = evalScenarioSchema.safeParse({
      ...validScenario,
      task: { ...validScenario.task, prompt: "" },
    });
    expect(result.success).toBe(false);
  });

  test("rejects empty check arrays", () => {
    const result = evalScenarioSchema.safeParse({
      ...validScenario,
      checks: [],
    });
    expect(result.success).toBe(false);
  });

  test("rejects unknown check types via the discriminated union", () => {
    const result = evalScenarioSchema.safeParse({
      ...validScenario,
      checks: [{ type: "llm-judge", model: "x" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects command checks with empty argv", () => {
    const result = evalScenarioSchema.safeParse({
      ...validScenario,
      checks: [{ type: "command", run: [] }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects invalid outputMatches regex sources", () => {
    const result = evalScenarioSchema.safeParse({
      ...validScenario,
      checks: [
        { type: "command", run: ["bun", "test"], outputMatches: "([unclosed" },
      ],
    });
    expect(result.success).toBe(false);
  });

  test("rejects diff allowlists without entries", () => {
    const result = evalScenarioSchema.safeParse({
      ...validScenario,
      checks: [{ type: "diff-allowlist", allow: [] }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects unsafe paths in fixtures and checks", () => {
    for (const fixture of [
      "/absolute/fixture",
      "../outside/fixture",
      "fixture/.git/config",
      "fixture/node_modules/pkg",
      "trailing/",
    ]) {
      const result = evalScenarioSchema.safeParse({
        ...validScenario,
        task: { ...validScenario.task, fixture },
      });
      expect(result.success).toBe(false);
    }
    for (const path of [
      "/abs/path.ts",
      "../outside.ts",
      ".git/config",
      "node_modules/x.ts",
    ]) {
      const result = evalScenarioSchema.safeParse({
        ...validScenario,
        checks: [{ type: "file-unchanged", path }],
      });
      expect(result.success).toBe(false);
    }
  });

  test("commits the same lexical path restrictions in JSON Schema", () => {
    const task = (evalScenarioJsonSchema.properties as Record<string, unknown>)
      .task as { properties: Record<string, { pattern?: string }> };
    const pattern = task.properties.fixture.pattern;
    expect(typeof pattern).toBe("string");
    const pathPattern = new RegExp(pattern ?? "");
    expect(pathPattern.test("src/fixture")).toBe(true);
    for (const path of [
      "/absolute",
      "../outside",
      ".git/config",
      "a/",
      "dir\\..\\outside",
      "dir\\",
      "dir\u0000name",
    ]) {
      expect(pathPattern.test(path)).toBe(false);
    }
  });

  test("accepts scenario-level budget override", () => {
    const result = evalScenarioSchema.safeParse({
      ...validScenario,
      budget: { timeoutMs: 300_000 },
    });
    expect(result.success).toBe(true);
  });
});

describe("atlanteDocumentSchema eval section", () => {
  test("accepts a document carrying an eval section", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      eval: validConfig,
    });
    expect(result.success).toBe(true);
  });

  test("propagates eval section validation failures", () => {
    const result = atlanteDocumentSchema.safeParse({
      $schema: SCHEMA_URI,
      eval: { ...validConfig, scenarios: "" },
    });
    expect(result.success).toBe(false);
  });
});
