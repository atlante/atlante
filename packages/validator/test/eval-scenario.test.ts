import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVAL_SCENARIO_SCHEMA_URI, evalScenarioSchema } from "@atlante/schema";
import { globFiles, globToRegExp } from "../src/glob.js";
import { discoverEvalScenarios } from "../src/index.js";

const fixturesRoot = join(import.meta.dir, "fixtures", "eval");
const _scenariosDir = join(fixturesRoot, "scenarios");

describe("glob", () => {
  test("matches single-star within a segment only", () => {
    const regex = globToRegExp("eval/*/*.eval.jsonc");
    expect(regex.test("eval/scenarios/a.eval.jsonc")).toBe(true);
    expect(regex.test("eval/scenarios/nested/a.eval.jsonc")).toBe(false);
    expect(regex.test("eval/a.eval.jsonc")).toBe(false);
  });

  test("matches double-star across zero or more segments", () => {
    const regex = globToRegExp("eval/**/*.eval.jsonc");
    expect(regex.test("eval/a.eval.jsonc")).toBe(true);
    expect(regex.test("eval/scenarios/a.eval.jsonc")).toBe(true);
    expect(regex.test("eval/scenarios/nested/a.eval.jsonc")).toBe(true);
    expect(regex.test("eval/scenarios/a.json")).toBe(false);
  });

  test("matches descendants when double-star is the final segment", () => {
    const regex = globToRegExp("eval/**");
    expect(regex.test("eval/a.eval.json")).toBe(true);
    expect(regex.test("eval/scenarios/a.eval.json")).toBe(true);
  });

  test("escapes literal regex characters", () => {
    const regex = globToRegExp("eval/scenarios/a+b.eval.jsonc");
    expect(regex.test("eval/scenarios/a+b.eval.jsonc")).toBe(true);
    expect(regex.test("eval/scenarios/aXb.eval.jsonc")).toBe(false);
  });

  test("globFiles matches scenarios and skips .git and node_modules", () => {
    const matched = globFiles(fixturesRoot, "scenarios/*.eval.jsonc");
    expect(matched).toContain("scenarios/alpha.eval.jsonc");
    expect(matched.some((path) => path.includes("node_modules"))).toBe(false);
    expect(matched).toEqual([...matched].sort());
  });

  test("globFiles keeps a literal pattern only when it names a file", () => {
    expect(globFiles(fixturesRoot, "scenarios/alpha.eval.jsonc")).toEqual([
      "scenarios/alpha.eval.jsonc",
    ]);
    expect(globFiles(fixturesRoot, "scenarios/missing.eval.jsonc")).toEqual([]);
  });
});

