import {
  createProjectResourcePack,
  loadPresetFacet,
  renderResolvedTemplate,
  resolveResourceInstance,
  resolveResourceTemplate,
} from "@atlante/resources";
import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  packResourceFixture,
  resolvePackSkill,
} from "./selection-fixture.js";

const phaseSkills = ["brainstorm", "plan", "build", "review"] as const;
const normativeKeyword = /\b(MUST|SHOULD|MAY)\b/;
const gateKeyword = /\bMUST( NOT)?\b/;
const weakProhibitionForm = /\b(?:never|do not)\b/gi;
const descriptiveProhibitionPrefix = /\b(?:that|which)\s+$/i;

const gateLandmarks: Record<string, readonly string[]> = {
  brainstorm: [
    "MUST stop and expose unresolved doubts instead of continuing without direction when exploration starts drifting, looping, or stalling",
    "MUST preserve agreed decisions unless they are explicitly changed",
  ],
  plan: [
    "MUST NOT expand or weaken the defined scope or acceptance criteria",
    "MUST NOT invent dependencies or implementation facts",
  ],
  build: [
    "MUST NOT implement a behavior change until its focused test has produced the expected red evidence",
    "MUST NOT claim completion until the acceptance criteria and required checks are satisfied with reported evidence",
  ],
  review: [
    "MUST NOT intentionally modify reviewed source, configuration, or tests",
    "failed required check MUST make the verdict `BLOCKED`",
  ],
};

function renderPackTemplate(locator: string, input: unknown): string {
  const { root, config } = packResourceFixture();
  return renderResolvedTemplate({
    template: resolveResourceTemplate(
      createProjectResourcePack(root),
      locator,
      config,
    ),
    input,
  });
}

function instanceDescription(locator: string): string {
  const { root, config } = packResourceFixture();
  const resolved = resolveResourceInstance(
    createProjectResourcePack(root),
    locator,
    config,
  );
  const { description } = resolved.input;
  if (typeof description !== "string")
    throw new Error(`pack skill ${locator} expects a string description`);
  return description;
}

