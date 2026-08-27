import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/review";
const reportFields = [
  "Mode, disposition, and inspected artifact lineage",
  "Actual review boundary",
  "Acceptance evidence",
  "Validation and check evidence",
  "Findings with severity, evidence, and required correction",
  "Rulings and unresolved items",
  "Blocking verdict",
] as const;

describe("review skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one fresh read-only reviewer role", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Review");
    expect(skill.overview).toContain("`task-review`");
    expect(skill.overview).toContain("`final-review`");
    expect(skill.overview).toContain("`full`");
    expect(skill.overview).toContain("`reduced`");
    expect(skill.overview).toContain("fresh read-only reviewer");
    expect(skill.overview).toContain("immutable report");
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

  test("authored instructions branch into task-review and final-review modes in order", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const marker of [
      "Read the complete assignment first",
      "passed by exact shared path",
      "read in full or supplied verbatim",
      "identifiers, counter, path, and lineage",
      "refuse the assignment and report instead of overwriting",
      "rediscovering numbering",
      "name the exact numbered brief",
      "revision-plus-working-tree boundary separately",
      "independently inspect that source and diff",
      "reconcile what the brief records against your own inspection",
      "verifying acceptance criteria and validation evidence",
      "`critical`, `important`, or `minor`",
      "each required correction",
      "truthful blocking verdict",
      "read the complete available plan",
      "every numbered task brief and review report",
      "relevant prior final reports",
      "current implementation state",
      "immutable history",
      "full cycle revision-plus-working-tree boundary",
      "Run exactly the checks your assigned disposition assigns",
      "security, test quality, and unresolved rulings",
      "Assemble the Report record above exactly once",
      "Return the completed-report notice",
    ])
      expect(instructions).toContain(marker);

    const position = (marker: string) => instructions.indexOf(marker);
    const ordered = [
      "Read the complete assignment first",
      "refuse the assignment and report instead of overwriting",
      "In `task-review`, name the exact numbered brief",
      "verifying acceptance criteria and validation evidence",
      "In `final-review`, read the complete available plan",
      "test quality, and unresolved rulings",
      "Assemble the Report record above exactly once",
      "Return the completed-report notice",
    ] as const;
    for (const marker of ordered)
      expect(position(marker)).toBeGreaterThanOrEqual(0);
    for (let index = 0; index < ordered.length - 1; index += 1)
      expect(position(ordered[index])).toBeLessThan(
        position(ordered[index + 1]),
      );
  });

  test("keeps full and reduced parity by narrowing only explicitly justified investigation and validation breadth", () => {
    const skill = resolvePackSkill(locator);
    const instructions = skill.listText("instructions");
    const everything = skill.everythingText();

    expect(instructions).toContain("`full` or `reduced`");
    for (const marker of [
      "In `reduced`",
      "explicitly justified",
      "investigation and validation breadth",
      "direct source inspection",
      "acceptance verification",
      "evidence standards",
      "every report field",
      "severities",
      "required corrections",
      "blocking gates",
      "identical to `full`",
    ])
      expect(everything).toContain(marker);
    expect(everything).toContain("weaker disposition than assigned");
  });

  test("one complete report contract serves every mode and disposition", () => {
    const skill = resolvePackSkill(locator);
    const markdown = skill.markdownText();
    const everything = skill.everythingText();

    expect(markdown).toContain("Report record");
    expect(markdown).toContain("carries the identical complete contract");
    for (const field of reportFields)
      expect(everything.split(field).length - 1).toBe(1);
    for (const marker of [
      "base and head revisions when available",
      "included uncommitted paths",
      "excluded pre-existing dirty paths",
      "generated check artifacts",
      "immutable once written",
    ])
      expect(markdown).toContain(marker);
  });

  test("pins the exact numbered report paths with independent counters", () => {
    const markdown = resolvePackSkill(locator).markdownText();

    for (const marker of [
      ".atlante/workflows/<cycle-id>/tasks/<task-id>/review-<n>.md",
      ".atlante/workflows/<cycle-id>/final-review-<n>.md",
      "brief, task-review, and final-review counters stay independent",
    ])
      expect(markdown).toContain(marker);
  });

  test("confines the reviewer to the sole assigned report write and refuses occupied targets", () => {
    const everything = resolvePackSkill(locator).everythingText();

    expect(everything).toContain("fresh read-only reviewer");
    expect(everything).toContain("never edit source or configuration");
    expect(everything).toContain("never correct findings yourself");
    expect(everything).toContain(
      "only intentional project write is the assigned",
    );
    expect(everything).toContain("rather than overwritten");
    expect(everything).toContain("trusted instead of rediscovered");
    expect(everything).not.toContain(
      "explicitly assigned source/configuration/test changes",
    );
  });

  test("blocks on critical, important, and failed checks with evidence-based clearing only", () => {
    const everything = resolvePackSkill(locator).everythingText();

    expect(everything).toContain("block progression");
    expect(everything).toContain(
      "evidence-based ruling that it is incorrect, inapplicable, or already satisfied",
    );
    expect(everything).toContain(
      "accepting or deferring valid risk does not clear it",
    );
    expect(everything).toContain("renewed developer approval");
  });

  test("stops rather than improvises and reports gates, boundaries, and failures honestly", () => {
    const skill = resolvePackSkill(locator);
    const invariants = skill.listText("invariants");
    const gotchas = skill.listText("gotchas");

    for (const marker of [
      "unavailable and never as passed",
      "incomplete or partially validated",
      "up the assigned workflow path",
      "smallest safe point",
      "improvise substitutes",
      "go back to the architect",
    ])
      expect(invariants).toContain(marker);
    expect(invariants).toMatch(/\bMUST\b/);
    for (const marker of [
      "preserve them untouched",
      "distinct from the reviewed change",
      "reading artifacts in full",
      "never substitutes",
    ])
      expect(gotchas).toContain(marker);
  });

  test("claims no adaptive, eligibility, mode-selection, or self-weakening authority", () => {
    const everything = resolvePackSkill(locator).everythingText();

    expect(everything).toContain("the architect");
    expect(everything.toLowerCase()).not.toMatch(/eligib/);
    expect(everything).not.toMatch(
      /\b(?:choose|decide|determine|pick|select)\s+(?:whether|when|which)\b/i,
    );
    const adaptiveLines = everything
      .split("\n")
      .filter((line) => line.toLowerCase().includes("adaptiv"));
    expect(adaptiveLines.length).toBeGreaterThan(0);
    for (const line of adaptiveLines) expect(line).toMatch(/never|MUST NOT/);
  });

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Review",
      "## Overview",
      "## Terms",
      "## Report record",
      "## Instructions",
      "## Gotchas",
      "## Invariants",
    ])
      expect(output).toContain(heading);
    for (const marker of [
      "- Mode, disposition, and inspected artifact lineage",
      "- Blocking verdict",
      ".atlante/workflows/<cycle-id>/tasks/<task-id>/review-<n>.md",
      ".atlante/workflows/<cycle-id>/final-review-<n>.md",
      "block progression",
      "MUST",
    ])
      expect(output).toContain(marker);

    const position = (heading: string) => output.indexOf(heading);
    expect(position("# Review")).toBeLessThan(position("## Overview"));
    expect(position("## Overview")).toBeLessThan(position("## Terms"));
    expect(position("## Terms")).toBeLessThan(position("## Report record"));
    expect(position("## Report record")).toBeLessThan(
      position("## Instructions"),
    );
    expect(position("## Instructions")).toBeLessThan(position("## Gotchas"));
    expect(position("## Gotchas")).toBeLessThan(position("## Invariants"));
  });
});
