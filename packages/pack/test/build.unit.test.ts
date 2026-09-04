import { afterEach, describe, expect, test } from "bun:test";
import {
  createProjectResourcePack,
  resolveResourceInstance,
} from "@atlante/resources";
import {
  cleanupPackResourceFixtures,
  packResourceFixture,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/build";

function instanceDescription(): string {
  const { root, config } = packResourceFixture();
  const { input } = resolveResourceInstance(
    createProjectResourcePack(root),
    locator,
    config,
  );
  const { description } = input;
  if (typeof description !== "string")
    throw new Error(`${locator} expects a string description`);
  return description;
}

describe("build skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one agent-agnostic skill", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Build");
    expect(skill.overview).toContain("one defined task");
    expect(skill.overview).toContain("truthful validation evidence");
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["instructions", "invariants"]);
  });

  test("description frames the work as one defined task", () => {
    const description = instanceDescription();

    expect(description).toContain("task");
  });

  test("instructions carry the implementation lifecycle with the red-green chain in order", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const marker of [
      "the relevant source and tests before editing",
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
      "read the complete review context",
      "verify every finding against the actual code and defined scope",
      "describe the resulting current state rather than only the",
      "Immediately before claiming completion, run the full commands that prove each claim",
      "stale, partial, or unavailable evidence is not a pass",
      "inspect the actual diff",
      "Return a concise implementation handoff",
    ])
      expect(instructions).toContain(marker);
    const position = (marker: string) => instructions.indexOf(marker);
    expect(
      position("the relevant source and tests before editing"),
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
    expect(output).toContain(
      "Make the smallest implementation that satisfies the focused test",
    );
    expect(output).toContain(
      "- MUST NOT implement a behavior change until its focused test has produced the expected red evidence",
    );
    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Overview")).toBeLessThan(position("## Instructions"));
    expect(position("## Instructions")).toBeLessThan(position("## Invariants"));
  });
});
