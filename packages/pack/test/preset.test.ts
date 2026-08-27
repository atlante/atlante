import {
  createProjectResourcePack,
  interpolateValues,
  type JsonObject,
  loadPresetFacet,
  renderResolvedTemplate,
  resolveResourceInstance,
} from "@atlante/resources";
import { validateDocumentText } from "@atlante/validator";
import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  packResourceFixture,
} from "./selection-fixture.js";

const expectedSkillOrder = [
  "brainstorming",
  "workflow",
  "brainstorm",
  "plan",
  "build",
  "review",
] as const;

const focusedSkillLandmarks: Record<string, readonly string[]> = {
  brainstorm: ["Ask exactly one question at a time"],
  plan: [".atlante/workflows/<cycle-id>/plan.md"],
  build: [".atlante/workflows/<cycle-id>/tasks/<task-id>/brief-<n>.md"],
  review: [
    ".atlante/workflows/<cycle-id>/tasks/<task-id>/review-<n>.md",
    ".atlante/workflows/<cycle-id>/final-review-<n>.md",
  ],
};

interface PresetContext {
  readonly document: JsonObject;
  renderBinding(id: string): string;
}

function firstPartyPreset(): PresetContext {
  const { root, config } = packResourceFixture();
  const pack = createProjectResourcePack(root);
  const document = loadPresetFacet(pack, "@atlante/pack", config).facet
    .document;
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    (document.values ?? {}) as JsonObject,
  ))
    if (typeof value === "string") values[key] = value;
  return {
    document,
    renderBinding(id) {
      const binding = (document.skills?.[id] ?? {}) as JsonObject;
      const { $instance } = binding;
      expect(typeof $instance, `binding ${id} $instance`).toBe("string");
      const instance = resolveResourceInstance(
        pack,
        $instance as string,
        config,
      );
      return renderResolvedTemplate({
        template: instance.effectiveTemplate,
        input: interpolateValues(instance.input, values),
      });
    },
  };
}

describe("first-party preset intermediate six-skill surface", () => {
  afterEach(cleanupPackResourceFixtures);

  test("keeps one architect agent and exposes the skills in the authored intermediate order", () => {
    const { document } = firstPartyPreset();

    expect(Object.keys(document.agents)).toEqual(["architect"]);
    expect(Object.keys(document.skills)).toEqual([...expectedSkillOrder]);
  });

  test("validates the authored preset document against the user configuration schema", () => {
    const { root, config } = packResourceFixture();
    const source = loadPresetFacet(
      createProjectResourcePack(root),
      "@atlante/pack",
      config,
    );
    const result = validateDocumentText(
      JSON.stringify(source.facet.document),
      config,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.document).toBeDefined();
  });

  test("resolves and renders every bound skill through real resource composition with its structural landmarks", () => {
    const { renderBinding } = firstPartyPreset();

    for (const id of expectedSkillOrder) {
      const output = renderBinding(id);

      expect(output.trim(), id).toMatch(/^# \S/);
      expect(output, id).toContain("## Overview");
      for (const landmark of focusedSkillLandmarks[id] ?? [])
        expect(output, `${id}: ${landmark}`).toContain(landmark);
    }
  });

  test("leaves legacy brainstorming and workflow resolving and rendering untouched", () => {
    const { renderBinding } = firstPartyPreset();

    const brainstorming = renderBinding("brainstorming");
    expect(brainstorming).toContain("# Brainstorming");
    expect(brainstorming).toContain("## Instructions");
    expect(brainstorming).toContain("## Invariants");

    const workflow = renderBinding("workflow");
    for (const marker of [
      "# Workflow",
      "### Workflow: read-only orchestration",
      "### 1. plan",
      "### 2. build",
      "### 3. review",
    ])
      expect(workflow).toContain(marker);
  });
});
