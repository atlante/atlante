import { afterEach, describe, expect, test } from "bun:test";
import {
  cleanupPackResourceFixtures,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/review";

describe("review skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one agent-agnostic read-only skill", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Review");
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["instructions", "invariants"]);
  });

  test("invariants keep the review read-only and grounded in primary evidence", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const marker of [
      "MUST NOT intentionally modify reviewed source, configuration, or tests, and MUST NOT correct findings yourself",
      "MUST NOT trust summaries or reported validation without reconciling them against the actual change and primary evidence",
      "MUST NOT report a finding without exact evidence, impact, and a required correction",
      "MUST NOT present supplied validation as independently verified, claim that an unperformed check passed",
    ])
      expect(invariants).toContain(marker);
  });

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Review",
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
