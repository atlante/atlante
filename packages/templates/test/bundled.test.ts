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
      "atlante/constraints",
      "atlante/gotchas",
      "atlante/instructions",
      "atlante/markdown",
      "atlante/skill",
      "atlante/workflow",
    ]);
  });

  test("composes reusable skill section templates under ordered sections", () => {
    const { registry, errors } = loadBundledTemplates();
    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual([
      "atlante/agent",
      "atlante/artifact",
      "atlante/constraints",
      "atlante/gotchas",
      "atlante/instructions",
      "atlante/markdown",
      "atlante/skill",
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
      "# Testing\n\n## Overview\n\nRun the test suite.\n\n## Instructions\n\nThese are required actions for completing the work. Perform them in order unless a constraint or explicit developer direction requires otherwise.\n\n1. Read the brief.\n2. Run the checks.\n\n## Gotchas\n\nThese are risks and failure modes that require active attention. Account for each one while working; do not dismiss one because the task appears straightforward.\n\n- Do not skip validation.\n",
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

  test("renders sequential phases with inline instructions and validation", () => {
    const { registry } = loadBundledTemplates();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        phases: [
          {
            name: "Discovery",
            instructions: [
              "Inspect the repository.",
              "Read the project guidance.",
            ],
            output: { description: "The discovery result." },
            validation: "Confirm the context is complete. Run `bun test`.",
          },
          {
            name: "Delivery",
            instructions: ["Make the change."],
          },
        ],
      },
    });

    expect(prompt).toContain("### 1. Discovery");
    expect(prompt).toContain("### 2. Delivery");
    expect(prompt).not.toContain("### 0.");
    expect(prompt).toContain("Execute phases sequentially in the order listed");
    expect(prompt).toContain("Inspect the repository.");
    expect(prompt).toContain("1. Inspect the repository.");
    expect(prompt).toContain("2. Read the project guidance.");
    expect(prompt).toContain("Phase output: The discovery result.");
    expect(prompt).toContain(
      "Phase validation: Confirm the context is complete. Run `bun test`.",
    );
    expect(prompt).not.toContain("## Instructions");
    expect(prompt).not.toContain("Check after task");
    expect(prompt.indexOf("Inspect the repository.")).toBeLessThan(
      prompt.indexOf("Phase output: The discovery result."),
    );
    expect(prompt.indexOf("Phase output: The discovery result.")).toBeLessThan(
      prompt.indexOf("Phase validation: Confirm the context is complete."),
    );
    expect(prompt).not.toContain("depends on");
    expect(prompt).not.toContain("task 'Plan'");
  });

  test("renders enabled workflow and phase policies", () => {
    const { registry } = loadBundledTemplates();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        policies: { orchestratorReadOnly: true },
        phases: [
          {
            kind: "build",
            name: "Execute",
            policies: { commit: true, review: true, maxLoops: 5 },
            output: {
              description: "The implementation result.",
              updateable: true,
            },
            instructions: ["Make the change."],
          },
        ],
      },
    });

    expect(prompt).toContain(
      "Workflow policy: the orchestrator is read-only and delegates every file edit.",
    );
    expect(prompt).toContain(
      "Phase policy: commit task implementation and corrections separately.",
    );
    expect(prompt).toContain(
      "Phase policy: apply task review according to this phase's review criteria.",
    );
    expect(prompt).not.toContain("review after each task");
    expect(prompt).toContain(
      "Phase policy: limit correction to 5 loops per task.",
    );
    expect(prompt).toContain(
      "This output is a living artifact that later phases may revisit and update, looping back when needed.",
    );
  });

  test("omits disabled and absent workflow policies", () => {
    const { registry } = loadBundledTemplates();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        policies: { orchestratorReadOnly: false },
        phases: [
          {
            name: "Execute",
            policies: { commit: false, review: false },
            output: { description: "The implementation result." },
            instructions: ["Make the change."],
          },
          { name: "Deliver", instructions: ["Deliver the result."] },
        ],
      },
    });

    expect(prompt).not.toContain("Workflow policy:");
    expect(prompt).not.toContain("Phase policy:");
    expect(prompt).not.toContain("living artifact");
    expect(prompt).toContain("Execute phases sequentially in the order listed");
    expect(prompt.indexOf("### 1. Execute")).toBeLessThan(
      prompt.indexOf("### 2. Deliver"),
    );
  });

  test("renders phase-level subagent delegation without task-level routing", () => {
    const { registry } = loadBundledTemplates();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        phases: [
          {
            name: "Plan",
            instructions: ["Plan the change."],
          },
          {
            name: "Execute",
            subagent: "implement",
            instructions: ["Make the change."],
          },
        ],
      },
    });

    expect(prompt).toContain(
      'The subagent "implement" should handle this phase.',
    );
    expect(prompt).not.toContain("The orchestrator handles this phase.");
    expect(prompt).not.toContain("should be used for this task.");
  });

  test("omits validation when a phase does not define one", () => {
    const { registry } = loadBundledTemplates();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        phases: [
          {
            name: "Delivery",
            instructions: ["Review the result."],
          },
        ],
      },
    });

    expect(prompt).not.toContain("Phase validation:");
  });
});
