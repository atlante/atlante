import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/brainstorm";
const handoffFields = [
  "Purpose",
  "Approved scope and exclusions",
  "Constraints and invariants",
  "Acceptance criteria",
  "Chosen approach",
  "Rejected alternatives",
  "Relevant repository evidence",
  "Assumptions",
  "Remaining open decisions",
] as const;

describe("brainstorm skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template with one phase role", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Brainstorm");
    expect(skill.overview).toContain("`full`");
    expect(skill.overview).toContain("`reduced`");
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

  test("authored instructions carry the full and reduced procedures in order", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const marker of [
      "explore the repository",
      "one focused piece at a time",
      "exactly one question at a time",
      "two or three viable approaches",
      "trade-offs",
      "clear recommendation",
      "YAGNI",
      "approval after each section",
      "In `reduced`",
      "only the gaps or assumptions",
      "narrowed breadth is sufficient",
    ])
      expect(instructions).toContain(marker);

    const indexOfMarker = (marker: string) => instructions.indexOf(marker);
    expect(indexOfMarker("explore the repository first")).toBeLessThan(
      indexOfMarker("two or three viable approaches"),
    );
    expect(indexOfMarker("two or three viable approaches")).toBeLessThan(
      indexOfMarker("approval after each section"),
    );
  });

  test("both dispositions share one identical nine-field handoff contract", () => {
    const skill = resolvePackSkill(locator);
    const markdown = skill.markdownText();
    const everything = skill.everythingText();

    expect(markdown).toContain("Handoff contract");
    for (const field of handoffFields)
      expect(everything.split(field).length - 1).toBe(1);
    expect(markdown).toContain("no standalone brainstorming artifact");
    expect(skill.listText("invariants")).toContain(
      "previously approved content",
    );
  });

  test("boundaries route authority up and stop rather than improvise", () => {
    const skill = resolvePackSkill(locator);
    const invariants = skill.listText("invariants");
    const gotchas = skill.listText("gotchas");

    for (const marker of [
      "weaker disposition than assigned",
      "back to the architect",
      "standalone brainstorming file",
      "MUST NOT improvise substitutes",
      "unavailable and never as passed",
      "incomplete or partially validated",
    ])
      expect(invariants).toContain(marker);
    expect(invariants).toMatch(/\bMUST\b/);
    for (const marker of ["preserve them untouched", "distinct from"])
      expect(gotchas).toContain(marker);
  });

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Brainstorm",
      "## Overview",
      "## Handoff contract",
      "## Instructions",
      "## Gotchas",
      "## Invariants",
    ])
      expect(output).toContain(heading);
    expect(output).toContain("- Approved scope and exclusions");
    for (const marker of [
      "exactly one question at a time",
      "weaker disposition than assigned",
    ])
      expect(output).toContain(marker);

    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Handoff contract")).toBeLessThan(
      position("## Instructions"),
    );
    expect(position("## Instructions")).toBeLessThan(position("## Gotchas"));
    expect(position("## Gotchas")).toBeLessThan(position("## Invariants"));
  });
});
