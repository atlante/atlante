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

const locator = "@atlante/pack/harness";
const approvedDescription =
  "Use when initializing, configuring, validating, building, troubleshooting, or improving an Atlante harness.";

const verifiedResources = [
  "https://docs.atlante.sh",
  "https://docs.atlante.sh/getting-started",
  "https://github.com/atlante/atlante/blob/main/SPECIFICATION.md",
  "https://atlante.sh/schema/v0.1/schema.json",
];

const policyAreas = [
  "Atlante concepts and document structure",
  "Choosing suitable first-party, local, or package resources",
  "Recognizing recurring workflow friction",
];

const mechanicsAreas = [
  "Initializing Atlante and creating or updating `atlante.jsonc`",
  "Running validation and build or materialization commands",
  "Integrating and troubleshooting the OpenCode adapter",
];

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

describe("harness skill instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("resolves through the existing skill template as one non-phase stewardship skill", () => {
    const skill = resolvePackSkill(locator);

    expect(skill.templateLocator).toBe("@atlante/pack/skill");
    expect(skill.title).toBe("Harness");
    expect(skill.overview).toContain("stewardship");
    expect(skill.overview).toContain("not a workflow phase");
    expect(skill.overview).not.toMatch(/\b(MUST|SHOULD|MAY)\b/);
    expect(
      skill.sections.map((section) => Object.keys(section).sort().join("+")),
    ).toEqual(["markdown", "instructions", "invariants", "references"]);
  });

  test("description carries the trigger-focused routing verbatim", () => {
    expect(instanceDescription()).toBe(approvedDescription);
  });

  test("coverage areas carry the permanent-policy and provisional-mechanics tags", () => {
    const skill = resolvePackSkill(locator);
    const context = skill.markdownText();

    expect(context).toContain("Permanent policy");
    expect(context).toContain("Provisional mechanics");
    const rowOf = (area: string): string => {
      const areaPosition = context.indexOf(area);
      expect(areaPosition, area).toBeGreaterThan(-1);
      const rowEnd = context.indexOf("\n", areaPosition);
      return context.slice(areaPosition, rowEnd);
    };
    for (const area of policyAreas)
      expect(rowOf(area), area).toContain("Permanent policy");
    for (const area of mechanicsAreas)
      expect(rowOf(area), area).toContain("Provisional mechanics");
  });

  test("keeps the thin-first scope and the deterministic-tools boundary", () => {
    const skill = resolvePackSkill(locator);
    const context = skill.markdownText();

    expect(context).toContain("provisional");
    expect(context.toLowerCase()).toContain("mcp");
    expect(context).toContain("tool descriptions");
  });

  test("explains the Atlante concepts and the source-versus-generated boundary", () => {
    const skill = resolvePackSkill(locator);
    const context = skill.markdownText();

    for (const concept of [
      "values",
      "agents",
      "skills",
      "templates",
      "presets",
      "bindings",
      "built artifacts",
    ])
      expect(context, concept).toContain(concept);
    expect(context).toContain("authoritative source configuration");
    expect(context).toContain("generated output");
  });

  test("instructions cover the three stewardship contexts in order", () => {
    const instructions = resolvePackSkill(locator).listText("instructions");

    for (const marker of [
      "verify them against the installed Atlante version and capabilities",
      "universal cold-start bootstrap path",
      "Inspect repository structure, conventions",
      "distinguish verified recommendations from unverified suggestions",
      "Validate, build, and materialize through capabilities verified from the project",
      "Preserve the phase boundaries and workflow invariants already in force",
      "without expanding the current task",
      "Turn observed workflow friction into an evidence-based suggestion",
      "its own workflow cycle",
      "stays a suggestion until its own cycle is approved",
    ])
      expect(instructions).toContain(marker);

    const position = (marker: string) => instructions.indexOf(marker);
    const bootstrap = position("verify them against the installed Atlante");
    const delivery = position("Validate, build, and materialize");
    const improvement = position(
      "Turn observed workflow friction into an evidence-based suggestion",
    );
    expect(bootstrap).toBeLessThan(delivery);
    expect(delivery).toBeLessThan(improvement);
  });

  test("bootstrap guidance states the CLI cold-start boundary without claiming early availability", () => {
    const skill = resolvePackSkill(locator);
    const everything = skill.everythingText();

    expect(everything).toContain("universal cold-start bootstrap path");
    expect(everything).toContain("only after the harness and host expose it");
  });

  test("invariants carry the safety gates", () => {
    const invariants = resolvePackSkill(locator).listText("invariants");

    for (const marker of [
      "MUST NOT direct edits to generated artifacts",
      "MUST NOT invent unavailable resources, configuration keys, commands, tool capabilities, or host behavior",
      "MUST obtain explicit developer approval before changing the harness or expanding an unrelated task into harness work",
      "MUST run an accepted improvement as its own delivery cycle",
      "MUST NOT report an initialization, validation, build, or materialization outcome without command or tool evidence",
    ])
      expect(invariants).toContain(marker);
  });

  test("a single References section lists exactly the verified entry points", () => {
    const skill = resolvePackSkill(locator);
    const output = skill.renderedOutput();

    expect(output.match(/## References/g)?.length).toBe(1);
    expect(skill.referencesText()).toContain("Documentation root");
    expect(skill.referencesText()).toContain("Getting-started guide");
    expect(skill.referencesText()).toContain("Specification");
    expect(skill.referencesText()).toContain("JSON Schema");
    for (const url of verifiedResources) expect(output, url).toContain(url);

    const referencesStart = output.indexOf("## References");
    const beforeReferences = output.slice(0, referencesStart);
    for (const url of verifiedResources)
      expect(beforeReferences, `scattered: ${url}`).not.toContain(url);

    const everything = skill.everythingText();
    const urls = everything.match(/https?:\/\/[^\s)`>]+/g) ?? [];
    expect(urls.sort()).toEqual([...verifiedResources].sort());
  });

  test("stands alone offline without directing network access or copying documentation", () => {
    const skill = resolvePackSkill(locator);
    const everything = skill.everythingText();

    expect(everything).toContain("stands alone without network access");
    expect(everything).not.toMatch(/\b(fetch|download|curl|wget)\b/i);
    expect(everything).not.toMatch(/\bcopy (the|this) documentation\b/i);
  });

  test("renders structural landmarks in the shared section order", () => {
    const output = resolvePackSkill(locator).renderedOutput();

    for (const heading of [
      "# Harness",
      "## Overview",
      "## Instructions",
      "## Invariants",
      "## References",
    ])
      expect(output).toContain(heading);
    expect(output).not.toContain("## Workflow");
    expect(output).not.toContain("## Gotchas");
    expect(output).not.toContain("## Resources");

    const position = (heading: string) => output.indexOf(heading);
    expect(position("## Overview")).toBeLessThan(
      position("## Operating context"),
    );
    expect(position("## Operating context")).toBeLessThan(
      position("## Instructions"),
    );
    expect(position("## Instructions")).toBeLessThan(position("## Invariants"));
    expect(position("## Invariants")).toBeLessThan(position("## References"));
  });
});
