import { afterEach, describe, expect, test } from "bun:test";
import {
  cleanupPackResourceFixtures,
  instanceDescription,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/build";

describe("build skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one agent-agnostic skill", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Build");
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["instructions", "invariants"]);
  });

  test("description frames the work as one defined task", () => {
    const description = instanceDescription(locator);

    expect(description).toContain("task");
  });

  test("invariants guard single-task scope, red evidence, preservation, and honest completion", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const marker of [
      "Work on exactly one defined task; MUST NOT absorb adjacent scope or weaken the requested outcome",
      "MUST NOT implement a behavior change until its focused test has produced the expected red evidence",
      "MUST NOT manufacture tests for non-behavior changes",
      "MUST preserve unrelated work and keep it distinct from the implemented change",
      "MUST NOT claim completion until the acceptance criteria and required checks are satisfied with reported evidence",
      "stop at the smallest safe point and report the blocker instead of improvising",
    ])
      expect(invariants).toContain(marker);
  });

  test("invariants require reusing suitable existing code before new implementation", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const pattern of [
      /reuse/i,
      /extend/i,
      /duplication/i,
      /consumers/i,
      /speculative/i,
    ])
      expect(invariants, String(pattern)).toMatch(pattern);
  });

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Build",
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
