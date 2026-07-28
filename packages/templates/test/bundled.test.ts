import { describe, expect, test } from "bun:test";
import { loadBundledTemplates, renderTemplate } from "../src/index.js";

describe("bundled templates", () => {
  test("load without errors", () => {
    const { registry, errors } = loadBundledTemplates();
    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual([
      "atlante/agent",
      "atlante/skill",
      "atlante/workflow",
    ]);
  });

  test("loads the bundled skill template", () => {
    const { registry, errors } = loadBundledTemplates();
    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual([
      "atlante/agent",
      "atlante/skill",
      "atlante/workflow",
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
            { instructions: { steps: ["Read the brief.", "Run the checks."] } },
            { gotchas: { items: ["Do not skip validation."] } },
          ],
        },
      }),
    ).toBe(
      "# Testing\n\n## Overview\n\nRun the test suite.\n\n## Instructions\n\nFollow these steps in order.\n\n1. Read the brief.\n1. Run the checks.\n\n## Gotchas\n\nWatch for these common mistakes.\n\n- Do not skip validation.\n",
    );
  });

  test("renders custom labels and descriptions in section order", () => {
    const { registry } = loadBundledTemplates();
    expect(
      renderTemplate({
        registry,
        templateId: "atlante/skill",
        input: {
          title: "Releasing",
          overview: "Prepare a release.",
          sections: [
            { markdown: "Keep the release repeatable." },
            {
              instructions: {
                title: "Checklist",
                description: "Complete each item.",
                steps: ["Update the changelog."],
              },
            },
            {
              gotchas: {
                title: "Risks",
                description: "Avoid these failures.",
                items: ["Do not publish early."],
              },
            },
            { markdown: "Document the outcome." },
          ],
        },
      }),
    ).toBe(
      "# Releasing\n\n## Overview\n\nPrepare a release.\n\nKeep the release repeatable.\n\n## Checklist\n\nComplete each item.\n\n1. Update the changelog.\n\n## Risks\n\nAvoid these failures.\n\n- Do not publish early.\n\nDocument the outcome.\n",
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
        responsibilities: ["Read the diff.", "Report findings."],
        constraints: ["Never edit files."],
        workflow: { steps: ["Read the diff.", "Report findings."] },
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
});
