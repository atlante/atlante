import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/plan";

describe("plan skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one agent-agnostic skill", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Plan");
    expect(skill.overview).toContain("smallest implementation plan");
    expect(skill.overview).toContain(
      "scope, dependencies, risks, and validation",
    );
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["instructions", "invariants"]);
  });

  test("instructions carry the planning lifecycle in order", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const marker of [
      "Read the defined request and inspect the relevant source, documentation, tests, and recent changes",
      "Scale the plan detail to the complexity, risk, and uncertainty",
      "Make the plan self-contained",
      "stop and return the scope problem instead of silently narrowing it or creating multiple plans",
      "smallest independently actionable tasks",
      "order them by dependency",
      "proceed in parallel without conflict",
      "Record the goal, chosen approach",
      "acceptance-criteria mapping",
      "name the exact files to create, modify, and test",
      "independently testable and reviewable outcome",
      "exact validation commands",
      "preserve established decisions and change only what new evidence justifies",
      "report any material scope or contract change as a blocker",
      "check that every acceptance criterion is covered",
      "Return the complete plan together with any blockers",
    ])
      expect(instructions).toContain(marker);

    const position = (marker: string) => instructions.indexOf(marker);
    expect(position("Read the defined request")).toBeLessThan(
      position("smallest independently actionable tasks"),
    );
    expect(position("smallest independently actionable tasks")).toBeLessThan(
      position("Record the goal, chosen approach"),
    );
    expect(position("Record the goal, chosen approach")).toBeLessThan(
      position("Return the complete plan together with any blockers"),
    );
  });

  test("invariants guard scope, grounded evidence, and task actionability", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const marker of [
      "MUST NOT expand or weaken the defined scope or acceptance criteria; report any required change as a blocker",
      "Ground every task and risk in repository evidence you actually inspected; MUST NOT invent dependencies or implementation facts",
      "MUST keep tasks independently actionable and give each one clear completion evidence",
    ])
      expect(invariants).toContain(marker);
  });

  test("carries no removed disposition or workflow-artifact semantics", () => {
    const skill = resolvePackSkill(locator);
    const everything = skill.everythingText();

    expect(skill.markdownText().trim()).toBe("");
    expect(everything).not.toContain("`full`");
    expect(everything).not.toContain("`reduced`");
    expect(everything).not.toMatch(/\barchitect\b/i);
    expect(everything).not.toMatch(/disposition|eligib/i);
    expect(everything).not.toContain(".atlante/");
    expect(everything).not.toContain("Plan record");
    expect(everything).not.toContain("Adaptive decision");
    expect(everything).not.toContain("cycle");
  });

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Plan",
      "## Overview",
      "## Instructions",
      "## Invariants",
    ])
      expect(output).toContain(heading);
    expect(output).toContain("smallest independently actionable tasks");
    expect(output).toContain(
      "- MUST NOT expand or weaken the defined scope or acceptance criteria; report any required change as a blocker.",
    );
    expect(output).not.toContain("## Gotchas");
    expect(output).not.toContain("## Plan record");

    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Overview")).toBeLessThan(position("## Instructions"));
    expect(position("## Instructions")).toBeLessThan(position("## Invariants"));
  });
});
