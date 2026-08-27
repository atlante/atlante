import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/build";
const briefFields = [
  "Scope",
  "Current decisions",
  "Cumulative changed files",
  "Acceptance evidence",
  "Validation evidence",
  "Concerns and received rulings",
  "Revision and working-tree boundary",
] as const;

describe("build skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one single-task worker role", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Build");
    expect(skill.overview).toContain(
      "one architect-assigned initial task or correction",
    );
    expect(skill.overview).toContain("fresh build worker");
    expect(skill.overview).toContain("cumulative brief");
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

  test("authored instructions carry the implementation lifecycle with the TDD chain in order", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const marker of [
      "Read the complete assignment first",
      "passed by exact shared path",
      "read in full or supplied verbatim",
      "identifiers, counter, path, and lineage",
      "refuse the assignment and report instead of overwriting",
      "rediscovering numbering",
      "observable behavior and the invariants it affects",
      "fail for the expected reason",
      "record that red evidence",
      "already passes or fails for an unrelated reason",
      "false red state",
      "smallest implementation",
      "meaningful boundary and failure cases",
      "what each relevant test proves",
      "why red-green feedback is not meaningful",
      "strongest relevant verification",
      "artificial tests",
      "complete previous report",
      "produce the next cumulative brief",
    ])
      expect(instructions).toContain(marker);

    expect(instructions).toContain("Return the completed-brief notice");

    const position = (marker: string) => instructions.indexOf(marker);
    for (const marker of [
      "Read the complete assignment first",
      "observable behavior and the invariants it affects",
      "fail for the expected reason",
      "false red state",
      "smallest implementation",
      "meaningful boundary and failure cases",
      "what each relevant test proves",
      "Return the completed-brief notice",
    ])
      expect(position(marker)).toBeGreaterThanOrEqual(0);
    expect(position("Read the complete assignment first")).toBeLessThan(
      position("observable behavior and the invariants it affects"),
    );
    expect(
      position("observable behavior and the invariants it affects"),
    ).toBeLessThan(position("fail for the expected reason"));
    expect(position("fail for the expected reason")).toBeLessThan(
      position("false red state"),
    );
    expect(position("false red state")).toBeLessThan(
      position("smallest implementation"),
    );
    expect(position("smallest implementation")).toBeLessThan(
      position("meaningful boundary and failure cases"),
    );
    expect(position("meaningful boundary and failure cases")).toBeLessThan(
      position("what each relevant test proves"),
    );
    expect(position("what each relevant test proves")).toBeLessThan(
      position("Return the completed-brief notice"),
    );
  });

  test("every brief records one identical seven-field cumulative handoff with lineage", () => {
    const skill = resolvePackSkill(locator);
    const markdown = skill.markdownText();
    const everything = skill.everythingText();

    expect(markdown).toContain("Brief record");
    expect(markdown).toContain("records the identical complete contract");
    expect(markdown).toContain("records the initial implementation alone");
    expect(markdown).toContain(
      "names the previous brief and the triggering report",
    );
    expect(markdown).toContain("summarizes the implementation delta");
    expect(markdown).toContain("cumulative current state");
    expect(everything).toContain("immutable once written");
    for (const marker of [
      "base and head revisions when available",
      "included uncommitted paths",
      "excluded pre-existing dirty paths",
      "generated check artifacts",
    ])
      expect(everything).toContain(marker);
    for (const field of briefFields)
      expect(everything.split(field).length - 1).toBe(1);
  });

  test("pins the exclusive assigned brief target and refuses overwrite without rediscovery", () => {
    const everything = resolvePackSkill(locator).everythingText();

    expect(everything).toContain(
      ".atlante/workflows/<cycle-id>/tasks/<task-id>/brief-<n>.md",
    );
    expect(everything).toContain("only intentional project write");
    expect(everything).toContain(
      "refuse the assignment and report instead of overwriting",
    );
    expect(everything).toContain("rather than overwritten");
    expect(everything).toContain("trusted instead of rediscovered");
  });

  test("keeps adaptive state, dispositions, and plan ownership out of build hands", () => {
    const everything = resolvePackSkill(locator).everythingText();

    expect(everything).toContain("the architect");
    expect(everything).toContain("routing and classification decision");
    expect(everything).toContain("original planner");
    expect(everything).toContain("fresh review is dispatched");

    const adaptiveLines = everything
      .split("\n")
      .filter((line) => line.toLowerCase().includes("adaptiv"));
    expect(adaptiveLines.length).toBeGreaterThan(0);
    for (const line of adaptiveLines)
      expect(line).toMatch(/MUST NOT|never|only|exclusively/);

    const planLines = everything
      .split("\n")
      .filter((line) => line.includes("`plan.md`"));
    expect(planLines.length).toBeGreaterThan(0);
    for (const line of planLines)
      expect(line).toMatch(/never|MUST NOT|original planner/);

    expect(everything).not.toContain("`full`");
    expect(everything).not.toContain("`reduced`");
    expect(everything).not.toMatch(/eligib/i);
    expect(everything).not.toMatch(
      /\b(?:choose|decide|determine|pick|select)\s+(?:whether|when|which)\b/i,
    );
  });

  test("routes scope honestly, stops when blocked, and reports gates truthfully", () => {
    const skill = resolvePackSkill(locator);
    const invariants = skill.listText("invariants");
    const gotchas = skill.listText("gotchas");

    for (const marker of [
      "go back to the architect",
      "narrower scope than assigned",
      "could not run is reported as unavailable and never as passed",
      "incomplete or partially validated",
      "travel up the assigned workflow path",
      "smallest safe point",
      "improvise substitutes",
      "source, configuration, and commit boundaries",
      "beyond the task scope",
    ])
      expect(invariants).toContain(marker);
    expect(invariants).toMatch(/\bMUST\b/);
    for (const marker of [
      "preserve them untouched",
      "byte-for-byte unchanged",
      "actual diff",
      "never substitutes",
    ])
      expect(gotchas).toContain(marker);
  });

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Build",
      "## Overview",
      "## Terms",
      "## Brief record",
      "## Instructions",
      "## Gotchas",
      "## Invariants",
    ])
      expect(output).toContain(heading);
    for (const marker of [
      "- Cumulative changed files",
      "- Revision and working-tree boundary",
      ".atlante/workflows/<cycle-id>/tasks/<task-id>/brief-<n>.md",
      "never update `plan.md`",
      "MUST",
    ])
      expect(output).toContain(marker);

    const position = (heading: string) => output.indexOf(heading);
    expect(position("# Build")).toBeLessThan(position("## Overview"));
    expect(position("## Overview")).toBeLessThan(position("## Terms"));
    expect(position("## Terms")).toBeLessThan(position("## Brief record"));
    expect(position("## Brief record")).toBeLessThan(
      position("## Instructions"),
    );
    expect(position("## Instructions")).toBeLessThan(position("## Gotchas"));
    expect(position("## Gotchas")).toBeLessThan(position("## Invariants"));
  });
});
