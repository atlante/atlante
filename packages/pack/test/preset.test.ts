import {
  createProjectResourcePack,
  interpolateValues,
  type JsonObject,
  loadPresetFacet,
  ResourceResolutionError,
  renderResolvedTemplate,
  resolveResourceInstance,
  resolveResourceTemplate,
} from "@atlante/resources";
import { validateDocumentText } from "@atlante/validator";
import { afterEach, describe, expect, test } from "vitest";
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
    test("renders the canonical workflow identically in agents and skills", () => {
      const { root, config } = packResourceFixture();
      const pack = createProjectResourcePack(root);
      const workflow = {
        title: "Review workflow",
        phases: [{ kind: "plan", instructions: ["Plan the review."] }],
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
      const workflowStart = "## Review workflow";

      expect(agentOutput.slice(agentOutput.indexOf(workflowStart))).toBe(
        skillOutput.slice(skillOutput.indexOf(workflowStart)),
      );
    });

    test("renders one shared adaptive section and distinguishes mixed phase modes", () => {
      const output = renderWorkflowTemplate({
        title: "Adaptive review",
        phases: [
          {
            name: "Plan",
            policies: { adaptive: true },
            instructions: ["Plan the review."],
          },
          { kind: "review", instructions: ["Review the change."] },
        ],
      });

      expect(output.match(/^### Adaptive phases$/gm)).toHaveLength(1);
      expect(output).toContain("### 1. Plan (adaptive)");
      expect(output).toContain("### 2. review (mandatory)");
      for (const phrase of [
        "An adaptive phase is optional and should add only as much ceremony as the work needs.",
        "assess whether it would materially improve the outcome using task complexity, risk, uncertainty, and existing evidence",
        "Skip the phase when the task is already clear, low-risk, and simple enough that the phase would not materially improve the outcome; briefly state why.",
        "Otherwise run the phase with depth proportional to the work, focusing only on material questions and evidence.",
        "Whenever the phase runs, preserve its required output, approvals, and safety gates.",
        "Reassess later adaptive phases when implementation or review reveals new material evidence.",
        "A non-adaptive phase remains mandatory and runs as written.",
      ])
        expect(output).toContain(phrase);
      for (const removed of [
        "Adaptive phase protocol",
        "`full`",
        "`reduced`",
        "`skipped`",
        "disposition",
      ])
        expect(output).not.toContain(removed);
    });

    test("renders adaptive guidance from assessment through reassessment in order", () => {
      const output = renderWorkflowTemplate({
        title: "Adaptive review",
        phases: [
          {
            policies: { adaptive: true },
            instructions: ["Review the change."],
          },
        ],
      });
      const assess =
        "Before running an adaptive phase, assess whether it would materially improve the outcome using task complexity, risk, uncertainty, and existing evidence.";
      const skip =
        "Skip the phase when the task is already clear, low-risk, and simple enough that the phase would not materially improve the outcome; briefly state why.";
      const run =
        "Otherwise run the phase with depth proportional to the work, focusing only on material questions and evidence.";
      const preserve =
        "Whenever the phase runs, preserve its required output, approvals, and safety gates.";
      const reassess =
        "Reassess later adaptive phases when implementation or review reveals new material evidence.";
      const mandatory =
        "A non-adaptive phase remains mandatory and runs as written.";

      for (const phrase of [assess, skip, run, preserve, reassess, mandatory])
        expect(output).toContain(phrase);
      expect(output.indexOf(assess)).toBeLessThan(output.indexOf(skip));
      expect(output.indexOf(skip)).toBeLessThan(output.indexOf(run));
      expect(output.indexOf(run)).toBeLessThan(output.indexOf(preserve));
      expect(output.indexOf(preserve)).toBeLessThan(output.indexOf(reassess));
      expect(output.indexOf(reassess)).toBeLessThan(output.indexOf(mandatory));
    });

    test("renders one adaptive section for multiple adaptive phases with name and kind fallbacks", () => {
      const output = renderWorkflowTemplate({
        title: "Adaptive delivery",
        phases: [
          {
            name: "Planning",
            policies: { adaptive: true },
            instructions: ["Plan the delivery."],
          },
          {
            kind: "build",
            policies: { adaptive: true },
            instructions: ["Build the change."],
          },
          { kind: "review", instructions: ["Review the change."] },
        ],
      });

      expect(output.match(/^### Adaptive phases$/gm)).toHaveLength(1);
      expect(output).toContain("### 1. Planning (adaptive)");
      expect(output).toContain("### 2. build (adaptive)");
      expect(output).toContain("### 3. review (mandatory)");
    });

    test("uses strict adaptive semantics for phase labels", () => {
      const output = renderWorkflowTemplate({
        title: "Adaptive review",
        phases: [
          {
            name: "Plan",
            policies: { adaptive: true },
            instructions: ["Plan the review."],
          },
          {
            name: "Malformed",
            policies: { adaptive: "false" },
            instructions: ["Review the change."],
          },
        ],
      });

      expect(output.match(/^### Adaptive phases$/gm)).toHaveLength(1);
      expect(output).toContain("### 1. Plan (adaptive)");
      expect(output).toContain("### 2. Malformed (mandatory)");
    });

    test.each([
      ["omitted", undefined],
      ["false", { adaptive: false }],
    ])(
      "keeps %s adaptive phases mandatory without adaptive labels",
      (_label, policies) => {
        const phase = {
          name: "Plan",
          ...(policies === undefined ? {} : { policies }),
          instructions: ["Plan the review."],
        };
        const output = renderWorkflowTemplate({
          title: "Mandatory workflow",
          phases: [
            phase,
            { kind: "review", instructions: ["Review the change."] },
          ],
        });

        expect(output).not.toContain("## Adaptive phases");
        expect(output).not.toContain("disposition");
        expect(output).toContain("### 1. Plan\n");
        expect(output).toContain("### 2. review\n");
        expect(output).not.toContain("(adaptive)");
        expect(output).not.toContain("(mandatory)");
      },
    );

    test("renders policy entries with an explicit heading hierarchy", () => {
      const output = renderWorkflowTemplate({
        title: "Structured policies",
        policies: { orchestratorReadOnly: true },
        phases: [
          {
            name: "Build",
            policies: {
              adaptive: true,
              commit: true,
              review: true,
              maxLoops: 2,
            },
            instructions: ["Build the change."],
          },
        ],
      });

      const headings = ["## Policies", "### Adaptive phases"];

      let previous = -1;
      for (const heading of headings) {
        const position = output.indexOf(heading);
        expect(position, heading).toBeGreaterThan(previous);
        previous = position;
      }
      for (const [heading, body] of [
        [
          "### Workflow: read-only orchestration",
          "The orchestrator is read-only and delegates every file edit.",
        ],
        [
          "### Build: task commits",
          "Commit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.",
        ],
        [
          "### Build: task review",
          "Apply task review according to this phase's review criteria.",
        ],
        [
          "### Build: correction loops",
          "Limit correction to 2 loops per task.",
        ],
      ])
        expect(output).toContain(`${heading}\n\n${body}`);
      expect(output).not.toContain("\n- Workflow:");
      expect(output).not.toContain("\n- Build:");
    });

    test.each([
      [
        "workflow-level truthy values",
        {
          title: "Workflow policies",
          policies: { orchestratorReadOnly: true },
          phases: [{ name: "Plan", instructions: ["Plan the review."] }],
        },
        "## Policies\n\nPolicies are binding; follow them in every phase.\n\n### Workflow: read-only orchestration\n\nThe orchestrator is read-only and delegates every file edit.",
      ],
      [
        "phase-level truthy values",
        {
          title: "Phase policies",
          phases: [
            {
              name: "Build",
              policies: { commit: true, review: true, maxLoops: 2 },
              instructions: ["Build the change."],
            },
          ],
        },
        "## Policies\n\nPolicies are binding; follow them in every phase.\n\n### Build: task commits\n\nCommit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.\n\n### Build: task review\n\nApply task review according to this phase's review criteria.\n\n### Build: correction loops\n\nLimit correction to 2 loops per task.",
      ],
      [
        "no truthy values",
        {
          title: "No policies",
          policies: { orchestratorReadOnly: false },
          phases: [
            {
              name: "Plan",
              policies: { commit: false, review: false },
              instructions: ["Plan the review."],
            },
          ],
        },
        "## No policies\n\nExecute phases sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Follow each phase's inline instructions in order.",
      ],
    ] as const)(
      "preserves the policy rendering compatibility matrix",
      (label, workflow, expected) => {
        const output = renderWorkflowTemplate(workflow);

        expect(output, label).toContain(expected);
        expect(output.match(/^## Policies$/gm) ?? []).toHaveLength(
          label === "no truthy values" ? 0 : 1,
        );
      },
    );

    test("preserves complete output when no policy is rendered", () => {
      expect(
        renderWorkflowTemplate({
          title: "No policies",
          phases: [{ name: "Plan", instructions: ["Plan the review."] }],
        }),
      ).toBe(
        "## No policies\n\nExecute phases sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Follow each phase's inline instructions in order.\n\n\n### 1. Plan\n\n1. Plan the review.\n",
      );
    });
  });
});
