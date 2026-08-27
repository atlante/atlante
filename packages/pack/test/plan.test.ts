import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/plan";
const recordFields = [
  "Ordered task IDs",
  "Dependencies",
  "Acceptance mapping",
  "Test strategy",
  "Risks",
  "Validation commands",
  "Cycle and working-tree boundaries",
  "Cycle and task state",
  "Artifact links",
  "Adaptive decision",
] as const;

describe("plan skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template with one phase role", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Plan");
    expect(skill.overview).toContain("`full`");
    expect(skill.overview).toContain("`reduced`");
    expect(skill.overview).toContain("original planner");
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.some(
        (section) =>
          !("markdown" in section) &&
          !("instructions" in section) &&
          !("gotchas" in section) &&
          !("invariants" in section),
      ),
    ).toBe(false);
  });

  test("authored instructions carry the planning lifecycle in order", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const marker of [
      "Read the complete assignment first",
      "read in full or supplied verbatim",
      "In `full`",
      "explore the repository",
      "In `reduced`",
      "explicitly justifies",
      "direct evidence",
      "new for this cycle",
      "instead of overwriting",
      "canonical adaptive decision",
      "transcribing the architect-supplied classification, evidence, disposition, and rationale",
      "recalls you, the original planner",
      "renewed developer approval arrives",
    ])
      expect(instructions).toContain(marker);

    expect(instructions).toContain("Return the finished or updated plan");

    const indexOfMarker = (marker: string) => instructions.indexOf(marker);
    expect(indexOfMarker("Read the complete assignment first")).toBeLessThan(
      indexOfMarker("new for this cycle"),
    );
    expect(indexOfMarker("new for this cycle")).toBeLessThan(
      indexOfMarker("Return the finished or updated plan"),
    );
  });

  test("both dispositions record one identical ten-field contract with one canonical adaptive decision", () => {
    const skill = resolvePackSkill(locator);
    const markdown = skill.markdownText();
    const everything = skill.everythingText();

    expect(markdown).toContain("Plan record");
    expect(markdown).toContain(
      "Both dispositions record the identical complete contract",
    );
    for (const field of recordFields)
      expect(everything.split(field).length - 1).toBe(1);
    expect(markdown).toContain(
      "classification, evidence, disposition, and rationale supplied by the architect",
    );
    expect(markdown).toContain("cycle and each of its tasks");
    expect(skill.listText("invariants")).toContain("full record complete");
  });

  test("records every Plan record field exactly once and nothing beyond that contract", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    expect(instructions).toContain(
      "Record every field in the complete Plan record contract above exactly once",
    );
    expect(instructions).toContain("add nothing beyond that contract");
    expect(instructions).not.toContain("and nothing else");
  });

  test("authored contract pins the exact workflow artifact layout", () => {
    const markdown = resolvePackSkill(locator).markdownText();

    for (const marker of [
      ".atlante/workflows/<cycle-id>/",
      ".atlante/workflows/<cycle-id>/plan.md",
      "tasks/<task-id>/brief-<n>.md",
      "tasks/<task-id>/review-<n>.md",
      "final-review-<n>.md",
      "counters are independent",
      "immutable once written",
      "create no placeholder artifacts",
    ])
      expect(markdown).toContain(marker);
  });

  test("boundaries route authority up and stop rather than improvise", () => {
    const skill = resolvePackSkill(locator);
    const invariants = skill.listText("invariants");
    const gotchas = skill.listText("gotchas");

    for (const marker of [
      "weaker disposition than assigned",
      "only by its original planner",
      "build and review workers never update",
      "MUST NOT copy or extend another cycle's plan",
      "rather than overwrite it",
      "handoff completeness, direct evidence, or gates",
      "go back to the architect",
      "decide it yourself",
      "MUST NOT improvise substitutes",
      "unavailable and never as passed",
      "incomplete or partially validated",
    ])
      expect(invariants).toContain(marker);
    expect(invariants).toMatch(/\bMUST\b/);
    for (const marker of [
      "preserve them untouched",
      "distinct from",
      "reading artifacts in full",
      "never substitutes",
      "writes only the assigned `plan.md`",
    ])
      expect(gotchas).toContain(marker);
  });

  test("claims no adaptive eligibility, selection, or skip authority", () => {
    const everything = resolvePackSkill(locator).everythingText();

    expect(everything).toContain("the architect");
    expect(everything).toContain("routing and classification decision");
    expect(everything).not.toMatch(
      /use `(?:full|reduced)` (?:when|if|unless)/i,
    );
    expect(everything).not.toMatch(
      /\b(?:choose|decide|determine|pick|select)\s+(?:whether|when|which)\b/i,
    );
    expect(everything).not.toMatch(/skip(?:ping)?\s+planning/i);
    expect(everything).not.toMatch(/eligib/i);
  });

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Plan",
      "## Overview",
      "## Terms",
      "## Plan record",
      "## Workflow layout",
      "## Instructions",
      "## Gotchas",
      "## Invariants",
    ])
      expect(output).toContain(heading);
    for (const marker of [
      "- Adaptive decision",
      "- Artifact links",
      "- Validation commands",
      ".atlante/workflows/<cycle-id>/",
      "create no placeholder artifacts",
      "exactly the assigned",
      "weaker disposition than assigned",
    ])
      expect(output).toContain(marker);

    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Terms")).toBeLessThan(position("## Plan record"));
    expect(position("## Plan record")).toBeLessThan(
      position("## Workflow layout"),
    );
    expect(position("## Workflow layout")).toBeLessThan(
      position("## Instructions"),
    );
    expect(position("## Instructions")).toBeLessThan(position("## Gotchas"));
    expect(position("## Gotchas")).toBeLessThan(position("## Invariants"));
  });
});
