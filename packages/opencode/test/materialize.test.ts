import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCodeMaterializer } from "../src/materialize.js";

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), "atlante-materialize-"));
  created.push(directory);
  return directory;
}

// Mirrors the builder's PreparedProject field names, including the extra
// template metadata the real prepared project carries.
function prepared() {
  return {
    agents: [
      {
        hostAgentId: "reviewer",
        templateId: "@atlante/pack/agent",
        description: "Reviews changes.",
        prompt: "Review the change.\n",
      },
    ],
    skills: [
      {
        skillId: "testing",
        templateId: "@atlante/pack/skill",
        description: "Testing guidance.",
        content: "Run the tests.\n",
      },
    ],
  };
}

describe("openCodeMaterializer", () => {
  test("declares the OpenCode host target", () => {
    expect(openCodeMaterializer.host).toBe("opencode");
  });

  test("materializes the prepared project and reports written paths", () => {
    const root = project();

    const outcome = openCodeMaterializer.materialize(root, prepared());

    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.writtenPaths).toEqual([
      ".opencode/agents/reviewer.md",
      ".opencode/skills/testing/SKILL.md",
    ]);
    expect(outcome.removedPaths).toEqual([]);
    expect(existsSync(join(root, ".opencode", "agents", "reviewer.md"))).toBe(
      true,
    );
  });

  test("is idempotent for unchanged output", () => {
    const root = project();
    openCodeMaterializer.materialize(root, prepared());

    const outcome = openCodeMaterializer.materialize(root, prepared());

    expect(outcome.writtenPaths).toEqual([]);
    expect(outcome.removedPaths).toEqual([]);
    expect(outcome.diagnostics).toEqual([]);
  });

  test("maps an unowned collision to an error diagnostic", () => {
    const root = project();
    const agentDirectory = join(root, ".opencode", "agents");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(join(agentDirectory, "reviewer.md"), "user-authored\n");

    const outcome = openCodeMaterializer.materialize(root, prepared());

    expect(outcome.writtenPaths).toEqual([]);
    expect(outcome.diagnostics).toHaveLength(1);
    const diagnostic = outcome.diagnostics[0];
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.code).toBe("materialization-collision");
    expect(diagnostic.message).toContain(".opencode/agents/reviewer.md");
    expect(diagnostic.next).toContain("unowned file");
  });

  test("maps a drifted owned target to an error diagnostic", () => {
    const root = project();
    openCodeMaterializer.materialize(root, prepared());
    writeFileSync(
      join(root, ".opencode", "agents", "reviewer.md"),
      "manually changed\n",
    );

    const outcome = openCodeMaterializer.materialize(root, prepared());

    expect(outcome.diagnostics).toHaveLength(1);
    const diagnostic = outcome.diagnostics[0];
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.code).toBe("materialization-drift");
    expect(diagnostic.message).toContain(".opencode/agents/reviewer.md");
    expect(diagnostic.next).toBeDefined();
  });

  test("maps an incompatible host ID to an error diagnostic without renaming", () => {
    const root = project();
    const value = prepared();
    value.agents[0].hostAgentId = "Bad_Name";

    const outcome = openCodeMaterializer.materialize(root, value);

    expect(outcome.diagnostics).toHaveLength(1);
    const diagnostic = outcome.diagnostics[0];
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.code).toBe("materialization-invalid-id");
    expect(diagnostic.message).toContain("Bad_Name");
    expect(diagnostic.next).toContain("never renames");
    expect(existsSync(join(root, ".opencode"))).toBe(false);
  });
});
