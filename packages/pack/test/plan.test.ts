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

function resolvePlan(): { instance: SkillInstance } {
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

function everythingText(input: SkillInput): string {
  return [
    input.overview,
    markdownText(input),
    listItems(input, "instructions").join("\n"),
    listItems(input, "gotchas").join("\n"),
    listItems(input, "invariants").join("\n"),
  ].join("\n");
}

function renderedOutput(): string {
  const { instance } = resolvePlan();
  return renderResolvedTemplate({
    template: instance.effectiveTemplate,
    input: interpolateValues(instance.input, {}),
  });
}

describe("plan skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template with one phase role", () => {
    const { instance } = resolvePlan();

    expect(String(instance.effectiveTemplate.locator)).toBe(
      "@atlante/pack/skill",
    );
    expect(instance.input.title).toBe("Plan");
    expect(instance.input.overview).toContain("`full`");
    expect(instance.input.overview).toContain("`reduced`");
    expect(instance.input.overview).toContain("original planner");
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

  test("authored instructions carry the planning lifecycle in order", () => {
    const { instance } = resolvePlan();
    const instructions = listItems(instance.input, "instructions").join("\n");

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

    const indexOfMarker = (marker: string) => instructions.indexOf(marker);
    expect(indexOfMarker("Read the complete assignment first")).toBeLessThan(
      indexOfMarker("new for this cycle"),
    );
    expect(indexOfMarker("new for this cycle")).toBeLessThan(
      indexOfMarker("Return the finished or updated plan"),
    );
  });

  test("both dispositions record one identical ten-field contract with one canonical adaptive decision", () => {
    const { instance } = resolvePlan();
    const markdown = markdownText(instance.input);
    const everything = everythingText(instance.input);

    expect(markdown).toContain("Plan record");
    for (const field of recordFields)
      expect(everything.split(field).length - 1).toBe(1);
    expect(markdown).toContain(
      "classification, evidence, disposition, and rationale supplied by the architect",
    );
    expect(markdown).toContain("cycle and each of its tasks");
    expect(listItems(instance.input, "invariants").join("\n")).toContain(
      "full record complete",
    );
  });

  test("authored contract pins the exact workflow artifact layout", () => {
    const { instance } = resolvePlan();
    const markdown = markdownText(instance.input);

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
    const { instance } = resolvePlan();
    const invariants = listItems(instance.input, "invariants").join("\n");
    const gotchas = listItems(instance.input, "gotchas").join("\n");

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
    const { instance } = resolvePlan();
    const everything = everythingText(instance.input);

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
    const output = renderedOutput();

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