describe("discoverEvalScenarios", () => {
  test("discovers, validates, and sorts scenarios by name", () => {
    // alpha + beta + duplicate (name clash) + bad-fixture are matched;
    // wrong-schema and invalid are matched but fail validation.
    const result = discoverEvalScenarios(fixturesRoot, "scenarios/*");
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("unsupported-schema");
    expect(codes).toContain("invalid-eval-scenario");
    expect(codes).toContain("duplicate-scenario-name");
    expect(codes).toContain("invalid-scenario-fixture");
    const names = result.scenarios.map(({ scenario }) => scenario.name);
    expect(names).toContain("alpha-scenario");
    expect(names).toEqual([...names].sort());
  });

  test("attaches project-relative sources", () => {
    const result = discoverEvalScenarios(
      fixturesRoot,
      "scenarios/alpha.eval.jsonc",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]?.source).toBe("scenarios/alpha.eval.jsonc");
    expect(result.scenarios[0]?.scenario.checks.length).toBe(2);
  });

  test("rejects empty match sets with recovery guidance", () => {
    const result = discoverEvalScenarios(
      fixturesRoot,
      "scenarios/none/*.jsonc",
    );
    expect(result.scenarios).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.code).toBe("empty-scenario-glob");
    expect(result.diagnostics[0]?.next).toBeDefined();
  });

  test("rejects absolute and traversal globs", () => {
    for (const pattern of ["/abs/**/*.jsonc", "../outside/*.jsonc"]) {
      const result = discoverEvalScenarios(fixturesRoot, pattern);
      expect(result.scenarios).toEqual([]);
      expect(result.diagnostics[0]?.code).toBe("invalid-scenario-glob");
    }
  });

  test("rejects fixture symlinks that could escape the project", () => {
    const project = mkdtempSync(join(tmpdir(), "eval-scenario-project-"));
    const outside = mkdtempSync(join(tmpdir(), "eval-scenario-outside-"));
    try {
      mkdirSync(join(project, "scenarios"), { recursive: true });
      mkdirSync(join(outside, "fixture"), { recursive: true });
      symlinkSync(join(outside, "fixture"), join(project, "fixture"), "dir");
      writeFileSync(
        join(project, "scenarios", "symlink.eval.json"),
        `${JSON.stringify({
          $schema: EVAL_SCENARIO_SCHEMA_URI,
          version: "0.1",
          name: "symlink-fixture",
          task: { fixture: "fixture", prompt: "p" },
          checks: [{ type: "file-exists", path: "src/index.ts" }],
        })}\n`,
      );

      const result = discoverEvalScenarios(project, "scenarios/*.json");
      expect(result.scenarios).toEqual([]);
      expect(result.diagnostics[0]?.code).toBe("invalid-scenario-fixture");
      expect(result.diagnostics[0]?.message).toContain("symbolic link");
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects fixture paths with symlinked ancestors", () => {
    const project = mkdtempSync(join(tmpdir(), "eval-scenario-project-"));
    const outside = mkdtempSync(join(tmpdir(), "eval-scenario-outside-"));
    try {
      mkdirSync(join(project, "scenarios"), { recursive: true });
      mkdirSync(join(outside, "fixture"), { recursive: true });
      symlinkSync(outside, join(project, "link"), "dir");
      writeFileSync(
        join(project, "scenarios", "ancestor-link.eval.json"),
        `${JSON.stringify({
          $schema: EVAL_SCENARIO_SCHEMA_URI,
          version: "0.1",
          name: "ancestor-link",
          task: { fixture: "link/fixture", prompt: "p" },
          checks: [{ type: "file-exists", path: "src/index.ts" }],
        })}\n`,
      );

      const result = discoverEvalScenarios(
        project,
        "scenarios/ancestor-link.eval.json",
      );
      expect(result.scenarios).toEqual([]);
      expect(result.diagnostics[0]?.code).toBe("invalid-scenario-fixture");
      expect(result.diagnostics[0]?.message).toContain("symbolic link");
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects NUL characters in fixture paths", () => {
    const project = mkdtempSync(join(tmpdir(), "eval-scenario-project-"));
    try {
      mkdirSync(join(project, "scenarios", "fixture"), { recursive: true });
      writeFileSync(
        join(project, "scenarios", "nul.eval.json"),
        `${JSON.stringify({
          $schema: EVAL_SCENARIO_SCHEMA_URI,
          version: "0.1",
          name: "nul-path",
          task: { fixture: "scenarios/fixture\u0000", prompt: "p" },
          checks: [{ type: "file-exists", path: "src/index.ts" }],
        })}\n`,
      );

      const result = discoverEvalScenarios(project, "scenarios/nul.eval.json");
      expect(result.scenarios).toEqual([]);
      expect(result.diagnostics[0]?.code).toBe("invalid-eval-scenario");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("rejects regular files named like forbidden fixture directories", () => {
    const project = mkdtempSync(join(tmpdir(), "eval-scenario-project-"));
    try {
      mkdirSync(join(project, "scenarios", "fixture"), { recursive: true });
      writeFileSync(join(project, "scenarios", "fixture", ".git"), "not git");
      writeFileSync(
        join(project, "scenarios", "forbidden-file.eval.json"),
        `${JSON.stringify({
          $schema: EVAL_SCENARIO_SCHEMA_URI,
          version: "0.1",
          name: "forbidden-file",
          task: { fixture: "scenarios/fixture", prompt: "p" },
          checks: [{ type: "file-exists", path: "src/index.ts" }],
        })}\n`,
      );

      const result = discoverEvalScenarios(
        project,
        "scenarios/forbidden-file.eval.json",
      );
      expect(result.scenarios).toEqual([]);
      expect(result.diagnostics[0]?.code).toBe("invalid-scenario-fixture");
      expect(result.diagnostics[0]?.message).toContain(".git");
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("json scenario documents are parsed strictly", () => {
    const result = discoverEvalScenarios(
      fixturesRoot,
      "scenarios/beta.eval.json",
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.scenarios[0]?.scenario.budget).toEqual({ timeoutMs: 300000 });
  });
});

describe("eval scenario schema dispatch", () => {
  test("the committed scenario schema URI is the dispatch key", () => {
    // Guards against drift between the loader constant and the schema module.
    const result = evalScenarioSchema.safeParse({
      $schema: EVAL_SCENARIO_SCHEMA_URI,
      version: "0.1",
      name: "dispatch-check",
      task: { fixture: "f", prompt: "p" },
      checks: [{ type: "file-exists", path: "a.ts" }],
    });
    expect(result.success).toBe(true);
  });
});
