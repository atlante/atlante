import { afterEach, describe, expect, test } from "bun:test";
import {
  createProjectResourcePack,
  loadPresetFacet,
  renderResolvedTemplate,
  resolveResourceInstance,
  resolveResourceTemplate,
} from "@atlante/resources";
import {
  cleanupPackResourceFixtures,
  packResourceFixture,
  resolvePackSkill,
} from "./selection-fixture.js";

const phaseSkills = ["brainstorm", "plan", "build", "review"] as const;
const normativeSkills = [...phaseSkills, "harness"] as const;
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
  harness: [
    "MUST NOT direct edits to generated artifacts",
    "MUST obtain explicit developer approval before changing the harness or expanding an unrelated task into harness work",
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

  describe("first-party skill instances", () => {
    test.each(normativeSkills)("%s states every invariant as a gate", (id) => {
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

    test.each(normativeSkills)(
      "%s keeps descriptive prose free of normative keywords",
      (id) => {
        const skill = resolvePackSkill(`@atlante/pack/${id}`);

        expect(instanceDescription(`@atlante/pack/${id}`)).not.toMatch(
          normativeKeyword,
        );
        expect(skill.overview).not.toMatch(normativeKeyword);
        for (const responsibility of skill
          .listText("responsibilities")
          .split("\n"))
          expect(
            responsibility,
            `${id} responsibility must name an outcome without a normative gate: ${responsibility}`,
          ).not.toMatch(normativeKeyword);
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

    test("responsibilities render owned outcomes without a normative preamble", () => {
      const output = renderPackTemplate("@atlante/pack/responsibilities", [
        "Own the outcome.",
      ]);

      expect(output).toContain("## Responsibilities");
      expect(output).toContain("- Own the outcome.");
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

    test("references render verified entries in order without normative keywords", () => {
      const output = renderPackTemplate("@atlante/pack/references", [
        {
          name: "Guide",
          location: "https://example.test/guide",
          readWhen: "Learning the basics.",
        },
        {
          name: "Schema",
          location: "https://example.test/schema.json",
        },
      ]);

      expect(output).toContain("## References");
      expect(output).toContain(
        "1. **Guide** — https://example.test/guide — Learning the basics.",
      );
      expect(output).toContain(
        "2. **Schema** — https://example.test/schema.json",
      );
      expect(output).not.toContain(
        "2. **Schema** — https://example.test/schema.json —",
      );
      expect(output.indexOf("1. **Guide**")).toBeLessThan(
        output.indexOf("2. **Schema**"),
      );
      expect(output).not.toMatch(normativeKeyword);
    });

    test("markdown renders ordered blocks with headings and lists", () => {
      const output = renderPackTemplate("@atlante/pack/markdown", [
        { type: "paragraph", children: [{ type: "text", value: "First." }] },
        { type: "paragraph", children: [{ type: "text", value: "Second." }] },
        {
          type: "list",
          ordered: false,
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "alpha" }],
                },
              ],
            },
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "beta" }],
                },
              ],
            },
          ],
        },
        {
          type: "list",
          ordered: true,
          start: 1,
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "one" }],
                },
              ],
            },
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "two" }],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          children: [{ type: "text", value: "Interleaved closing." }],
        },
        {
          type: "heading",
          depth: 2,
          children: [{ type: "text", value: "Context" }],
        },
        { type: "paragraph", children: [{ type: "text", value: "Intro." }] },
        {
          type: "heading",
          depth: 3,
          children: [{ type: "text", value: "Sub" }],
        },
        {
          type: "list",
          ordered: false,
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "deep" }],
                },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          children: [{ type: "text", value: "Deep prose." }],
        },
      ]);

      expect(output).toBe(
        [
          "First.",
          "",
          "Second.",
          "",
          "- alpha",
          "- beta",
          "",
          "1. one",
          "2. two",
          "",
          "Interleaved closing.",
          "",
          "## Context",
          "",
          "Intro.",
          "",
          "### Sub",
          "",
          "- deep",
          "",
          "Deep prose.",
        ].join("\n"),
      );
      expect(output).not.toMatch(normativeKeyword);
    });

    test("structural templates render without normative keywords", () => {
      expect(
        renderPackTemplate("@atlante/pack/markdown", [
          { type: "paragraph", children: [{ type: "text", value: "Body." }] },
          {
            type: "list",
            ordered: false,
            children: [
              {
                type: "listItem",
                children: [
                  {
                    type: "paragraph",
                    children: [{ type: "text", value: "Item." }],
                  },
                ],
              },
            ],
          },
        ]),
      ).not.toMatch(normativeKeyword);
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
          sections: [
            {
              markdown: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "Body." }],
                },
              ],
            },
          ],
        }),
      ).not.toMatch(normativeKeyword);
      expect(
        renderPackTemplate("@atlante/pack/references", [
          {
            name: "Guide",
            location: "https://example.test/guide",
            readWhen: "Learning the basics.",
          },
        ]),
      ).not.toMatch(normativeKeyword);
      expect(
        renderPackTemplate("@atlante/pack/workflow", {
          phases: [
            {
              name: "Plan",
              instructions: ["Plan the work."],
              output: { description: "The plan record." },
            },
          ],
        }),
      ).not.toMatch(normativeKeyword);
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
      "eval",
      "skills",
      "values",
    ]);
  });
});
