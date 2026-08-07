import { describe, expect, test } from "bun:test";
import { parse } from "jsonc-parser";
import { readPreset } from "../../presets/src/index.js";
import {
  interpolateValues as interpolateLegacyValues,
  loadBundledTemplates as loadLegacyTemplates,
  renderTemplate as renderLegacyTemplate,
  resolveSystemValues as resolveLegacySystemValues,
} from "../../templates/src/index.js";
import {
  interpolateValues,
  loadBundledInstanceMigrationRecords,
  loadBundledStarterMigrationRecord,
  loadBundledTemplateMigrationRegistry,
  renderTemplate,
  resolveSystemValues,
  slotsOf,
  walkComposition,
} from "../src/index.js";

describe("bundled resource facets", () => {
  test("loads bundled templates without errors", () => {
    const { registry, errors } = loadBundledTemplateMigrationRegistry();

    expect(errors).toEqual([]);
    expect(registry.ids()).toEqual([
      "atlante/agent",
      "atlante/artifact",
      "atlante/constraints",
      "atlante/gotchas",
      "atlante/instructions",
      "atlante/markdown",
      "atlante/skill",
      "atlante/workflow",
    ]);
  });

  test("preserves bundled branch composition and array slot order", () => {
    const { registry, errors } = loadBundledTemplateMigrationRegistry();
    expect(errors).toEqual([]);

    const skill = registry.get("atlante/skill");
    if (!skill) throw new Error("bundled skill template is missing");

    expect(
      slotsOf(skill.inputSchema).map(({ templateId, path, arrayItems }) => ({
        templateId,
        path,
        arrayItems,
      })),
    ).toEqual([
      {
        templateId: "atlante/markdown",
        path: ["sections", "items", "oneOf", "0", "markdown"],
        arrayItems: true,
      },
      {
        templateId: "atlante/instructions",
        path: ["sections", "items", "oneOf", "1", "instructions"],
        arrayItems: true,
      },
      {
        templateId: "atlante/gotchas",
        path: ["sections", "items", "oneOf", "2", "gotchas"],
        arrayItems: true,
      },
      {
        templateId: "atlante/workflow",
        path: ["sections", "items", "oneOf", "3", "workflow"],
        arrayItems: true,
      },
      {
        templateId: "atlante/constraints",
        path: ["sections", "items", "oneOf", "4", "constraints"],
        arrayItems: true,
      },
    ]);
    expect(walkComposition(registry, "atlante/skill")).toEqual([]);
  });

  test("renders bundled skill sections in their input order", () => {
    const { registry, errors } = loadBundledTemplateMigrationRegistry();
    expect(errors).toEqual([]);

    expect(
      renderTemplate({
        registry,
        templateId: "atlante/skill",
        input: {
          title: "Ordered",
          overview: "Keep every section in source order.",
          sections: [
            { markdown: "First." },
            { gotchas: ["Second."] },
            { instructions: ["Third."] },
            { markdown: "Fourth." },
          ],
        },
      }),
    ).toBe(
      "# Ordered\n\n## Overview\n\nKeep every section in source order.\n\nFirst.\n\n## Gotchas\n\nThese are risks and failure modes that require active attention. Account for each one while working; do not dismiss one because the task appears straightforward.\n\n- Second.\n\n## Instructions\n\nThese are required actions for completing the work. Perform them in order unless a constraint or explicit developer direction requires otherwise.\n\n1. Third.\n\nFourth.\n",
    );
  });

  test("supports ordered composable sections in agent prompts", () => {
    const { registry, errors } = loadBundledTemplateMigrationRegistry();
    expect(errors).toEqual([]);
    const agent = registry.get("atlante/agent");
    if (!agent) throw new Error("bundled agent template is missing");

    expect(
      slotsOf(agent.inputSchema).map(({ templateId, path, arrayItems }) => ({
        templateId,
        path,
        arrayItems,
      })),
    ).toEqual([
      {
        templateId: "atlante/markdown",
        path: ["sections", "items", "oneOf", "0", "markdown"],
        arrayItems: true,
      },
      {
        templateId: "atlante/instructions",
        path: ["sections", "items", "oneOf", "1", "instructions"],
        arrayItems: true,
      },
      {
        templateId: "atlante/gotchas",
        path: ["sections", "items", "oneOf", "3", "gotchas"],
        arrayItems: true,
      },
      {
        templateId: "atlante/constraints",
        path: ["sections", "items", "oneOf", "4", "constraints"],
        arrayItems: true,
      },
    ]);
  });

  test("renders skill title, overview, and Markdown sections", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();

    expect(
      renderTemplate({
        registry,
        templateId: "atlante/skill",
        input: {
          title: "Testing",
          overview: "Run the test suite.",
          sections: [{ markdown: "Use `bun test` to verify the change." }],
        },
      }),
    ).toBe(
      "# Testing\n\n## Overview\n\nRun the test suite.\n\nUse `bun test` to verify the change.\n",
    );
  });

  test("renders default instruction and gotcha labels and descriptions", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();

    expect(
      renderTemplate({
        registry,
        templateId: "atlante/skill",
        input: {
          title: "Testing",
          overview: "Run the test suite.",
          sections: [
            { instructions: ["Read the brief.", "Run the checks."] },
            { gotchas: ["Do not skip validation."] },
          ],
        },
      }),
    ).toBe(
      "# Testing\n\n## Overview\n\nRun the test suite.\n\n## Instructions\n\nThese are required actions for completing the work. Perform them in order unless a constraint or explicit developer direction requires otherwise.\n\n1. Read the brief.\n2. Run the checks.\n\n## Gotchas\n\nThese are risks and failure modes that require active attention. Account for each one while working; do not dismiss one because the task appears straightforward.\n\n- Do not skip validation.\n",
    );
  });

  test("renders reusable constraints sections in skills", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();

    expect(
      renderTemplate({
        registry,
        templateId: "atlante/skill",
        input: {
          title: "Planning",
          overview: "Plan before acting.",
          sections: [
            { constraints: ["Wait for approval.", "Keep scope focused."] },
          ],
        },
      }),
    ).toBe(
      "# Planning\n\n## Overview\n\nPlan before acting.\n\n## Constraints\n\nThese are non-negotiable limits on how you may act. Follow every constraint throughout your work; do not treat them as suggested outcomes or trade them off for convenience.\n\n- Wait for approval.\n- Keep scope focused.\n",
    );
  });

  test("renders sequential phases with inline instructions and validation", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        phases: [
          {
            name: "Discovery",
            instructions: [
              "Inspect the repository.",
              "Read the project guidance.",
            ],
            output: { description: "The discovery result." },
            validation: "Confirm the context is complete. Run `bun test`.",
          },
          {
            name: "Delivery",
            instructions: ["Make the change."],
          },
        ],
      },
    });

    expect(prompt).toContain("### 1. Discovery");
    expect(prompt).toContain("### 2. Delivery");
    expect(prompt).not.toContain("### 0.");
    expect(prompt).toContain("Execute phases sequentially in the order listed");
    expect(prompt).toContain("Inspect the repository.");
    expect(prompt).toContain("1. Inspect the repository.");
    expect(prompt).toContain("2. Read the project guidance.");
    expect(prompt).toContain("Phase output: The discovery result.");
    expect(prompt).toContain(
      "Phase validation: Confirm the context is complete. Run `bun test`.",
    );
    expect(prompt).not.toContain("## Instructions");
    expect(prompt).not.toContain("Check after task");
    expect(prompt.indexOf("Inspect the repository.")).toBeLessThan(
      prompt.indexOf("Phase output: The discovery result."),
    );
    expect(prompt.indexOf("Phase output: The discovery result.")).toBeLessThan(
      prompt.indexOf("Phase validation: Confirm the context is complete."),
    );
    expect(prompt).not.toContain("depends on");
    expect(prompt).not.toContain("task 'Plan'");
  });

  test("renders enabled workflow and phase policies in a consolidated section", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        policies: { orchestratorReadOnly: true },
        phases: [
          {
            kind: "build",
            name: "Execute",
            policies: { commit: true, review: true, maxLoops: 5 },
            output: {
              description: "The implementation result.",
              updateable: true,
            },
            instructions: ["Make the change."],
          },
        ],
      },
    });

    expect(prompt).toContain("## Policies");
    expect(prompt).toContain(
      "Policies are binding; follow them in every phase.",
    );
    expect(prompt).toContain(
      "- Workflow: the orchestrator is read-only and delegates every file edit.",
    );
    expect(prompt).toContain(
      "- Execute: commit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.",
    );
    expect(prompt).toContain(
      "- Execute: apply task review according to this phase's review criteria.",
    );
    expect(prompt).not.toContain("review after each task");
    expect(prompt).toContain(
      "- Execute: limit correction to 5 loops per task.",
    );
    expect(prompt).toContain(
      "This output is a living artifact that later phases may revisit and update, looping back when needed.",
    );
  });

  test("renders the phase kind as the phase name when name is absent", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        phases: [
          {
            kind: "build",
            policies: { commit: true },
            instructions: ["Make the change."],
          },
        ],
      },
    });

    expect(prompt).toContain("### 1. build");
    expect(prompt).toContain(
      "- build: commit task implementation and corrections in separate commits",
    );
  });

  test("omits disabled and absent workflow policies", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        policies: { orchestratorReadOnly: false },
        phases: [
          {
            name: "Execute",
            policies: { commit: false, review: false },
            output: { description: "The implementation result." },
            instructions: ["Make the change."],
          },
          { name: "Deliver", instructions: ["Deliver the result."] },
        ],
      },
    });

    expect(prompt).not.toContain("## Policies");
    expect(prompt).not.toContain("Policies are binding");
    expect(prompt).not.toContain("living artifact");
    expect(prompt).toContain("Execute phases sequentially in the order listed");
    expect(prompt.indexOf("### 1. Execute")).toBeLessThan(
      prompt.indexOf("### 2. Deliver"),
    );
  });

  test("renders phase-level subagent delegation without task-level routing", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        phases: [
          { name: "Plan", instructions: ["Plan the change."] },
          {
            name: "Execute",
            subagent: "implement",
            instructions: ["Make the change."],
          },
        ],
      },
    });

    expect(prompt).toContain(
      'The subagent "implement" should handle this phase.',
    );
    expect(prompt).not.toContain("The orchestrator handles this phase.");
    expect(prompt).not.toContain("should be used for this task.");
  });

  test("omits validation when a phase does not define one", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();
    const prompt = renderTemplate({
      registry,
      templateId: "atlante/workflow",
      input: {
        phases: [{ name: "Delivery", instructions: ["Review the result."] }],
      },
    });

    expect(prompt).not.toContain("Phase validation:");
  });

  test("loads bundled templates and starter instance facets", () => {
    const starter = loadBundledStarterMigrationRecord();
    const instances = loadBundledInstanceMigrationRecords();

    expect(starter.errors).toEqual([]);
    expect(starter.preset?.locator).toBe("atlante/starter");
    expect(starter.preset?.origin).toEqual({
      kind: "bundled",
      path: "atlante/starter/atlante.jsonc",
    });
    expect(starter.preset?.document).toEqual({
      $schema: "https://atlante.sh/schema/v0.1/schema.json",
      values: {
        project: "{{sys.cwd.basename}}",
        "quick-check": "",
        "full-check": "",
      },
      agents: {
        architect: {
          $instance: "atlante/architect",
          description:
            "Plan, implement, and review Atlante work: clarify scope, delegate execution and reviews, and validate against acceptance criteria. Use for any implementation, review, or workflow session.",
        },
      },
      skills: {
        brainstorming: {
          $instance: "atlante/brainstorming",
          description:
            "Use before creative or implementation work to collaboratively clarify intent, requirements, and design, then produce an approved implementation handoff.",
        },
        workflow: {
          $instance: "atlante/delivery-workflow",
          description:
            "Use when an approved issue is ready for implementation: deliver a focused, verified change that satisfies its acceptance criteria.",
        },
      },
    });
    expect(Object.keys(starter.preset?.document.agents ?? {})).toEqual([
      "architect",
    ]);
    expect(Object.keys(starter.preset?.document.skills ?? {})).toEqual([
      "brainstorming",
      "workflow",
    ]);
    expect(instances.errors).toEqual([]);
    expect(instances.instances.map(({ id }) => id)).toEqual([
      "atlante/architect",
      "atlante/brainstorming",
      "atlante/delivery-workflow",
    ]);
    const instancesById = new Map(
      instances.instances.map((instance) => [instance.id, instance]),
    );
    expect(instancesById.get("atlante/architect")?.input).toEqual({
      identity: "You are the lead engineer for {{values.project}}.",
      mission:
        "Turn each approved issue into a tested, reviewable change that meets its acceptance criteria.",
      sections: [
        {
          responsibilities: [
            "Clarify ambiguity with the developer and establish the issue's scope, constraints, and acceptance criteria.",
            "Make focused, maintainable changes that follow established project conventions and preserve clear responsibility boundaries.",
            "Validate and review the result against its acceptance criteria, project conventions, and relevant regression, compatibility, and security concerns.",
            "Communicate decisions, validation evidence, blockers, and next steps.",
          ],
        },
        {
          constraints: [
            "Introduce abstractions only when they remove real duplication or improve clarity.",
            "Treat the approved issue and its acceptance criteria as the scope of work; MUST ask the developer before expanding or materially changing them.",
            "MUST preserve unrelated user changes.",
            "MUST NOT claim validation succeeded without reporting the checks run and their results; MUST clearly state any checks that could not run.",
          ],
        },
        {
          instructions: [
            "Ask the developer to choose whether to start brainstorming or workflow; their choice is the approval to begin, regardless of whether an approved issue or task already exists.",
            "Once chosen, load and follow the selected skill. Workflow requires an approved issue or task as its source of truth; if none exists, clarify the task before loading workflow.",
          ],
        },
      ],
    });
    expect(instancesById.get("atlante/brainstorming")?.input).toEqual({
      title: "Brainstorming",
      overview:
        "Create a shared foundation for deliberate, well-scoped work by turning early uncertainty into a coherent direction the developer can carry forward.",
      sections: [
        {
          constraints: [
            "Do not begin workflow, implementation, or file modifications until the presented design is approved by the developer.",
            "Apply this gate even to simple work, including work simple enough to skip a full plan; the design may be brief when the work is simple.",
            "Surface real complexity honestly; never downplay it to appear confident.",
          ],
        },
        {
          instructions: [
            "Explore the current project context, including files, documentation, and recent commits.",
            "Assess scope before detailed questions; decompose requests that span independent subsystems into focused issues and refine one at a time.",
            "Ask exactly one question at a time to understand purpose, constraints, and success criteria; prefer multiple-choice questions when useful.",
            "Propose two or three approaches with trade-offs, lead with a recommendation, and remove unnecessary scope using YAGNI.",
            "Present the design in sections sized to the work, covering relevant architecture, components, data flow, error handling, and testing; validate the developer's understanding and approval after each section.",
            "After the developer approves the design, produce the artifact they requested—such as an issue or file—that records the approved scope, approach, requirements, and acceptance criteria as the implementation handoff.",
            "Review the issue artifact for placeholders, contradictions, ambiguity, and excessive scope; resolve any problems before handing it off.",
          ],
        },
      ],
    });
    expect(instancesById.get("atlante/delivery-workflow")?.input).toEqual({
      title: "Workflow",
      overview:
        "Provide a disciplined delivery framework that keeps approved work scoped, maintainable, and accountable from handoff through completion, with decisions and outcomes grounded in the issue's acceptance criteria. This workflow is driven by an orchestrator that delegates each task to a focused sub-agent, coordinates their outputs, and enforces the workflow's quality gates.",
      sections: [
        {
          constraints: [
            "Do not begin implementation until the developer approves the implementation plan when a full plan is warranted.",
            "For behavior changes, do not make implementation changes before a focused test demonstrates the planned behavior.",
            "The orchestrator drives all phases but never edits files directly; it delegates every write, including corrections, to sub-agents, tracks progress, and integrates results.",
            "The orchestrator may recall a previously dispatched sub-agent when context preservation is valuable, most notably recalling the plan sub-agent to update its own plan. Fresh sub-agents remain the default for execution tasks and the reviewer must always be fresh.",
          ],
        },
        {
          workflow: {
            title: "Phases",
            policies: { orchestratorReadOnly: true },
            phases: [
              {
                kind: "plan",
                description:
                  "Turn the issue into the smallest DRY-KISS implementation plan.",
                instructions: [
                  "Use an existing issue or task defined by the user, as the source of truth.",
                  "Assess the issue's type, size, and risk; decide and record whether to use the full plan or execute TDD-first inline, defaulting to a full plan for non-trivial work.",
                  "The orchestrator dispatches a sub-agent to read applicable project instructions and inspect the relevant code and tests.",
                  "For a full plan, the sub-agent breaks the implementation into the smallest essential tasks and writes the plan.",
                  "For inline execution, skip the plan artifact and its approval and validation; record the judgment in task context and proceed directly to TDD-first execution.",
                  "The orchestrator reviews a full plan and presents it to the developer for approval before proceeding.",
                  "When produced, keep this output as the single living plan; recall the same planner when execution or whole-change review findings change decomposition, sequencing, or scope.",
                  "Judge case by case whether a living-plan update during execution requires renewed developer approval.",
                ],
                output: {
                  description:
                    "For full planning, the approved implementation plan, organized into tasks that run sequentially or in parallel as their dependencies require.",
                  filePath: ".atlante/plans/plan-<issue-number>.md",
                  updateable: true,
                },
                validation:
                  "For full planning, review the output plan before presenting it.",
              },
              {
                kind: "build",
                description:
                  "Execute the approved tasks with focused implementation, verification, risk-scaled review, commits, and bounded correction loops.",
                policies: { commit: true, review: true, maxLoops: 5 },
                instructions: [
                  "Treat the full plan as the source of truth when one exists; for TDD-first inline execution, treat the issue's acceptance criteria and the recorded judgment as the source of truth.",
                  "The orchestrator executes tasks according to their dependencies, delegating each one to a fresh sub-agent with only its necessary context. Parallelize only independent tasks that cannot conflict.",
                  "Drive implementation test-first: write a focused failing test before implementation, then make the smallest change needed, run covering tests, and report the evidence.",
                  "Require per-task review for tasks touching runtime behavior, public API, security, or shared core code; mechanical tasks (renames, formatting, dependency bumps, documentation) may skip review but MUST still follow test-first behavior and pass a quick check.",
                  "For a required per-task review, dispatch a separate reviewer for specification compliance and code quality. Route findings through delegated corrections and fresh re-review, and do not proceed with unresolved critical or important findings.",
                  "At the configured correction-loop limit, record explicit rulings for deferred findings and stop with a blocker if a load-bearing issue remains.",
                  "When execution reveals facts that change decomposition, sequencing, or scope, recall the same planner to update the existing living plan for full-plan work, or update the recorded judgment for inline work, before continuing.",
                  "Escalate doubt in order: decide and document within scope; ask the orchestrator only for context or scope; ask the developer one question at a time only as a last resort.",
                  "Preserve unrelated changes and keep implementation within the approved scope.",
                ],
                validation:
                  "After each task, run and record a quick check with {{values.quick-check}}, including after any correction loop. After all tasks and any required whole-change review, run and record the full check with {{values.full-check}}. Report commands, results, and any checks that could not run; do not claim completion while acceptance criteria or required review findings remain unresolved.",
              },
              {
                kind: "review",
                description:
                  "Obtain a fresh, read-only whole-change review, distinct from per-task review, before declaring eligible plans complete.",
                instructions: [
                  "Normally run this whole-change review only when a full plan has more than two tasks; skip it for TDD-first inline execution unless an edge case warrants it.",
                  "Prepare precise review context with the approved plan when present, otherwise the recorded judgment. Include the change summary, acceptance criteria, applicable project instructions, relevant validation results, and the appropriate base and head revisions or current diff.",
                  "Dispatch a fresh reviewer with only that context; do not rely on the coordinator's session history or substitute a self-review.",
                  "The reviewer MUST NOT modify any source file. Its sole job is to inspect, report, and write the review report.",
                  "Assess the entire diff against the acceptance criteria, including deferred findings, cross-task integration, regressions, compatibility, security, and test coverage. Classify findings as critical, important, or minor.",
                  "Each fresh reviewer produces one immutable report and returns it as-is without fixing, re-reviewing, or looping.",
                  "For full-plan work, integrate required findings into the existing living plan; for inline work, update the recorded judgment. Immediately relaunch execute, then dispatch another fresh whole-change reviewer; repeat until clean or explicitly stopped with rulings or a blocker.",
                  "Do not create a replacement plan or rerun the plan phase, and do not seek developer re-approval for full-plan whole-change review corrections.",
                  "Only declare the change complete when the review report has no unresolved critical or important findings.",
                ],
                output: {
                  description:
                    "An immutable whole-change review report listing all findings, classified by severity.",
                  filePath: ".atlante/reviews/review-<issue-number>.md",
                },
              },
            ],
          },
        },
      ],
    });
  });

  test("matches current starter rendered content for every bundled instance", () => {
    const starter = parse(readPreset("atlante/starter") ?? "{}") as {
      values?: Record<string, unknown>;
      agents?: Record<string, Record<string, unknown>>;
      skills?: Record<string, Record<string, unknown>>;
    };
    const { registry } = loadBundledTemplateMigrationRegistry();
    const { instances, errors } = loadBundledInstanceMigrationRecords();
    expect(errors).toEqual([]);

    const values = resolveSystemValues(starter.values ?? {});
    const legacyValues = resolveLegacySystemValues(starter.values ?? {});
    const instancesById = new Map(
      instances.map((instance) => [instance.id, instance]),
    );
    const legacyRegistry = loadLegacyTemplates().registry;
    const bindings = [
      ["architect", "atlante/architect", "atlante/agent", "agents"],
      ["brainstorming", "atlante/brainstorming", "atlante/skill", "skills"],
      ["workflow", "atlante/delivery-workflow", "atlante/skill", "skills"],
    ] as const;

    for (const [bindingId, instanceId, templateId, subject] of bindings) {
      const instance = instancesById.get(instanceId);
      if (!instance) throw new Error(`missing bundled instance ${instanceId}`);
      const binding = starter[subject]?.[bindingId];
      if (!binding)
        throw new Error(`missing starter binding ${subject}.${bindingId}`);
      const legacyInput = Object.fromEntries(
        Object.entries(binding).filter(
          ([key]) => !["description", "template", "values"].includes(key),
        ),
      );

      const expected = renderLegacyTemplate({
        registry: legacyRegistry,
        templateId,
        input: interpolateLegacyValues(legacyInput, legacyValues),
      });
      const actual = renderTemplate({
        registry,
        templateId,
        input: interpolateValues(instance.input, values),
      });

      expect(actual).toBe(expected);
    }
  });

  test("keeps the current agent rendering snapshots stable", () => {
    const { registry } = loadBundledTemplateMigrationRegistry();

    expect(
      renderTemplate({
        registry,
        templateId: "atlante/agent",
        input: {
          identity: "You are a code reviewer.",
          mission: "Find defects before they merge.",
          sections: [
            { responsibilities: ["Read the diff.", "Report findings."] },
            { constraints: ["Never edit files."] },
            { markdown: "Review the changed files." },
          ],
        },
      }),
    ).toMatchSnapshot();

    expect(
      renderTemplate({
        registry,
        templateId: "atlante/agent",
        input: { identity: "You are an assistant.", mission: "Help." },
      }),
    ).toMatchSnapshot();
  });
});
