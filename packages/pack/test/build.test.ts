import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/build";

describe("build skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one agent-agnostic skill", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Build");
    expect(skill.overview).toContain("one defined task or correction");
    expect(skill.overview).toContain("truthful validation evidence");
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["instructions", "invariants"]);
  });

  test("instructions carry the implementation lifecycle with the red-green chain in order", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const marker of [
      "Read the complete task or correction definition",
      "stop and report it before changing code",
      "reproduce it and trace the root cause before proposing a fix",
      "name the regression it must catch",
      "mocks only at unavoidable slow or external boundaries",
      "write the smallest focused test that expresses the expected behavior and run it before implementation",
      "fails for the expected reason",
      "false red state",
      "Make the smallest implementation that satisfies the focused test",
      "meaningful boundary and failure cases",
      "record what each relevant test proves",
      "explain why red-green feedback is not meaningful",
      "manufacturing an artificial test",
      "verify every finding against the actual code and defined scope",
      "describe the resulting current state rather than only the correction delta",
      "Immediately before claiming completion, run the full commands that prove each claim",
      "stale, partial, or unavailable evidence is not a pass",
      "inspect the actual diff",
      "Return a concise implementation handoff",
    ])
      expect(instructions).toContain(marker);

    const position = (marker: string) => instructions.indexOf(marker);
    expect(
      position("Read the complete task or correction definition"),
    ).toBeLessThan(position("write the smallest focused test"));
    expect(position("write the smallest focused test")).toBeLessThan(
      position("fails for the expected reason"),
    );
    expect(position("fails for the expected reason")).toBeLessThan(
      position("Make the smallest implementation"),
    );
    expect(position("Make the smallest implementation")).toBeLessThan(
      position("meaningful boundary and failure cases"),
    );
    expect(position("meaningful boundary and failure cases")).toBeLessThan(
      position("Return a concise implementation handoff"),
    );
  });

  test("invariants guard single-task scope, red evidence, preservation, and honest completion", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const marker of [
      "Work on exactly one defined task or correction; do not absorb adjacent scope or weaken the requested outcome",
      "Do not implement a behavior change until its focused test has produced the expected red evidence",
      "do not manufacture tests for non-behavior changes",
      "Preserve unrelated work and keep it distinct from the implemented change",
      "Do not claim completion until the acceptance criteria and required checks are satisfied with reported evidence",
      "stop at the smallest safe point and report the blocker instead of improvising",
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
    expect(everything).not.toContain("Brief record");
    expect(everything).not.toMatch(/\bbrief\b/i);
    expect(everything).not.toMatch(/cumulative/i);
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
    expect(output).toContain(
      "Make the smallest implementation that satisfies the focused test",
    );
    expect(output).toContain(
      "- Do not implement a behavior change until its focused test has produced the expected red evidence",
    );
    expect(output).not.toContain("## Gotchas");
    expect(output).not.toContain("## Brief record");

    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Overview")).toBeLessThan(position("## Instructions"));
    expect(position("## Instructions")).toBeLessThan(position("## Invariants"));
  });
});
