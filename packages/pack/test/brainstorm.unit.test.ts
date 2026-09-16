import { afterEach, describe, expect, test } from "bun:test";
import {
  cleanupPackResourceFixtures,
  instanceDescription,
  resolvePackSkill,
} from "./selection-fixture.js";

const locator = "@atlante/pack/brainstorm";

describe("brainstorm skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one agent-agnostic skill", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Brainstorm");
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["instructions", "invariants"]);
  });

  test("description resolves uncertainty and defines direction", () => {
    const description = instanceDescription(locator);

    expect(description).toContain("uncertainty");
    expect(description).toMatch(/\bdefin/i);
    expect(description).toContain("direction");
  });

  test("invariants guard honesty about uncertainty and scope", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const marker of [
      "MUST NOT invent answers, hide material uncertainty, or silently expand the agreed scope",
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
    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Overview")).toBeLessThan(position("## Instructions"));
    expect(position("## Instructions")).toBeLessThan(position("## Invariants"));
  });
});
