import { afterEach, describe, expect, test } from "bun:test";
import {
  createProjectResourcePack,
  interpolateValues,
  type JsonObject,
  renderResolvedTemplate,
  resolveResourceDocument,
  resolveResourceInstance,
} from "@atlante/resources";
import { validateResolvedDocument } from "@atlante/validator";
import {
  cleanupPackResourceFixtures,
  packResourceFixture,
} from "./selection-fixture.js";

const locator = "@atlante/pack/atlante";

const approved = {
  description:
    "General-purpose Atlante agent for planning, implementing, and reviewing software changes.",
  identity: "You are the lead engineer for {{values.project}}.",
  mission:
    "You are responsible for completing the developer's request with the smallest process that produces a correct, verified result.",
  invariants: [
    "Developer directives MUST take precedence over this agent prompt, selected workflow phases, and skill instructions.",
    "Treat the developer's request as the scope of work; MUST ask before expanding or materially changing it.",
    "MUST preserve unrelated user changes.",
    "MUST NOT claim completion or successful validation without reporting the checks run, their results, and any checks that could not run.",
    "MUST obtain explicit developer approval before changing the harness or expanding an unrelated task into harness work.",
    "MUST NOT direct edits to generated artifacts; source configuration is the editable surface and generated output is reproduced through validated build or materialization.",
  ],
  phases: ["Brainstorm", "Plan", "Build", "Review"],
} as const;

interface ResolvedAtlante {
  readonly input: JsonObject;
  readonly templateLocator: string;
  readonly sectionKinds: readonly string[];
  readonly workflow: JsonObject;
  renderedOutput(): string;
}

function resolveAtlante(): ResolvedAtlante {
  const { root, config } = packResourceFixture();
  const resolved = resolveResourceInstance(
    createProjectResourcePack(root),
    locator,
    config,
  );
  const input = resolved.input as JsonObject;
  const sections = (input.sections ?? []) as readonly JsonObject[];
  const workflowSection = sections.find(
    (section) => section.workflow !== undefined,
  );
  return {
    input,
    templateLocator: resolved.effectiveTemplate.locator,
    sectionKinds: sections.map((section) => Object.keys(section)[0] ?? ""),
    workflow: (workflowSection?.workflow ?? {}) as JsonObject,
    renderedOutput: () =>
      renderResolvedTemplate({
        template: resolved.effectiveTemplate,
        input: interpolateValues(resolved.input, {
          project: "Atlante",
          "workflow-root": ".atlante/workflows",
        }),
      }),
  };
}

function resolvedWorkflowInput(): JsonObject {
  const { root, config } = packResourceFixture();
  return resolveResourceInstance(
    createProjectResourcePack(root),
    "@atlante/pack/workflow",
    config,
  ).input as JsonObject;
}

describe("atlante agent instance", () => {
  afterEach(cleanupPackResourceFixtures);

  // Full transitive resolution and validation can approach bun's 5s default
  // timeout on loaded CI runners.
  test("validates against the composed agent, workflow, and artifact schemas", {
    timeout: 30_000,
  }, () => {
    const { root, config } = packResourceFixture();
    const document = resolveResourceDocument({
      pack: createProjectResourcePack(root),
      rootFile: config,
      bindingCollections: [
        {
          key: "agents",
          subject: "agent",
          defaultTemplate: "@atlante/pack/agent",
        },
        {
          key: "skills",
          subject: "skill",
          defaultTemplate: "@atlante/pack/skill",
        },
      ],
    });

    expect(validateResolvedDocument(document)).toEqual([]);
  });

  test("renders through the agent template with the control-plane sections", () => {
    const atlante = resolveAtlante();

    expect(atlante.templateLocator).toBe("@atlante/pack/agent");
    const output = atlante.renderedOutput();
    for (const heading of ["## Invariants", "## Instructions", "## Workflow"])
      expect(output, heading).toContain(heading);
  });

  test("keeps the approved description, identity, and mission verbatim", () => {
    const atlante = resolveAtlante();

    expect(atlante.input.description).toBe(approved.description);
    expect(atlante.input.identity).toBe(approved.identity);
    expect(atlante.input.mission).toBe(approved.mission);
  });

  test("has no responsibilities property or rendered Responsibilities section", () => {
    const atlante = resolveAtlante();

    expect(atlante.input.responsibilities).toBeUndefined();
    expect(atlante.renderedOutput()).not.toContain("## Responsibilities");
  });

  test("owns exactly the six approved invariants in order", () => {
    const atlante = resolveAtlante();
    const sections = (atlante.input.sections ?? []) as readonly JsonObject[];

    expect(sections[0]?.invariants).toEqual(approved.invariants);
  });

  test("keeps the sections ordered as invariants, instructions, workflow", () => {
    const atlante = resolveAtlante();

    expect(atlante.sectionKinds).toEqual([
      "invariants",
      "instructions",
      "workflow",
    ]);
  });

  test("resolves the nested workflow instance with ordered phases", () => {
    const atlante = resolveAtlante();

    expect(atlante.workflow).toEqual(resolvedWorkflowInput());
    expect(
      (atlante.workflow.phases as readonly JsonObject[] | undefined)?.map(
        (phase) => phase.name,
      ),
    ).toEqual([...approved.phases]);
  });

  test("renders Brainstorm, Plan, Build, and Review in order", () => {
    const atlante = resolveAtlante();
    const output = atlante.renderedOutput();
    const markers = approved.phases.map(
      (name, index) => `### ${index + 1}. ${name}`,
    );

    for (const marker of markers) expect(output, marker).toContain(marker);
    for (let index = 1; index < markers.length; index++)
      expect(output.indexOf(markers[index - 1])).toBeLessThan(
        output.indexOf(markers[index]),
      );
  });
});
