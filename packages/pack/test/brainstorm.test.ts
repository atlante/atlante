import {
  createProjectResourcePack,
  interpolateValues,
  renderResolvedTemplate,
  resolveResourceInstance,
} from "@atlante/resources";
import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  packResourceFixture,
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

type ListSectionKind = "instructions" | "gotchas" | "invariants";

interface SkillInput {
  readonly title: string;
  readonly overview: string;
  readonly sections?: readonly Record<string, unknown>[];
}

interface SkillInstance {
  readonly input: SkillInput;
  readonly effectiveTemplate: { readonly locator: string };
}

function resolveBrainstorm(): { instance: SkillInstance } {
  const { root, config } = packResourceFixture();
  const instance = resolveResourceInstance(
    createProjectResourcePack(root),
    locator,
    config,
  );
  return { instance: instance as unknown as SkillInstance };
}

function listItems(input: SkillInput, kind: ListSectionKind): string[] {
  const items: string[] = [];
  for (const section of input.sections ?? []) {
    const value = section[kind];
    if (Array.isArray(value))
      items.push(
        ...value.filter((item): item is string => typeof item === "string"),
      );
  }
  return items;
}

function markdownText(input: SkillInput): string {
  return (input.sections ?? [])
    .map((section) =>
      typeof section.markdown === "string" ? section.markdown : "",
    )
    .join("\n");
}

function renderedOutput(input: SkillInput): string {
  const { instance } = resolveBrainstorm();
  return renderResolvedTemplate({
    template: instance.effectiveTemplate,
    input: interpolateValues(input, {}),
  });
}

describe("brainstorm skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template with one phase role", () => {
    const { instance } = resolveBrainstorm();

    expect(String(instance.effectiveTemplate.locator)).toBe(
      "@atlante/pack/skill",
    );
    expect(instance.input.title).toBe("Brainstorm");
    expect(instance.input.overview).toContain("`full`");
    expect(instance.input.overview).toContain("`reduced`");
    expect(instance.input.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      (instance.input.sections ?? []).some(
        (section) =>
          !("markdown" in section) &&
          !("instructions" in section) &&
          !("gotchas" in section) &&
          !("invariants" in section),
      ),
    ).toBe(false);
  });

  test("authored instructions carry the full and reduced procedures in order", () => {
    const { instance } = resolveBrainstorm();
    const instructions = listItems(instance.input, "instructions").join("\n");

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
    expect(indexOfMarker("Explore the repository")).toBeLessThan(
      indexOfMarker("two or three viable approaches"),
    );
    expect(indexOfMarker("two or three viable approaches")).toBeLessThan(
      indexOfMarker("approval after each section"),
    );
  });

  test("both dispositions share one identical nine-field handoff contract", () => {
    const { instance } = resolveBrainstorm();
    const markdown = markdownText(instance.input);
    const everything = [
      instance.input.overview,
      markdown,
      listItems(instance.input, "instructions").join("\n"),
      listItems(instance.input, "gotchas").join("\n"),
      listItems(instance.input, "invariants").join("\n"),
    ].join("\n");

    expect(markdown).toContain("Handoff contract");
    for (const field of handoffFields)
      expect(everything.split(field).length - 1).toBe(1);
    expect(markdown).toContain("no standalone brainstorming artifact");
    expect(listItems(instance.input, "invariants").join("\n")).toContain(
      "previously approved content",
    );
  });

  test("boundaries route authority up and stop rather than improvise", () => {
    const { instance } = resolveBrainstorm();
    const invariants = listItems(instance.input, "invariants").join("\n");
    const gotchas = listItems(instance.input, "gotchas").join("\n");

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
    const output = renderedOutput(resolveBrainstorm().instance.input);

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
