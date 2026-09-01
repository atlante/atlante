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
    expect(skill.overview).toContain("without modifying it");
    expect(skill.overview).toContain("truthful verdict");
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["instructions", "invariants"]);
  });

  test("scopes focused and whole-change reviews with named-risk boundary expansion only", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    expect(instructions).toContain(
      "Establish the actual reviewed boundary from source control and the working tree",
    );
    expect(instructions).toContain(
      "verify every material claim against primary evidence",
    );
    expect(instructions).toContain(
      "For a focused task review, inspect the changed behavior and its immediate integration boundary",
    );
    expect(instructions).toContain(
      "for a whole-change review, inspect the complete change set and cross-task interactions",
    );
    expect(instructions).toContain(
      "Inspect outside that boundary only to evaluate a concrete risk you can name, and record both the risk and what you inspected",
    );
    expect(instructions).toContain(
      "MUST NOT omit direct source inspection, acceptance verification, or the evidence needed to support the verdict",
    );

    const focused = instructions.indexOf("For a focused task review");
    const whole = instructions.indexOf("for a whole-change review");
    expect(focused).toBeGreaterThanOrEqual(0);
    expect(whole).toBeGreaterThan(focused);
    expect(whole).toBeLessThan(instructions.indexOf("cross-task interactions"));
  });

  test("assesses acceptance compliance and re-reviews corrections per finding", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    expect(instructions).toContain(
      "identify anything missing, extra, misunderstood, or unverifiable",
    );
    expect(instructions).toContain(
      "distinguish implementation defects from ambiguity or defects in the requirements themselves",
    );
    expect(instructions).toContain(
      "For a correction re-review, verify each prior finding against the correction boundary",
    );
    expect(instructions).toContain("MUST NOT reopen unaffected code");
    expect(instructions).toContain(
      "`ADDRESSED` or `NOT ADDRESSED` verdict with evidence for each prior finding",
    );
  });

  test("weights supplied evidence, runs only focused checks, and records evidence-backed findings", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    expect(instructions).toContain(
      "Evaluate supplied validation evidence for completeness and consistency before running commands",
    );
    expect(instructions).toContain(
      "Report supplied evidence separately from checks run directly",
    );
    expect(instructions).toContain("Run only the focused checks needed");
    expect(instructions).toContain(
      "SHOULD NOT repeat broad validation when sufficient evidence already exists",
    );
    expect(instructions).toContain(
      "`critical`, `important`, or `minor` with an exact location, evidence, impact, and required correction",
    );
    expect(instructions).toContain(
      "omit speculative concerns and optional style preferences",
    );
  });

  test("returns an evidence-backed PASS or BLOCKED verdict", () => {
    const skill = resolvePackSkill(locator);
    const instructions = skill.listText("instructions");
    const invariants = skill.listText("invariants");

    expect(instructions).toContain("`PASS` or `BLOCKED` verdict");
    expect(instructions).toContain(
      "the verdict agrees with the findings and check results",
    );
    expect(invariants).toContain(
      "Any unresolved critical or important finding or failed required check MUST make the verdict `BLOCKED`",
    );
    expect(invariants).toContain(
      "return `PASS` when evidence required to substantiate acceptance is missing",
    );
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

  test("carries no removed disposition, mode, or workflow-artifact semantics", () => {
    const skill = resolvePackSkill(locator);
    const everything = skill.everythingText();

    expect(skill.markdownText().trim()).toBe("");
    expect(everything).not.toContain("`full`");
    expect(everything).not.toContain("`reduced`");
    expect(everything).not.toMatch(/`task-review`|`final-review`/);
    expect(everything).not.toMatch(/\barchitect\b/i);
    expect(everything).not.toMatch(/disposition|eligib/i);
    expect(everything).not.toContain(".atlante/");
    expect(everything).not.toContain("Report record");
    expect(everything).not.toMatch(/\bimmutable\b/i);
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
    expect(output).toContain("`PASS` or `BLOCKED` verdict");
    expect(output).toContain(
      "- Any unresolved critical or important finding or failed required check MUST make the verdict `BLOCKED`.",
    );
    expect(output).not.toContain("## Gotchas");
    expect(output).not.toContain("## Report record");

    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Overview")).toBeLessThan(position("## Instructions"));
    expect(position("## Instructions")).toBeLessThan(position("## Invariants"));
  });
});
