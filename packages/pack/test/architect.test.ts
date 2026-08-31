import {
  createProjectResourcePack,
  interpolateValues,
  type JsonObject,
  renderResolvedTemplate,
  resolveResourceDocument,
  resolveResourceInstance,
} from "@atlante/resources";
import { validateResolvedDocument } from "@atlante/validator";
import { afterEach, describe, expect, test } from "vitest";
import {
  cleanupPackResourceFixtures,
  packResourceFixture,
} from "./selection-fixture.js";

const locator = "@atlante/pack/architect";

const approved = {
  description:
    "General-purpose Atlante agent for planning, implementing, and reviewing software changes.",
  identity: "You are the lead engineer for {{values.project}}.",
  mission:
    "You are responsible for completing the developer's request with the smallest process that produces a correct, verified result.",
  invariants: [
    "Treat the developer's request as the scope of work; MUST ask before expanding or materially changing it.",
    "MUST preserve unrelated user changes.",
    "MUST NOT claim completion or successful validation without reporting the checks run, their results, and any checks that could not run.",
  ],
  instructions: [
    "Choose only the workflow phases and skills that materially improve the result; omitted phases require no classification, placeholder, or artifact.",
    "Run selected workflow phases in their listed order and scale their depth to the work's complexity, risk, uncertainty, and available evidence while preserving any required output.",
    "Reassess the remaining workflow phases when new material evidence changes the work.",
  ],
  phases: ["Brainstorm", "Plan", "Build", "Review"],
} as const;

interface ResolvedArchitect {
  readonly input: JsonObject;
  readonly templateLocator: string;
  readonly sectionKinds: readonly string[];
  readonly workflow: JsonObject;
  prose(): string;
  renderedOutput(): string;
}

function resolveArchitect(): ResolvedArchitect {
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
  const listItems = (kind: "instructions" | "invariants"): string[] =>
    sections.flatMap((section) =>
      Array.isArray(section[kind])
        ? (section[kind] as unknown[]).filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    );
  return {
    input,
    templateLocator: resolved.effectiveTemplate.locator,
    sectionKinds: sections.map((section) => Object.keys(section)[0] ?? ""),
    workflow: (workflowSection?.workflow ?? {}) as JsonObject,
    prose: () =>
      [
        typeof input.description === "string" ? input.description : "",
        typeof input.mission === "string" ? input.mission : "",
        ...listItems("invariants"),
        ...listItems("instructions"),
      ].join("\n"),
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

describe("architect agent instance", () => {
  afterEach(cleanupPackResourceFixtures);

  test("validates against the composed agent, workflow, and artifact schemas", () => {
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
    const architect = resolveArchitect();

    expect(architect.templateLocator).toBe("@atlante/pack/agent");
    const output = architect.renderedOutput();
    for (const heading of ["## Invariants", "## Instructions", "## Workflow"])
      expect(output, heading).toContain(heading);
  });

  test("keeps the approved description, identity, and mission verbatim", () => {
    const architect = resolveArchitect();

    expect(architect.input.description).toBe(approved.description);
    expect(architect.input.identity).toBe(approved.identity);
    expect(architect.input.mission).toBe(approved.mission);
  });

  test("has no responsibilities property or rendered Responsibilities section", () => {
    const architect = resolveArchitect();

    expect(architect.input.responsibilities).toBeUndefined();
    expect(architect.renderedOutput()).not.toContain("## Responsibilities");
  });

  test("owns exactly the three approved invariants in order", () => {
    const architect = resolveArchitect();
    const sections = (architect.input.sections ?? []) as readonly JsonObject[];

    expect(sections[0]?.invariants).toEqual(approved.invariants);
  });

  test("owns exactly the three approved instructions in order", () => {
    const architect = resolveArchitect();
    const sections = (architect.input.sections ?? []) as readonly JsonObject[];

    expect(sections[1]?.instructions).toEqual(approved.instructions);
  });

  test("keeps the sections ordered as invariants, instructions, workflow", () => {
    const architect = resolveArchitect();

    expect(architect.sectionKinds).toEqual([
      "invariants",
      "instructions",
      "workflow",
    ]);
  });

  test("resolves the nested workflow instance with ordered phases", () => {
    const architect = resolveArchitect();

    expect(architect.workflow).toEqual(resolvedWorkflowInput());
    expect(
      (architect.workflow.phases as readonly JsonObject[] | undefined)?.map(
        (phase) => phase.name,
      ),
    ).toEqual([...approved.phases]);
  });

  test("renders Brainstorm, Plan, Build, and Review in order", () => {
    const architect = resolveArchitect();
    const output = architect.renderedOutput();
    const markers = approved.phases.map(
      (name, index) => `### ${index + 1}. ${name}`,
    );

    for (const marker of markers) expect(output, marker).toContain(marker);
    for (let index = 1; index < markers.length; index++)
      expect(output.indexOf(markers[index - 1])).toBeLessThan(
        output.indexOf(markers[index]),
      );
  });

  test("carries no removed orchestration, delegation, or artifact policy prose", () => {
    const architect = resolveArchitect();
    const prose = architect.prose();
    const output = architect.renderedOutput();

    for (const removed of [
      "Plan, implement, and review Atlante work",
      "Orchestrate every workflow cycle",
      "sole durable control plane",
      "isolated worker",
      "delegat",
      "disposition",
      "placeholder plan",
      "orchestratorReadOnly",
      "adaptive",
      "maxLoops",
      "plan.md",
      "brief-<n>.md",
      "review-<n>.md",
      "final-review",
      "Brainstorm and intake",
      "Task review",
      "Final review",
      "MUST NOT edit project source",
      "MUST NOT substitute self-review",
      "commit",
    ])
      expect(prose, removed).not.toContain(removed);
    for (const removed of [
      "## Policies",
      "(adaptive)",
      "(mandatory)",
      "Correction MUST be limited",
    ])
      expect(output, removed).not.toContain(removed);
  });
});
