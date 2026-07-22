import { describe, expect, test } from "bun:test";
import { loadBundledTemplates, renderTemplate } from "../src/index.ts";

describe("bundled templates", () => {
  test("load without errors", () => {
    const { registry, errors } = loadBundledTemplates();
    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual(["atlante/agent", "atlante/workflow"]);
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
