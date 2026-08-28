import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/brainstorm";

describe("brainstorm skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one agent-agnostic skill", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Brainstorm");
    expect(skill.overview).toContain("explicitly approved direction");
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["instructions", "invariants"]);
  });

  test("instructions carry the clarification-to-approval lifecycle in order", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const marker of [
      "inspect only the project context needed to understand it before asking questions",
      "Scale exploration and discussion to the complexity, risk, and uncertainty",
      "increase the depth instead of continuing with an undersized design",
      "Propose a parent-and-child decomposition",
      "refine one child at a time",
      "Ask one focused question at a time",
      "prefer multiple-choice questions",
      "present two or three viable approaches with their trade-offs",
      "lead with a recommendation",
      "Keep the scope minimal with YAGNI",
      "obtain explicit approval for simple work",
      "confirm each section before continuing",
      "Assemble the explicitly approved handoff",
      "check it for placeholders, contradictions, ambiguity, and unnecessary scope",
    ])
      expect(instructions).toContain(marker);

    const position = (marker: string) => instructions.indexOf(marker);
    expect(position("inspect only the project context")).toBeLessThan(
      position("present two or three viable approaches"),
    );
    expect(position("present two or three viable approaches")).toBeLessThan(
      position("Assemble the explicitly approved handoff"),
    );
  });

  test("the assembled handoff records the agreed design fields", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const field of [
      "purpose",
      "agreed scope and exclusions",
      "constraints",
      "acceptance criteria",
      "chosen approach",
      "relevant repository evidence",
      "assumptions",
      "rejected alternatives or remaining open decisions",
    ])
      expect(instructions).toContain(field);
  });

  test("invariants guard approval, honesty, and decision stability", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const marker of [
      "Do not begin implementation before the direction is explicitly approved",
      "Do not invent answers, hide material uncertainty, or silently expand the agreed scope",
      "Preserve agreed decisions unless they are explicitly changed",
    ])
      expect(invariants).toContain(marker);
  });

  test("carries no removed disposition or orchestrator semantics", () => {
    const skill = resolvePackSkill(locator);
    const everything = skill.everythingText();

    expect(skill.markdownText().trim()).toBe("");
    expect(everything).not.toContain("`full`");
    expect(everything).not.toContain("`reduced`");
    expect(everything).not.toMatch(/\barchitect\b/i);
    expect(everything).not.toMatch(/disposition|eligib/i);
    expect(everything).not.toContain(".atlante/");
    expect(everything).not.toContain("standalone brainstorming artifact");
  });

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Brainstorm",
      "## Overview",
      "## Instructions",
      "## Invariants",
    ])
      expect(output).toContain(heading);
    expect(output).toContain("Ask one focused question at a time");
    expect(output).toContain(
      "- Do not begin implementation before the direction is explicitly approved.",
    );
    expect(output).not.toContain("## Gotchas");
    expect(output).not.toContain("## Handoff contract");

    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Overview")).toBeLessThan(position("## Instructions"));
    expect(position("## Instructions")).toBeLessThan(position("## Invariants"));
  });
});