describe("normative authoring convention", () => {
  afterEach(cleanupPackResourceFixtures);

  describe("phase skill instances", () => {
    test.each(phaseSkills)("%s states every invariant as a gate", (id) => {
      const skill = resolvePackSkill(`@atlante/pack/${id}`);
      const invariants = skill.listText("invariants").split("\n");

      expect(invariants.length).toBeGreaterThan(0);
      for (const invariant of invariants) {
        expect(invariant, `${id} invariant: ${invariant}`).toMatch(gateKeyword);
        expect(invariant, `${id} invariant: ${invariant}`).not.toMatch(
          /\b(SHOULD|MAY)\b/,
        );
      }
      for (const landmark of gateLandmarks[id])
        expect(skill.listText("invariants"), id).toContain(landmark);
    });

    test.each(phaseSkills)(
      "%s keeps descriptive prose free of normative keywords",
      (id) => {
        const skill = resolvePackSkill(`@atlante/pack/${id}`);

        expect(instanceDescription(`@atlante/pack/${id}`)).not.toMatch(
          normativeKeyword,
        );
        expect(skill.overview).not.toMatch(normativeKeyword);
        for (const instruction of skill.listText("instructions").split("\n"))
          for (const match of instruction.matchAll(weakProhibitionForm))
            expect(
              descriptiveProhibitionPrefix.test(
                instruction.slice(0, match.index ?? 0),
              ),
              `${id} instruction states a prohibition weakly: ${instruction}`,
            ).toBe(true);
      },
    );

    test("review instructions state their absolute gates with normative wording", () => {
      const instructions = resolvePackSkill("@atlante/pack/review").listText(
        "instructions",
      );

      for (const landmark of [
        "MUST NOT omit direct source inspection, acceptance verification, or the evidence needed to support the verdict",
        "MUST NOT reopen unaffected code",
        "SHOULD NOT repeat broad validation when sufficient evidence already exists",
      ])
        expect(instructions).toContain(landmark);
    });
  });

  describe("shared templates", () => {
    test("invariants preamble binds with MUST and MUST NOT", () => {
      const output = renderPackTemplate("@atlante/pack/invariants", [
        "The API remains stable.",
      ]);

      expect(output).toContain("## Invariants");
      expect(output).toMatch(/\bMUST\b/);
      expect(output).toMatch(/\bMUST NOT\b/);
    });

    test("gotchas preamble binds attention with MUST and MUST NOT", () => {
      const output = renderPackTemplate("@atlante/pack/gotchas", [
        "Tests flake under parallel load.",
      ]);

      expect(output).toContain("require active attention");
      expect(output).toMatch(/\bMUST\b/);
      expect(output).toMatch(/\bMUST NOT\b/);
    });

    test("instructions render the required-actions preamble without normative keywords", () => {
      const output = renderPackTemplate("@atlante/pack/instructions", [
        "Do the work.",
        "Check the work.",
      ]);

      expect(output).toContain(
        "These are required actions for completing the work.",
      );
      expect(output).not.toMatch(normativeKeyword);
    });

    test("artifact guidance stays SHOULD-level with MAY for updateable output", () => {
      const output = renderPackTemplate("@atlante/pack/artifact", {
        description: "The plan record.",
        filePath: ".atlante/workflows/c/plan.md",
        updateable: true,
      });

      expect(output).toContain(
        "The artifact SHOULD be stored at .atlante/workflows/c/plan.md.",
      );
      expect(output).toContain("later phases MAY revisit and update");
      expect(output).not.toMatch(/\bMUST\b/);
    });

    test("structural templates render without normative keywords", () => {
      expect(renderPackTemplate("@atlante/pack/markdown", "Body.")).not.toMatch(
        normativeKeyword,
      );
      expect(
        renderPackTemplate("@atlante/pack/agent", {
          identity: "Identity.",
          mission: "Mission.",
          sections: [{ instructions: ["Do the work."] }],
        }),
      ).not.toMatch(normativeKeyword);
      expect(
        renderPackTemplate("@atlante/pack/skill", {
          title: "Skill",
          overview: "Overview.",
          sections: [{ markdown: "Body." }],
        }),
      ).not.toMatch(normativeKeyword);
    });

    test("workflow preamble binds sequential execution and inline instruction order", () => {
      const output = renderPackTemplate("@atlante/pack/workflow", {
        title: "Workflow",
        phases: [{ name: "Plan", instructions: ["Plan the work."] }],
      });

      expect(output).toContain(
        "Phases MUST run sequentially in the order listed.",
      );
      expect(output).toContain(
        "Each phase's inline instructions MUST be followed in order.",
      );
      expect(output).not.toMatch(/\b(SHOULD|MAY)\b/);
    });

    test("workflow policies bind with MUST and keep the adaptive ceremony default at SHOULD", () => {
      const output = renderPackTemplate("@atlante/pack/workflow", {
        title: "Workflow",
        policies: { orchestratorReadOnly: true },
        phases: [
          {
            name: "Build",
            policies: { adaptive: true, commit: true, maxLoops: 3 },
            instructions: ["Build the change."],
          },
        ],
      });

      expect(output).toContain(
        "Policies are binding; they MUST be followed in every phase.",
      );
      expect(output).toContain(
        "An adaptive phase is optional and SHOULD add only as much ceremony as the work needs.",
      );
      expect(output).toContain(
        "Whenever the phase runs, it MUST preserve its required output, approvals, and safety gates.",
      );
      expect(output).toContain(
        "Task implementation and corrections MUST be committed in separate commits",
      );
      expect(output).toContain("MUST NOT amend or force-push");
      expect(output).toContain(
        "Correction MUST be limited to 3 loops per task.",
      );
    });
  });

  test("exposes no configuration surface for writing style", () => {
    const { root, config } = packResourceFixture();
    const document = loadPresetFacet(
      createProjectResourcePack(root),
      "@atlante/pack",
      config,
    ).facet.document;

    expect(Object.keys(document).sort()).toEqual([
      "$schema",
      "agents",
      "skills",
      "values",
    ]);
  });
});
