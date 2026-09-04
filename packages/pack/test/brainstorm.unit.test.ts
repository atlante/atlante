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

const locator = "@atlante/pack/brainstorm";

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

  test("description resolves uncertainty and defines direction", () => {
    const description = instanceDescription();

    expect(description).toContain("uncertainty");
    expect(description).toMatch(/\bdefin/i);
    expect(description).toContain("direction");
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

  test("invariants guard honesty and decision stability", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const marker of [
      "MUST NOT invent answers, hide material uncertainty, or silently expand the agreed scope",
      "MUST preserve agreed decisions unless they are explicitly changed",
    ])
      expect(invariants).toContain(marker);
  });

  test("invariants stop drifting, looping, or stalling exploration by exposing unresolved doubts", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const pattern of [/stop/i, /drift/i, /loop/i, /stall/i, /doubt/i])
      expect(invariants, String(pattern)).toMatch(pattern);
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
    expect(output).toContain("obtain explicit approval for simple work");
    expect(output).toContain(
      "- MUST preserve agreed decisions unless they are explicitly changed.",
    );
    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Overview")).toBeLessThan(position("## Instructions"));
    expect(position("## Instructions")).toBeLessThan(position("## Invariants"));
  });
});
