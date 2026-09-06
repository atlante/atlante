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

const locator = "@atlante/pack/architect";

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
  instructions: [
    "Inspect applicable `AGENTS.md` files, skills, and host instructions before acting; audit them for conflicts and, when one causes a pause or deviation, name the exact file and instruction and explain how it applies.",
    "When a developer request indicates action, treat it as authorization for reversible, read-only, and routine work; persist until the intended task is complete instead of stopping at acknowledgement, a plan, or a partial result.",
    "Before asking a clarifying question or approval, complete authorized read-only work needed to make the decision concrete and reviewable; ask only when the answer could materially change the outcome, authorization is missing, or an explicit project invariant requires approval.",
    "When independent work can be safely parallelized and collaboration tools are available, delegate it; keep dependent work sequential and reconcile delegated results before acting.",
    "Choose only the workflow phases and skills that materially improve the result; omitted phases require no classification, placeholder, or artifact, but implementation is not complete until it has an independent review or a stated reason for omitting one.",
    "Run selected workflow phases in their listed order and scale their depth to the work's complexity, risk, uncertainty, and available evidence while preserving any required output.",
    "Reassess the remaining workflow phases when new material evidence changes the work.",
    "When current work touches Atlante initialization, source configuration, resources, artifacts, validation, materialization, host integration, or harness improvement, load the `harness` skill alongside the active phase skills; it supplements them rather than replacing them, and an accepted harness improvement runs as its own delivery cycle.",
    "State the main point early. Use clear, concise prose, active voice, and plain language. Use lists only when they improve scanning, and match the developer's requested format.",
  ],
  phases: ["Brainstorm", "Plan", "Build", "Review"],
} as const;

interface ResolvedArchitect {
  readonly input: JsonObject;
  readonly templateLocator: string;
  readonly sectionKinds: readonly string[];
  readonly workflow: JsonObject;
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

describe("architect agent instance", () => {
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

  test("owns exactly the six approved invariants in order", () => {
    const architect = resolveArchitect();
    const sections = (architect.input.sections ?? []) as readonly JsonObject[];

    expect(sections[0]?.invariants).toEqual(approved.invariants);
  });

  test("owns exactly the nine approved instructions in order", () => {
    const architect = resolveArchitect();
    const sections = (architect.input.sections ?? []) as readonly JsonObject[];

    expect(sections[1]?.instructions).toEqual(approved.instructions);
  });

  test("includes concise communication guidance in the instructions", () => {
    const output = resolveArchitect().renderedOutput();

    expect(output).toContain(
      "State the main point early. Use clear, concise prose, active voice, and plain language.",
    );
    expect(output).not.toContain("## Communication");
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
});
