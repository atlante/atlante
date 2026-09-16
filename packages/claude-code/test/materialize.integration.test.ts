import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeCodeMaterializer } from "../src/materialize.js";

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

describe("claudeCodeMaterializer", () => {
  test("declares the Claude Code host target", () => {
    expect(claudeCodeMaterializer.host).toBe("claude-code");
  });

  test("materializes the prepared project and reports written paths", () => {
    const root = project();

    const outcome = claudeCodeMaterializer.materialize(root, prepared());

    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.writtenPaths).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/testing/SKILL.md",
    ]);
    expect(outcome.removedPaths).toEqual([]);
    expect(existsSync(join(root, ".claude", "agents", "reviewer.md"))).toBe(
      true,
    );
  });

  test("uses fixed Claude-native directories regardless of document options", () => {
    const root = project();
    // Document `options` outDirs are OpenCode-scoped: Claude Code discovers
    // agents and skills from `.claude/`, so the adapter never forwards them.
    const value = {
      ...prepared(),
      options: {
        agents: { outDir: "generated/agents" },
        skills: { outDir: "generated/skills" },
      },
    };

    const outcome = claudeCodeMaterializer.materialize(root, value);

    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.writtenPaths).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/testing/SKILL.md",
    ]);
  });

  test("is idempotent for unchanged output", () => {
    const root = project();
    claudeCodeMaterializer.materialize(root, prepared());

    const outcome = claudeCodeMaterializer.materialize(root, prepared());

    expect(outcome.writtenPaths).toEqual([]);
    expect(outcome.removedPaths).toEqual([]);
    expect(outcome.diagnostics).toEqual([]);
  });

  test("maps an unowned collision to an error diagnostic", () => {
    const root = project();
    const agentDirectory = join(root, ".claude", "agents");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(join(agentDirectory, "reviewer.md"), "user-authored\n");

    const outcome = claudeCodeMaterializer.materialize(root, prepared());

    expect(outcome.writtenPaths).toEqual([]);
    expect(outcome.diagnostics).toHaveLength(1);
    const diagnostic = outcome.diagnostics[0];
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.code).toBe("materialization-collision");
    expect(diagnostic.message).toContain(".claude/agents/reviewer.md");
    expect(diagnostic.next).toContain("unowned file");
  });

  test("maps a drifted owned target to an error diagnostic", () => {
    const root = project();
    claudeCodeMaterializer.materialize(root, prepared());
    writeFileSync(
      join(root, ".claude", "agents", "reviewer.md"),
      "manually changed\n",
    );

    const outcome = claudeCodeMaterializer.materialize(root, prepared());

    expect(outcome.diagnostics).toHaveLength(1);
    const diagnostic = outcome.diagnostics[0];
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.code).toBe("materialization-drift");
    expect(diagnostic.message).toContain(".claude/agents/reviewer.md");
    expect(diagnostic.next).toBeDefined();
  });

  test("maps an incompatible host ID to an error diagnostic without renaming", () => {
    const root = project();
    const value = prepared();
    value.agents[0].hostAgentId = "Bad_Name";

    const outcome = claudeCodeMaterializer.materialize(root, value);

    expect(outcome.diagnostics).toHaveLength(1);
    const diagnostic = outcome.diagnostics[0];
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.code).toBe("materialization-invalid-id");
    expect(diagnostic.message).toContain("Bad_Name");
    expect(diagnostic.next).toContain("never renames");
    expect(existsSync(join(root, ".claude"))).toBe(false);
  });

  test("plans without writing when dryRun is set", () => {
    const root = project();

    const outcome = claudeCodeMaterializer.materialize(root, prepared(), {
      dryRun: true,
    });

    expect(outcome.diagnostics).toEqual([]);
    expect(outcome.writtenPaths).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/testing/SKILL.md",
    ]);
    expect(outcome.removedPaths).toEqual([]);
    expect(existsSync(join(root, ".claude"))).toBe(false);
    expect(existsSync(join(root, ".atlante"))).toBe(false);
  });

  test("never reconciles another host's manifest or outputs", () => {
    const root = project();
    // Simulate a previous OpenCode materialization in the same project.
    mkdirSync(join(root, ".opencode", "agents"), { recursive: true });
    writeFileSync(
      join(root, ".opencode", "agents", "reviewer.md"),
      "opencode bytes\n",
    );
    mkdirSync(join(root, ".atlante"), { recursive: true });
    writeFileSync(
      join(root, ".atlante", "opencode-native.json"),
      `${JSON.stringify({ format: "atlante-opencode-native", version: 1, files: [] })}\n`,
    );

    const outcome = claudeCodeMaterializer.materialize(root, prepared());

    expect(outcome.diagnostics).toEqual([]);
    expect(
      readFileSync(join(root, ".opencode", "agents", "reviewer.md"), "utf8"),
    ).toBe("opencode bytes\n");
    expect(
      JSON.parse(
        readFileSync(join(root, ".atlante", "opencode-native.json"), "utf8"),
      ).format,
    ).toBe("atlante-opencode-native");
  });

  test("reports collision in dryRun without writing", () => {
    const root = project();
    const agentDirectory = join(root, ".claude", "agents");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(join(agentDirectory, "reviewer.md"), "user-authored\n");

    const outcome = claudeCodeMaterializer.materialize(root, prepared(), {
      dryRun: true,
    });

    expect(outcome.writtenPaths).toEqual([]);
    expect(outcome.diagnostics).toHaveLength(1);
    expect(outcome.diagnostics[0]?.code).toBe("materialization-collision");
    expect(existsSync(join(root, ".atlante", "claude-code-native.json"))).toBe(
      false,
    );
  });
});
