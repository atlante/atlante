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

type WorkflowPhase = JsonObject & {
  readonly name?: string;
  readonly policies?: JsonObject;
  readonly instructions?: readonly string[];
};

interface ResolvedArchitect {
  readonly templateLocator: string;
  readonly responsibilities: readonly string[];
  readonly invariantsText: string;
  readonly instructionsText: string;
  readonly workflow: {
    readonly title?: string;
    readonly policies?: JsonObject;
    readonly phases: readonly WorkflowPhase[];
  };
  phaseInstructions(name: string): readonly string[];
  everythingText(): string;
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
  const listItems = (kind: "instructions" | "invariants"): string[] =>
    sections.flatMap((section) =>
      Array.isArray(section[kind])
        ? (section[kind] as unknown[]).filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    );
  const workflowSection = sections.find(
    (section) => section.workflow !== undefined,
  );
  const workflow = (workflowSection?.workflow ?? {}) as JsonObject as {
    title?: string;
    policies?: JsonObject;
    phases?: WorkflowPhase[];
  };
  const phases = workflow.phases ?? [];
  const responsibilities = Array.isArray(input.responsibilities)
    ? (input.responsibilities as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : [];

  return {
    templateLocator: resolved.effectiveTemplate.locator,
    responsibilities,
    invariantsText: listItems("invariants").join("\n"),
    instructionsText: listItems("instructions").join("\n"),
    workflow: { ...workflow, phases },
    phaseInstructions: (name) =>
      (phases.find((phase) => phase.name === name)?.instructions ?? []).map(
        String,
      ),
    everythingText: () =>
      [
        ...responsibilities,
        ...listItems("invariants"),
        ...listItems("instructions"),
        ...phases.flatMap((phase) => (phase.instructions ?? []).map(String)),
      ].join("\n"),
    renderedOutput: () =>
      renderResolvedTemplate({
        template: resolved.effectiveTemplate,
        input: interpolateValues(resolved.input, { project: "Atlante" }),
      }),
  };
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
    for (const heading of [
      "## Responsibilities",
      "## Invariants",
      "## Instructions",
      "## Workflow",
    ])
      expect(output, heading).toContain(heading);
  });

  test("owns every control-plane concern as the sole durable control plane", () => {
    const architect = resolveArchitect();
    const owned = architect.responsibilities.join("\n");

    expect(owned).toContain("sole durable control plane");
    for (const concern of [
      "routing",
      "state transitions",
      "adaptive decisions",
      "approvals",
      "escalation",
      "artifact path allocation and transfer",
      "correction bounds",
      "finding rulings",
      "completion gates",
    ])
      expect(owned, concern).toContain(concern);
  });

  test("keeps a read-only control plane in its invariants", () => {
    const architect = resolveArchitect();
    const invariants = architect.invariantsText;

    expect(invariants).toMatch(
      /MUST NOT edit project source or configuration files/,
    );
    expect(invariants).toMatch(
      /MUST NOT substitute self-review for delegated independent review/,
    );
    expect(invariants).toContain("approved external issue or task");
    expect(invariants).toContain("non-file workflow state");
  });

  test("executes required brainstorm work itself and delegates every other phase", () => {
    const architect = resolveArchitect();
    const everything = architect.everythingText();

    expect(everything).toContain("Run the required `brainstorm` work yourself");
    expect(everything).toContain("fresh isolated worker");
    expect(architect.phaseInstructions("Plan").join(" ")).toMatch(
      /delegate it through the `plan` skill to a fresh isolated worker/,
    );
    expect(architect.phaseInstructions("Build").join(" ")).toMatch(
      /every initial task and every correction through the `build` skill to a fresh isolated worker/,
    );
    expect(architect.phaseInstructions("Task review").join(" ")).toMatch(
      /delegate it through the `review` skill to a fresh isolated worker/,
    );
    expect(architect.phaseInstructions("Final review").join(" ")).toMatch(
      /delegate it through the `review` skill to a fresh isolated worker/,
    );
  });

  test("composes the structured five-phase workflow with adaptive policy and a mandatory build", () => {
    const architect = resolveArchitect();

    expect(architect.workflow.policies).toEqual({ orchestratorReadOnly: true });
    expect(architect.workflow.phases.map((phase) => phase.name)).toEqual([
      "Brainstorm and intake",
      "Plan",
      "Build",
      "Task review",
      "Final review",
    ]);
    const policies = architect.workflow.phases.map(
      (phase) => phase.policies ?? {},
    );
    expect(policies).toEqual([
      { adaptive: true },
      { adaptive: true },
      { maxLoops: 5 },
      { adaptive: true },
      { adaptive: true },
    ]);

    const output = architect.renderedOutput();
    expect(output).toContain(
      "The orchestrator is read-only and delegates every file edit.",
    );
    expect(output).toContain("### 1. Brainstorm and intake (adaptive)");
    expect(output).toContain("### 2. Plan (adaptive)");
    expect(output).toContain("### 3. Build (mandatory)");
    expect(output).toContain("### 4. Task review (adaptive)");
    expect(output).toContain("### 5. Final review (adaptive)");
    expect(output).toContain("Correction MUST be limited to 5 loops per task.");
  });

  test("carries the adaptive eligibility blocks as phase instructions", () => {
    const architect = resolveArchitect();

    const intake = architect
      .phaseInstructions("Brainstorm and intake")
      .join("\n");
    expect(intake).toContain(
      "approved, unambiguous scope and success contract",
    );
    expect(intake).toContain("reduced confirmation");
    expect(intake).toContain("full interactive brainstorming");
    expect(intake).toContain("material ambiguity");

    const plan = architect.phaseInstructions("Plan").join("\n");
    expect(plan).toContain(
      "self-contained low-risk task with no design choice or dependency sequencing",
    );
    expect(plan).toContain("reduced plan");
    expect(plan).toContain("full plan");
    expect(plan).toContain(
      "high-risk, cross-cutting, dependent, sequenced, or materially uncertain",
    );

    const taskReview = architect.phaseInstructions("Task review").join("\n");
    expect(taskReview).toContain(
      "semantics-preserving mechanical work with meaningful verification",
    );
    expect(taskReview).toContain("reduced review");
    expect(taskReview).toContain("full review");
    expect(taskReview).toContain(
      "runtime behavior, public API, security or privacy, persistent data, migrations, concurrency, shared core code",
    );

    const finalReview = architect.phaseInstructions("Final review").join("\n");
    expect(finalReview).toContain(
      "no integration concern and passing required validation",
    );
    expect(finalReview).toContain("reduced review");
    expect(finalReview).toContain("full review");
    expect(finalReview).toContain("multiple interacting tasks");
  });

  test("defaults conservatively and never silently weakens dispositions", () => {
    const architect = resolveArchitect();
    const instructions = architect.instructionsText;

    expect(instructions).toMatch(
      /Missing evidence, conflicting signals, failed tests, unexpected coupling, review findings, dependency changes, or material uncertainty require conservative escalation/,
    );
    expect(instructions).toMatch(
      /default the affected adaptive phase to `full`/,
    );
    expect(instructions).toMatch(/MAY strengthen a disposition/);
    expect(instructions).toMatch(/MUST NOT be silently weakened/);
    expect(instructions).toMatch(
      /cost or time pressure alone MUST NOT justify weakening one/,
    );
    expect(instructions).toMatch(
      /a phase MUST be reduced or skipped only when all of its eligibility conditions are positively established/,
    );
    expect(instructions).toMatch(/reclassification/i);
    expect(instructions).toContain(
      "Material contract changes require renewed developer approval",
    );
  });

  test("records the adaptive decision before acting in one canonical place", () => {
    const architect = resolveArchitect();
    const instructions = architect.instructionsText;

    expect(instructions).toMatch(/Before acting/);
    expect(instructions).toMatch(/work type/);
    expect(instructions).toMatch(/blast radius/);
    expect(instructions).toContain("`full`, `reduced`, or `skipped`");
    expect(instructions).toContain("one canonical adaptive decision section");
    expect(instructions).toMatch(/recall the original planner to update it/);
    expect(instructions).toMatch(
      /MUST NOT duplicate adaptive classifications or dispositions/,
    );
    expect(instructions).toMatch(
      /record and apply the adaptive decision in your own workflow state/,
    );
    expect(instructions).toMatch(/MUST NOT create a placeholder plan/);
    expect(instructions).toMatch(
      /MUST NOT require the latest brief to duplicate that state/,
    );
  });

  test("assigns exact immutable artifact paths and protects the evidence chain", () => {
    const architect = resolveArchitect();
    const everything = architect.everythingText();
    const instructions = architect.instructionsText;

    expect(everything).toContain(
      "filesystem-safe unique `.atlante/workflows/<cycle-id>/`",
    );
    expect(everything).toContain("new cycle-local `plan.md`");
    expect(everything).toMatch(/MUST NOT reuse an earlier cycle's plan/);
    expect(everything).toContain("cumulative brief");
    expect(everything).toContain("tasks/<task-id>/brief-<n>.md");
    expect(everything).toContain("tasks/<task-id>/review-<n>.md");
    expect(everything).toContain("final-review-<n>.md");
    expect(everything).toMatch(/independent counter/);
    expect(everything).toMatch(/immutable/);
    expect(instructions).toContain("assign every exact numbered artifact path");
    expect(instructions).toContain("transfer complete contents verbatim");
    expect(everything).toContain(
      "orientation summaries MUST NOT replace canonical artifacts",
    );
    expect(everything).toMatch(/MUST NOT omit findings/);
    expect(everything).toMatch(
      /refuse to write over an existing assigned target/,
    );
    expect(everything).toMatch(/MUST recall the original planner/);
    expect(everything).toMatch(/MUST NOT update `plan\.md`/);
    expect(architect.phaseInstructions("Task review").join(" ")).toContain(
      "Skipped reviews MUST NOT create placeholder reports",
    );
    expect(architect.phaseInstructions("Task review").join(" ")).toMatch(
      /each review MUST name and independently verify the exact brief and source boundary it reviewed/,
    );
  });

  test("keeps mandatory gates, blocking failures, and commit policy", () => {
    const architect = resolveArchitect();
    const invariants = architect.invariantsText;
    const instructions = architect.instructionsText;

    expect(invariants).toMatch(/mandatory gates regardless of classification/);
    expect(invariants).toMatch(
      /critical or important findings, failed required checks, and unapproved material contract changes MUST block completion/i,
    );
    expect(invariants).toMatch(/MUST block completion/);
    expect(invariants).toMatch(
      /a finding MUST be cleared only through an evidence-based ruling/,
    );
    expect(invariants).toMatch(
      /accepting or deferring valid risk does not clear/,
    );
    expect(invariants).toMatch(/MUST NOT claim validation succeeded/);
    expect(invariants).toMatch(/missing skills/);
    expect(invariants).toMatch(/unrelated dirty changes/);
    expect(invariants).toMatch(/blocked or partially validated states/);
    expect(invariants).toMatch(
      /MUST commit or push only when the developer requests or has configured it/,
    );
    expect(invariants).toMatch(/MUST NOT amend or force-push/);
    expect(instructions).toMatch(/quick and full validation commands/);
    expect(instructions).toMatch(/bounded review or correction limits/);
    expect(instructions).toMatch(/commit or push policy/);
  });

  test("replaces workflow mechanics with native host capabilities only under preserved contracts", () => {
    const architect = resolveArchitect();
    const instructions = architect.instructionsText;

    expect(instructions).toMatch(
      /native host capability MAY replace a workflow mechanic only when it preserves the same responsibility, isolation, source-read-only, complete-input, output, evidence, immutability, and blocking contracts/,
    );
    expect(instructions).toMatch(/MUST use one mechanism per concern/);
  });

  test("states every binding gate with MUST wording instead of weak prohibitions", () => {
    const architect = resolveArchitect();
    const invariants = architect.invariantsText.split("\n");
    const gateProse = [
      ...invariants,
      ...architect.instructionsText.split("\n"),
      ...architect.workflow.phases.flatMap((phase) =>
        (phase.instructions ?? []).map(String),
      ),
    ].join("\n");

    for (const invariant of invariants)
      expect(invariant, invariant).toMatch(/\bMUST\b/);
    expect(gateProse, "weak prohibition").not.toMatch(/\bnever\b/i);
    expect(gateProse, "weak prohibition").not.toMatch(/\bdo not\b/i);

    for (const landmark of [
      "cost or time pressure alone MUST NOT justify weakening one",
      "a phase MUST be reduced or skipped only when all of its eligibility conditions are positively established",
      "a finding MUST be cleared only through an evidence-based ruling",
      "you MUST NOT create a placeholder plan",
      "MUST NOT require the latest brief to duplicate that state",
      "orientation summaries MUST NOT replace canonical artifacts",
      "MUST NOT omit findings, evidence, validation results, rulings, or acceptance criteria",
      "you MUST NOT allow a worker to overwrite an immutable numbered artifact",
      "you MUST recall the original planner",
      "build and review workers MUST NOT update `plan.md`",
      "you MUST NOT proceed on assumptions",
      "You MUST honor project configuration only for",
      "required interactive brainstorming MUST NOT be delegated",
      "MUST NOT reuse an earlier cycle's plan",
      "you MUST report it as blocked instead of continuing to loop",
      "each review MUST name and independently verify the exact brief and source boundary it reviewed",
      "Skipped reviews MUST NOT create placeholder reports",
    ])
      expect(gateProse, landmark).toContain(landmark);
  });
});
