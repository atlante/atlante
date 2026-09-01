import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createProjectResourcePack,
  interpolateValues,
  type JsonObject,
  loadPresetFacet,
  ResourceResolutionError,
  renderResolvedTemplate,
  resolveResourceDocument,
  resolveResourceInstance,
  resolveResourceTemplate,
} from "@atlante/resources";
import {
  validateDocumentText,
  validateResolvedDocument,
} from "@atlante/validator";
import {
  cleanupPackResourceFixtures,
  packResourceFixture,
} from "./selection-fixture.js";

const expectedSkillOrder = ["brainstorm", "plan", "build", "review"] as const;

const focusedSkillLandmarks: Record<string, readonly string[]> = {
  brainstorm: ["Ask one focused question at a time"],
  plan: ["smallest independently actionable tasks"],
  build: ["Make the smallest implementation that satisfies the focused test"],
  review: ["`PASS` or `BLOCKED` verdict"],
};

interface PresetContext {
  readonly document: JsonObject;
  readonly pack: ReturnType<typeof createProjectResourcePack>;
  readonly config: string;
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
    pack,
    config,
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

function renderWorkflowTemplate(workflow: Record<string, unknown>): string {
  const { root, config } = packResourceFixture();
  return renderResolvedTemplate({
    template: resolveResourceTemplate(
      createProjectResourcePack(root),
      "@atlante/pack/workflow",
      config,
    ),
    input: workflow,
  });
}

describe("first-party preset surface", () => {
  afterEach(cleanupPackResourceFixtures);

  test("keeps exactly one architect agent and exposes the four public skills in authored order", () => {
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

  test("keeps the public skill bindings as locator-only while each instance owns its description", () => {
    const { pack, config, document } = firstPartyPreset();

    for (const id of expectedSkillOrder) {
      const binding = (document.skills?.[id] ?? {}) as JsonObject;
      expect(Object.keys(binding), `binding ${id}`).toEqual(["$instance"]);
      expect(binding.$instance, `binding ${id}`).toBe(`@atlante/pack/${id}`);

      const instance = resolveResourceInstance(
        pack,
        binding.$instance as string,
        config,
      );
      const { description } = instance.input;
      expect(typeof description, `instance ${id} description`).toBe("string");
      expect(
        (description as string).length,
        `instance ${id} description`,
      ).toBeGreaterThan(0);
      expect(
        instance.effectiveTemplate.locator,
        `instance ${id} template`,
      ).toBe("@atlante/pack/skill");
    }
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

  test("keeps the pack default values to project and workflow-root", () => {
    const { document } = firstPartyPreset();

    expect(document.values).toEqual({
      project: "{{sys.cwd.basename}}",
      "workflow-root": ".atlante/workflows",
    });
  });

  test("rejects the removed legacy brainstorming and workflow resources", () => {
    const { pack, config } = firstPartyPreset();

    for (const locator of [
      "@atlante/pack/brainstorming",
      "@atlante/pack/delivery-workflow",
    ]) {
      expect(() => resolveResourceInstance(pack, locator, config)).toThrow(
        ResourceResolutionError,
      );
    }
  });

  describe("concrete workflow template contract", () => {
    const approvedWorkflowPhases = [
      {
        name: "Brainstorm",
        instructions: ["Follow the `brainstorm` skill."],
        output: {
          description:
            "The agreed scope, direction, and success criteria when brainstorming is needed.",
        },
      },
      {
        name: "Plan",
        instructions: ["Follow the `plan` skill."],
        output: {
          description:
            "An actionable implementation plan when planning is needed.",
          filePath: "{{values.workflow-root}}/<cycle-id>/plan.md",
          updateable: true,
        },
      },
      {
        name: "Build",
        instructions: [
          "Follow the `build` skill for each implementation task.",
          "Keep each task in its own explicit, reviewable change boundary, using a project-approved checkpoint mechanism when available.",
        ],
        output: {
          description:
            "The requested change with its validation evidence when implementation is needed.",
        },
      },
      {
        name: "Review",
        instructions: [
          "Follow the `review` skill for the boundary being reviewed.",
          "Use task review after each implementation task, before starting any task that depends on it; review is the default after implementation, run with independent judgment in a fresh context (a sub-agent when the host supports delegation) rather than as self-review by the implementing agent. Omit it only for a change that is trivially mechanical with no behavioral risk and not a dependency of subsequent tasks, and state the omission reason explicitly. Return valid corrections to Build and stop after at most five Build-Review correction rounds for that task.",
          "Use final review after all implementation tasks when the change set spans multiple tasks, touches integration boundaries between tasks, or any task review was omitted.",
        ],
        output: {
          description:
            "An evidence-based verdict for the task or complete change being reviewed.",
          filePath:
            "{{values.workflow-root}}/<cycle-id>/reviews/<scope>-<n>.md",
        },
      },
    ] as const;

    function inlineWorkflowDiagnostics(
      workflow: Record<string, unknown>,
    ): readonly string[] {
      const { root, config } = packResourceFixture();
      writeFileSync(
        join(root, "atlante.jsonc"),
        `${JSON.stringify({
          extends: "@atlante/pack",
          agents: {
            reviewer: {
              $template: "@atlante/pack/agent",
              description: "Reviews the change.",
              identity: "You review.",
              mission: "Find defects.",
              sections: [{ workflow }],
            },
          },
        })}\n`,
      );
      const document = resolveResourceDocument({
        pack: createProjectResourcePack(root),
        rootFile: config,
        bindingCollections: [
          {
            key: "agents",
            subject: "agent",
            defaultTemplate: "@atlante/pack/agent",
          },
        ],
      });
      return validateResolvedDocument(document).map(
        (diagnostic) => diagnostic.code,
      );
    }

    test("renders the canonical workflow identically in agents and skills", () => {
      const { root, config } = packResourceFixture();
      const pack = createProjectResourcePack(root);
      const workflow = {
        phases: [{ name: "Plan", instructions: ["Plan the review."] }],
      };
      const agentOutput = renderResolvedTemplate({
        template: resolveResourceTemplate(pack, "@atlante/pack/agent", config),
        input: {
          identity: "Identity",
          mission: "Mission",
          sections: [{ workflow }],
        },
      });
      const skillOutput = renderResolvedTemplate({
        template: resolveResourceTemplate(pack, "@atlante/pack/skill", config),
        input: {
          title: "Review skill",
          overview: "Review the change.",
          sections: [{ workflow }],
        },
      });
      const workflowStart = "## Workflow";

      expect(agentOutput.slice(agentOutput.indexOf(workflowStart))).toBe(
        skillOutput.slice(skillOutput.indexOf(workflowStart)),
      );
    });

    test("renders the neutral workflow prose with ordered numbered phases", () => {
      const output = renderWorkflowTemplate({
        phases: [
          { name: "Brainstorm", instructions: ["Ask first.", "Then decide."] },
          { name: "Build", instructions: ["Build the change."] },
        ],
      });

      expect(output).toContain("## Workflow");
      expect(output).toContain(
        "The phases below describe the available workflow in their configured order.",
      );
      expect(output).toContain(
        "### 1. Brainstorm\n\n1. Ask first.\n\n2. Then decide.",
      );
      expect(output.indexOf("### 1. Brainstorm")).toBeLessThan(
        output.indexOf("### 2. Build"),
      );
      expect(output).toContain("### 2. Build\n\n1. Build the change.");
      for (const removed of [
        "## Policies",
        "(adaptive)",
        "(mandatory)",
        "subagent",
        "Phase validation",
      ])
        expect(output).not.toContain(removed);
    });

    test("renders optional phase output through the artifact slot only when present", () => {
      const output = renderWorkflowTemplate({
        phases: [
          {
            name: "Plan",
            instructions: ["Plan the work."],
            output: {
              description: "The plan record.",
              filePath: ".atlante/workflows/c/plan.md",
              updateable: true,
            },
          },
          { name: "Build", instructions: ["Build the work."] },
        ],
      });

      expect(output).toContain(
        "Phase output: The plan record. The artifact SHOULD be stored at .atlante/workflows/c/plan.md. This output is a living artifact that later phases MAY revisit and update, looping back when needed.",
      );
      const tail = output.slice(output.indexOf("### 2. Build"));
      expect(tail).not.toContain("Phase output");
    });

    test("accepts only the approved phase shape", () => {
      expect(
        inlineWorkflowDiagnostics({
          phases: [
            {
              name: "Plan",
              instructions: ["Plan the review."],
              output: { description: "The plan record." },
            },
          ],
        }),
      ).toEqual([]);
    });

    test.each([
      ["workflow title", { title: "Review workflow" }],
      ["workflow description", { description: "The delivery workflow." }],
      ["workflow policies", { policies: { orchestratorReadOnly: true } }],
      [
        "phase kind",
        { phases: [{ kind: "plan", instructions: ["Plan the review."] }] },
      ],
      [
        "phase description",
        { phases: [{ name: "Plan", description: "Planning." }] },
      ],
      ["phase subagent", { phases: [{ name: "Plan", subagent: "planner" }] }],
      [
        "phase policies",
        {
          phases: [
            {
              name: "Plan",
              policies: {
                adaptive: true,
                commit: true,
                review: true,
                maxLoops: 5,
              },
            },
          ],
        },
      ],
      [
        "phase validation",
        { phases: [{ name: "Plan", validation: "bun test" }] },
      ],
    ])("rejects the removed workflow field: %s", (_label, extra) => {
      const workflow = {
        phases: [{ name: "Plan", instructions: ["Plan the review."] }],
        ...extra,
      };

      expect(inlineWorkflowDiagnostics(workflow)).toContain(
        "invalid-prompt-input",
      );
    });

    test("resolves the concrete workflow instance with the exact approved phases in order", () => {
      const { root, config } = packResourceFixture();
      const instance = resolveResourceInstance(
        createProjectResourcePack(root),
        "@atlante/pack/workflow",
        config,
      );
      const phases = ((instance.input as JsonObject).phases ??
        []) as readonly JsonObject[];

      expect(phases).toEqual(approvedWorkflowPhases);

      const output = renderResolvedTemplate({
        template: instance.effectiveTemplate,
        input: instance.input,
      });
      const markers = approvedWorkflowPhases.map(
        (phase, index) => `### ${index + 1}. ${phase.name}`,
      );

      for (const marker of markers) expect(output, marker).toContain(marker);
      for (let index = 1; index < markers.length; index++)
        expect(output.indexOf(markers[index - 1])).toBeLessThan(
          output.indexOf(markers[index]),
        );
    });

    test("keeps filePath only on the Plan and Review outputs", () => {
      const { root, config } = packResourceFixture();
      const phases = ((
        resolveResourceInstance(
          createProjectResourcePack(root),
          "@atlante/pack/workflow",
          config,
        ).input as JsonObject
      ).phases ?? []) as readonly JsonObject[];

      for (const phase of phases.slice(0, 3)) {
        const output = (phase.output ?? {}) as JsonObject;
        expect("filePath" in output, String(phase.name)).toBe(
          phase.name === "Plan",
        );
      }
      expect("updateable" in (phases[1]?.output ?? {})).toBe(true);
      expect("updateable" in (phases[3]?.output ?? {})).toBe(false);
    });

    test("interpolates the inherited workflow-root default into Plan and Review paths", () => {
      const { pack, config, document } = firstPartyPreset();
      const values: Record<string, string> = {};
      for (const [key, value] of Object.entries(
        (document.values ?? {}) as JsonObject,
      ))
        if (typeof value === "string") values[key] = value;
      const instance = resolveResourceInstance(
        pack,
        "@atlante/pack/workflow",
        config,
      );
      const output = renderResolvedTemplate({
        template: instance.effectiveTemplate,
        input: interpolateValues(instance.input, values),
      });

      expect(output).toContain(
        "The artifact SHOULD be stored at .atlante/workflows/<cycle-id>/plan.md.",
      );
      expect(output).toContain(
        "The artifact SHOULD be stored at .atlante/workflows/<cycle-id>/reviews/<scope>-<n>.md.",
      );
      expect(output).not.toContain("{{values.");
    });
  });
});
