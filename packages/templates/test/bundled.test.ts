import { describe, expect, test } from "bun:test";
import {
  loadBundledTemplates,
  renderTemplate,
  slotsOf,
  walkComposition,
} from "../src/index.js";

describe("bundled templates", () => {
  test("load without errors", () => {
    const { registry, errors } = loadBundledTemplates();
    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual([
      "atlante/agent",
      "atlante/artifact",
      "atlante/check",
      "atlante/constraints",
      "atlante/gotchas",
      "atlante/instructions",
      "atlante/markdown",
      "atlante/skill",
      "atlante/task",
      "atlante/workflow",
    ]);
  });

  test("composes reusable skill section templates under ordered sections", () => {
    const { registry, errors } = loadBundledTemplates();
    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual([
      "atlante/agent",
      "atlante/artifact",
      "atlante/check",
      "atlante/constraints",
      "atlante/gotchas",
      "atlante/instructions",
      "atlante/markdown",
      "atlante/skill",
      "atlante/task",
      "atlante/workflow",
    ]);

    const skill = registry.get("atlante/skill");
    if (!skill) throw new Error("bundled skill template is missing");
    expect(
      slotsOf(skill.inputSchema).map(({ templateId, path, arrayItems }) => ({
        templateId,
        path,
        arrayItems,
      })),
    ).toEqual([
      {
        templateId: "atlante/markdown",
        path: ["sections", "items", "oneOf", "0", "markdown"],
        arrayItems: true,
      },
      {
        templateId: "atlante/instructions",
        path: ["sections", "items", "oneOf", "1", "instructions"],
        arrayItems: true,
      },
      {
        templateId: "atlante/gotchas",
        path: ["sections", "items", "oneOf", "2", "gotchas"],
        arrayItems: true,
      },
      {
        templateId: "atlante/workflow",
        path: ["sections", "items", "oneOf", "3", "workflow"],
        arrayItems: true,
      },
      {
        templateId: "atlante/constraints",
        path: ["sections", "items", "oneOf", "4", "constraints"],
        arrayItems: true,
      },
    ]);
    expect(walkComposition(registry, "atlante/skill")).toEqual([]);
  });

  test("supports ordered composable sections in agent prompts", () => {
    const { registry, errors } = loadBundledTemplates();
    expect(errors).toEqual([]);
    const agent = registry.get("atlante/agent");
    if (!agent) throw new Error("bundled agent template is missing");

    expect(
      slotsOf(agent.inputSchema).map(({ templateId, path, arrayItems }) => ({
        templateId,
        path,
        arrayItems,
      })),
    ).toEqual([
      {
        templateId: "atlante/markdown",
        path: ["sections", "items", "oneOf", "0", "markdown"],
        arrayItems: true,
      },
      {
        templateId: "atlante/instructions",
        path: ["sections", "items", "oneOf", "1", "instructions"],
        arrayItems: true,
      },
      {
        templateId: "atlante/gotchas",
        path: ["sections", "items", "oneOf", "3", "gotchas"],
        arrayItems: true,
      },
      {
        templateId: "atlante/constraints",
        path: ["sections", "items", "oneOf", "4", "constraints"],
        arrayItems: true,
      },
    ]);
  });

  test("renders skill title, overview, and Markdown sections", () => {
    const { registry } = loadBundledTemplates();
    expect(
      renderTemplate({
        registry,
        templateId: "atlante/skill",
        input: {
          title: "Testing",
          overview: "Run the test suite.",
          sections: [{ markdown: "Use `bun test` to verify the change." }],
        },
      }),
    ).toBe(
      "# Testing\n\n## Overview\n\nRun the test suite.\n\nUse `bun test` to verify the change.\n",
    );
  });

  test("renders default instruction and gotcha labels and descriptions", () => {
    const { registry } = loadBundledTemplates();
    expect(
      renderTemplate({
        registry,
        templateId: "atlante/skill",
        input: {
          title: "Testing",
          overview: "Run the test suite.",
          sections: [
            { instructions: ["Read the brief.", "Run the checks."] },
            { gotchas: ["Do not skip validation."] },
          ],
        },
      }),
    ).toBe(
      "# Testing\n\n## Overview\n\nRun the test suite.\n\n## Instructions\n\nThese are required actions for completing the work. Perform them in order unless a constraint or explicit developer direction requires otherwise.\n\n1. Read the brief.\n1. Run the checks.\n\n## Gotchas\n\nThese are risks and failure modes that require active attention. Account for each one while working; do not dismiss one because the task appears straightforward.\n\n- Do not skip validation.\n",
    );
  });

  test("renders reusable constraints sections in skills", () => {
    const { registry } = loadBundledTemplates();
    expect(
      renderTemplate({
        registry,
        templateId: "atlante/skill",
        input: {
          title: "Planning",
          overview: "Plan before acting.",
          sections: [
            { constraints: ["Wait for approval.", "Keep scope focused."] },
          ],
        },
      }),
    ).toBe(
      "# Planning\n\n## Overview\n\nPlan before acting.\n\n## Constraints\n\nThese are non-negotiable limits on how you may act. Follow every constraint throughout your work; do not treat them as suggested outcomes or trade them off for convenience.\n\n- Wait for approval.\n- Keep scope focused.\n",
    );
  });

  test("preserves mixed oneOf section order", () => {
    const { registry } = loadBundledTemplates();
    expect(
      renderTemplate({
        registry,
        templateId: "atlante/skill",
        input: {
          title: "Ordered",
          overview: "Keep every section in source order.",
          sections: [
            { markdown: "First." },
            { gotchas: ["Second."] },
            { instructions: ["Third."] },
            { markdown: "Fourth." },
          ],
        },
      }),
    ).toBe(
      "# Ordered\n\n## Overview\n\nKeep every section in source order.\n\nFirst.\n\n## Gotchas\n\nThese are risks and failure modes that require active attention. Account for each one while working; do not dismiss one because the task appears straightforward.\n\n- Second.\n\n## Instructions\n\nThese are required actions for completing the work. Perform them in order unless a constraint or explicit developer direction requires otherwise.\n\n1. Third.\n\nFourth.\n",
    );
  });

  test("render a full agent prompt", () => {
    const { registry } = loadBundledTemplates();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/agent",
      input: {
        identity: "You are a code reviewer.",
        mission: "Find defects before they merge.",
        sections: [
          {
            responsibilities: ["Read the diff.", "Report findings."],
          },
          {
            constraints: ["Never edit files."],
          },
          { markdown: "Review the changed files." },
        ],
      },
    });
    expect(prompt).toMatchSnapshot();
  });

  test("render a minimal agent prompt without optional sections", () => {
    const { registry } = loadBundledTemplates();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/agent",
      input: { identity: "You are an assistant.", mission: "Help." },
    });
    expect(prompt).toMatchSnapshot();
    expect(prompt).not.toContain("# Workflow");
    expect(prompt).not.toContain("# Responsibilities");
  });

  test("renders one-based workflow phase labels and optional task wording", () => {
    const { registry } = loadBundledTemplates();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        phases: [
          {
            name: "Discovery",
            tasks: [
              {
                name: "Inspect",
                description: "Inspect the repository.",
                needs: ["Plan"],
              },
            ],
          },
          {
            name: "Delivery",
            tasks: [{ name: "Implement", description: "Make the change." }],
          },
        ],
      },
    });

    expect(prompt).toContain("### 1. Discovery");
    expect(prompt).toContain("### 2. Delivery");
    expect(prompt).not.toContain("### 0.");
    expect(prompt).toContain("Tasks may specify the responsible agent");
    expect(prompt).toContain("depends on those tasks' outputs");
    expect(prompt).toContain("the output of task 'Plan'");
    expect(prompt).not.toContain("task 'Plan's output");
  });
});
