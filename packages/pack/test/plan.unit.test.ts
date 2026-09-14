import { afterEach, describe, expect, test } from "bun:test";
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
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["instructions", "invariants"]);
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

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Plan",
      "## Overview",
      "## Instructions",
      "## Invariants",
    ])
      expect(output).toContain(heading);
    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Overview")).toBeLessThan(position("## Instructions"));
    expect(position("## Instructions")).toBeLessThan(position("## Invariants"));
  });
});
