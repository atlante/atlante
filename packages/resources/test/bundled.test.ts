import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  createProjectResourcePack,
  interpolateValues,
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
  type ResourceBindingCollectionSpec,
  renderResolvedTemplate,
  resolveResourceDocument,
  resolveResourceInstance,
  resolveResourceTemplate,
} from "../src/index.js";

const atlanteBindingCollections: readonly ResourceBindingCollectionSpec[] = [
  { key: "agents", subject: "agent", defaultTemplate: "@atlante/pack/agent" },
  { key: "skills", subject: "skill", defaultTemplate: "@atlante/pack/skill" },
];

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packRoot = join(repositoryRoot, "packages", "pack");
const packVersion = JSON.parse(
  readFileSync(join(packRoot, "package.json"), "utf8"),
).version as string;
const created: string[] = [];
const firstPartyValues = {
  project: "Atlante",
  "quick-check": "`bun run quick:check`",
  "full-check": "`bun run full:check` and fallow mcp",
};

function fixture(): { root: string; config: string } {
  const root = mkdtempSync(join(repositoryRoot, ".pack-resource-test-"));
  created.push(root);
  mkdirSync(join(root, "node_modules", "@atlante"), { recursive: true });
  symlinkSync(packRoot, join(root, "node_modules", "@atlante", "pack"), "dir");
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-pack-resource-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": `workspace:${packVersion}` },
    })}\n`,
  );
  const config = join(root, "atlante.jsonc");
  writeFileSync(config, '{ "extends": "@atlante/pack" }\n');
  return { root, config };
}

function renderWorkflow(workflow: Record<string, unknown>): string {
  const { root, config } = fixture();
  return renderResolvedTemplate({
    template: resolveResourceTemplate(
      createProjectResourcePack(root),
      "@atlante/pack/skill",
      config,
    ),
    input: {
      title: "Adaptive workflow",
      overview: "Review the change.",
      sections: [{ workflow }],
    },
  });
}

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const expectedArchitectPrompt = `# Identity

You are the lead engineer for Atlante.

# Mission

Turn each approved issue into a tested, reviewable change that meets its acceptance criteria.

## Responsibilities

- Clarify ambiguity with the developer and establish the issue's scope, constraints, and acceptance criteria.
- Make focused, maintainable changes that follow established project conventions and preserve clear responsibility boundaries.
- Validate and review the result against its acceptance criteria, project conventions, and relevant regression, compatibility, and security concerns.
- Communicate decisions, validation evidence, blockers, and next steps.

## Invariants

The invariants below are binding. Every invariant MUST hold throughout planning, execution, validation, and the final result. You MUST NOT weaken an invariant, invent an exception, or trade temporary violation for progress. If the requested work conflicts with an invariant, you MUST follow a compliant path. If no compliant path can be established, you MUST stop the affected work at the smallest safe point, report the conflict and available evidence, and ask the developer to resolve it. You MUST NOT resume until a compliant path is established.

- Introduce abstractions only when they remove real duplication or improve clarity.
- Treat the approved issue and its acceptance criteria as the scope of work; MUST ask the developer before expanding or materially changing them.
- MUST preserve unrelated user changes.
- MUST NOT claim validation succeeded without reporting the checks run and their results; MUST clearly state any checks that could not run.

## Instructions

These are required actions for completing the work. Perform them in order unless an invariant or explicit developer direction requires otherwise.

1. Ask the developer to choose whether to start brainstorming or workflow; their choice is the approval to begin, regardless of whether an approved issue or task already exists.
2. Once chosen, load and follow the selected skill. Workflow requires an approved issue or task as its source of truth; if none exists, clarify the task before loading workflow.
`;

describe("first-party package resources", () => {
  test("loads selected default, template, and instance facets through package resolution", () => {
    const { root, config } = fixture();
    const pack = createProjectResourcePack(root);
    const preset = loadPresetFacet(pack, "@atlante/pack", config).facet;
    const template = loadTemplateFacet(
      pack,
      "@atlante/pack/agent",
      config,
    ).facet;
    const instance = loadInstanceFacet(
      pack,
      "@atlante/pack/architect",
      config,
    ).facet;

    expect({
      kind: preset.origin.kind,
      path: String(preset.origin.path),
    }).toEqual({
      kind: "package",
      path: `@atlante/pack@${packVersion}/atlante.jsonc`,
    });
    expect({
      kind: template.origin.kind,
      path: String(template.origin.path),
    }).toEqual({
      kind: "package",
      path: `@atlante/pack@${packVersion}/agent/template.jsonc`,
    });
    expect({
      kind: instance.origin.kind,
      path: String(instance.origin.path),
    }).toEqual({
      kind: "package",
      path: `@atlante/pack@${packVersion}/architect/instance.jsonc`,
    });
    expect(preset.document.agents).toHaveProperty("architect");
  });

  test("resolves first-party self-references and preserves package graph output", () => {
    const { root, config } = fixture();
    const pack = createProjectResourcePack(root);
    const document = resolveResourceDocument({
      pack,
      rootFile: config,
      bindingCollections: atlanteBindingCollections,
    });
    const instance = resolveResourceInstance(
      pack,
      "@atlante/pack/architect",
      config,
    );
    const template = resolveResourceTemplate(
      pack,
      "@atlante/pack/skill",
      config,
    );

    expect(Object.keys(document.bindings.agents)).toEqual(["architect"]);
    expect(Object.keys(document.bindings.skills)).toEqual([
      "brainstorming",
      "workflow",
    ]);
    expect(String(instance.effectiveTemplate.locator)).toBe(
      "@atlante/pack/agent",
    );
    expect(String(template.locator)).toBe("@atlante/pack/skill");
    expect(instance.input).toMatchObject({
      identity: "You are the lead engineer for {{values.project}}.",
    });
  });

  test("renders the first-party architect prompt with unchanged payload text", () => {
    const { root, config } = fixture();
    const instance = resolveResourceInstance(
      createProjectResourcePack(root),
      "@atlante/pack/architect",
      config,
    );
    const output = renderResolvedTemplate({
      template: instance.effectiveTemplate,
      input: interpolateValues(instance.input, { project: "Atlante" }),
    });

    expect(output).toBe(expectedArchitectPrompt);
  });

  test("migrates all bundled constraint content to invariant sections", () => {
    const { root, config } = fixture();
    const pack = createProjectResourcePack(root);
    const architect = resolveResourceInstance(
      pack,
      "@atlante/pack/architect",
      config,
    );
    const brainstorming = resolveResourceInstance(
      pack,
      "@atlante/pack/brainstorming",
      config,
    );
    const workflow = resolveResourceInstance(
      pack,
      "@atlante/pack/delivery-workflow",
      config,
    );

    expect(architect.input.responsibilities).toEqual([
      "Clarify ambiguity with the developer and establish the issue's scope, constraints, and acceptance criteria.",
      "Make focused, maintainable changes that follow established project conventions and preserve clear responsibility boundaries.",
      "Validate and review the result against its acceptance criteria, project conventions, and relevant regression, compatibility, and security concerns.",
      "Communicate decisions, validation evidence, blockers, and next steps.",
    ]);
    expect(architect.input.sections).toEqual([
      {
        invariants: [
          "Introduce abstractions only when they remove real duplication or improve clarity.",
          "Treat the approved issue and its acceptance criteria as the scope of work; MUST ask the developer before expanding or materially changing them.",
          "MUST preserve unrelated user changes.",
          "MUST NOT claim validation succeeded without reporting the checks run and their results; MUST clearly state any checks that could not run.",
        ],
      },
      expect.objectContaining({ instructions: expect.any(Array) }),
    ]);
    expect(brainstorming.input.sections).toEqual([
      {
        invariants: [
          "Do not begin workflow, implementation, or file modifications until the presented design is approved by the developer.",
          "Apply this gate even to simple work, including work simple enough to skip a full plan; the design may be brief when the work is simple.",
          "Surface real complexity honestly; never downplay it to appear confident.",
        ],
      },
      expect.objectContaining({ instructions: expect.any(Array) }),
    ]);
    expect(workflow.input.sections?.[0]).toEqual({
      invariants: [
        "Do not begin implementation until the developer approves the implementation plan when a full plan is warranted.",
        "For behavior changes, do not make implementation changes before a focused test demonstrates the planned behavior.",
        "The orchestrator drives all phases but never edits files directly; it delegates every write, including corrections, to sub-agents, tracks progress, and integrates results.",
        "The orchestrator may recall a previously dispatched sub-agent when context preservation is valuable, most notably recalling the plan sub-agent to update its own plan. Fresh sub-agents remain the default for execution tasks and the reviewer must always be fresh.",
      ],
    });

    for (const instance of [architect, brainstorming, workflow]) {
      const output = renderResolvedTemplate({
        template: instance.effectiveTemplate,
        input: interpolateValues(instance.input, firstPartyValues),
      });
      expect(output).toContain("## Invariants");
      expect(output).not.toContain("## Constraints");
    }
  });

  test("renders repeated agent invariant sections in authored order", () => {
    const { root, config } = fixture();
    const template = resolveResourceTemplate(
      createProjectResourcePack(root),
      "@atlante/pack/agent",
      config,
    );
    const output = renderResolvedTemplate({
      template,
      input: {
        identity: "Identity",
        mission: "Mission",
        sections: [
          { invariants: ["Before workflow"] },
          {
            workflow: {
              title: "Review workflow",
              phases: [{ kind: "plan", instructions: ["Plan the review."] }],
            },
          },
          { invariants: ["After workflow"] },
        ],
      },
    });

    const markers = ["Before workflow", "## Review workflow", "After workflow"];
    for (const marker of markers) expect(output).toContain(marker);
    expect(output.indexOf(markers[0])).toBeLessThan(output.indexOf(markers[1]));
    expect(output.indexOf(markers[1])).toBeLessThan(output.indexOf(markers[2]));
    expect(output).toContain(
      "Execute phases sequentially in the order listed.",
    );
  });

  test("renders top-level responsibilities after mission and preserves authored supporting-section order", () => {
    const { root, config } = fixture();
    const output = renderResolvedTemplate({
      template: resolveResourceTemplate(
        createProjectResourcePack(root),
        "@atlante/pack/agent",
        config,
      ),
      input: {
        identity: "Identity",
        mission: "Mission",
        responsibilities: ["Own the outcome."],
        sections: [
          { instructions: ["Authored instruction."] },
          { invariants: ["Authored invariant."] },
          { markdown: "Authored markdown." },
        ],
      },
    });

    expect(output).toContain(
      "# Mission\n\nMission\n\n## Responsibilities\n\n- Own the outcome.",
    );
    const markers = [
      "# Mission\n\nMission",
      "## Responsibilities",
      "## Instructions",
      "## Invariants",
      "Authored markdown.",
    ];
    for (let index = 1; index < markers.length; index++) {
      expect(output.indexOf(markers[index - 1])).toBeLessThan(
        output.indexOf(markers[index]),
      );
    }
    expect(output).toContain("- Own the outcome.");
  });

  test("renders the canonical workflow identically in agents and skills", () => {
    const { root, config } = fixture();
    const pack = createProjectResourcePack(root);
    const workflow = {
      title: "Review workflow",
      phases: [{ kind: "plan", instructions: ["Plan the review."] }],
    };
    const agentOutput = renderResolvedTemplate({
      template: resolveResourceTemplate(pack, "@atlante/pack/agent", config),
      input: {
        identity: "Identity",
        mission: "Mission",
        sections: [{ workflow }],
      },
    });
    const skillOutput = renderResolvedTemplate({
      template: resolveResourceTemplate(pack, "@atlante/pack/skill", config),
      input: {
        title: "Review skill",
        overview: "Review the change.",
        sections: [{ workflow }],
      },
    });
    const workflowStart = "## Review workflow";

    expect(agentOutput.slice(agentOutput.indexOf(workflowStart))).toBe(
      skillOutput.slice(skillOutput.indexOf(workflowStart)),
    );
  });

  test("renders one shared adaptive protocol and distinguishes mixed phase modes", () => {
    const output = renderWorkflow({
      title: "Adaptive review",
      phases: [
        {
          name: "Plan",
          policies: { adaptive: true },
          instructions: ["Plan the review."],
        },
        { kind: "review", instructions: ["Review the change."] },
      ],
    });

    expect(output.match(/^### Adaptive phase protocol$/gm)).toHaveLength(1);
    expect(output).toContain("### 1. Plan (adaptive)");
    expect(output).toContain("### 2. review (mandatory)");
    for (const phrase of [
      "Classify the overall cycle and each known implementation task by work type, complexity and risk, blast radius, reversibility, and uncertainty.",
      "Assign every adaptive phase exactly one of `full`, `reduced`, or `skipped`.",
      "Before acting, record the cycle or task, classification, evidence, disposition, and rationale.",
      "Reclassify when implementation or review evidence changes risk.",
      "Before applying `full` because evidence is missing, signals conflict, or material uncertainty exists, determine whether the uncertainty is decision-relevant and developer-resolvable.",
      "When it is, ask one focused developer question and classify using the answer.",
      "Default to `full` only when material uncertainty remains after available evidence and that question, when no appropriate developer question can resolve the material uncertainty, or when asking is not possible.",
      "Do not make routine or immaterial uncertainty interactive.",
      "Developer or project rules MAY strengthen this protocol but MUST NOT silently weaken a disposition.",
      "Phase instructions own concrete eligibility and escalation criteria.",
      "Material scope changes MUST retain developer approval.",
      "A focused developer question MUST NOT itself grant approval for a material scope change.",
      "Cost or time pressure MUST NOT be the sole reason to reduce ceremony.",
      "`full` executes the complete phase.",
      "`reduced` executes only the explicitly justified reduced scope.",
      "`skipped` omits the phase only when its own instructions permit it.",
      "A non-adaptive phase MUST remain mandatory and MUST NOT be reduced or skipped.",
    ])
      expect(output).toContain(phrase);
  });

  test("renders bounded developer-question guidance before the full fallback", () => {
    const output = renderWorkflow({
      title: "Adaptive review",
      phases: [
        {
          policies: { adaptive: true },
          instructions: ["Review the change."],
        },
      ],
    });
    const question =
      "Before applying `full` because evidence is missing, signals conflict, or material uncertainty exists, determine whether the uncertainty is decision-relevant and developer-resolvable.";
    const answer =
      "When it is, ask one focused developer question and classify using the answer.";
    const fallback =
      "Default to `full` only when material uncertainty remains after available evidence and that question, when no appropriate developer question can resolve the material uncertainty, or when asking is not possible.";

    expect(output).toContain(question);
    expect(output).toContain(answer);
    expect(output).toContain(fallback);
    expect(output).toContain(
      "Do not make routine or immaterial uncertainty interactive.",
    );
    expect(output).toContain(
      "Material scope changes MUST retain developer approval.",
    );
    expect(output).toContain(
      "A focused developer question MUST NOT itself grant approval for a material scope change.",
    );
    expect(output.indexOf(question)).toBeLessThan(output.indexOf(answer));
    expect(output.indexOf(answer)).toBeLessThan(output.indexOf(fallback));
  });

  test("renders one protocol for multiple adaptive phases with name and kind fallbacks", () => {
    const output = renderWorkflow({
      title: "Adaptive delivery",
      phases: [
        {
          name: "Planning",
          policies: { adaptive: true },
          instructions: ["Plan the delivery."],
        },
        {
          kind: "build",
          policies: { adaptive: true },
          instructions: ["Build the change."],
        },
        { kind: "review", instructions: ["Review the change."] },
      ],
    });

    expect(output.match(/^### Adaptive phase protocol$/gm)).toHaveLength(1);
    expect(output).toContain("### 1. Planning (adaptive)");
    expect(output).toContain("### 2. build (adaptive)");
    expect(output).toContain("### 3. review (mandatory)");
  });

  test("uses strict adaptive semantics for direct renderer phase labels", () => {
    const { root, config } = fixture();
    const output = renderResolvedTemplate({
      template: resolveResourceTemplate(
        createProjectResourcePack(root),
        "@atlante/pack/skill",
        config,
      ),
      input: {
        title: "Defensive adaptive workflow",
        overview: "Review the change.",
        sections: [
          {
            workflow: {
              title: "Adaptive review",
              phases: [
                {
                  name: "Plan",
                  policies: { adaptive: true },
                  instructions: ["Plan the review."],
                },
                {
                  name: "Malformed",
                  policies: { adaptive: "false" },
                  instructions: ["Review the change."],
                },
              ],
            },
          },
        ],
      },
    });

    expect(output.match(/^### Adaptive phase protocol$/gm)).toHaveLength(1);
    expect(output).toContain("### 1. Plan (adaptive)");
    expect(output).toContain("### 2. Malformed (mandatory)");
  });

  test.each([
    ["omitted", undefined],
    ["false", { adaptive: false }],
  ])(
    "keeps %s adaptive phases mandatory without a protocol",
    (_label, policies) => {
      const phase = {
        name: "Plan",
        ...(policies === undefined ? {} : { policies }),
        instructions: ["Plan the review."],
      };
      const output = renderWorkflow({
        title: "Mandatory workflow",
        phases: [
          phase,
          { kind: "review", instructions: ["Review the change."] },
        ],
      });

      expect(output).not.toContain("## Adaptive phase protocol");
      expect(output).toContain("### 1. Plan\n");
      expect(output).toContain("### 2. review\n");
      expect(output).not.toContain("(adaptive)");
      expect(output).not.toContain("(mandatory)");
    },
  );

  test("renders policy entries with an explicit heading hierarchy", () => {
    const output = renderWorkflow({
      title: "Structured policies",
      policies: { orchestratorReadOnly: true },
      phases: [
        {
          name: "Build",
          policies: { adaptive: true, commit: true, review: true, maxLoops: 2 },
          instructions: ["Build the change."],
        },
      ],
    });

    const headings = [
      "## Policies",
      "### Adaptive phase protocol",
      "#### Classification",
      "#### Decision record",
      "#### Dispositions",
    ];

    let previous = -1;
    for (const heading of headings) {
      const position = output.indexOf(heading);
      expect(position, heading).toBeGreaterThan(previous);
      previous = position;
    }
    for (const [heading, body] of [
      [
        "### Workflow: read-only orchestration",
        "The orchestrator is read-only and delegates every file edit.",
      ],
      [
        "### Build: task commits",
        "Commit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.",
      ],
      [
        "### Build: task review",
        "Apply task review according to this phase's review criteria.",
      ],
      ["### Build: correction loops", "Limit correction to 2 loops per task."],
    ])
      expect(output).toContain(`${heading}\n\n${body}`);
    expect(output).not.toContain("\n- Workflow:");
    expect(output).not.toContain("\n- Build:");
  });

  test.each([
    [
      "workflow-level truthy values",
      {
        title: "Workflow policies",
        policies: { orchestratorReadOnly: true },
        phases: [{ name: "Plan", instructions: ["Plan the review."] }],
      },
      "## Policies\n\nPolicies are binding; follow them in every phase.\n\n### Workflow: read-only orchestration\n\nThe orchestrator is read-only and delegates every file edit.",
    ],
    [
      "phase-level truthy values",
      {
        title: "Phase policies",
        phases: [
          {
            name: "Build",
            policies: { commit: true, review: true, maxLoops: 2 },
            instructions: ["Build the change."],
          },
        ],
      },
      "## Policies\n\nPolicies are binding; follow them in every phase.\n\n### Build: task commits\n\nCommit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.\n\n### Build: task review\n\nApply task review according to this phase's review criteria.\n\n### Build: correction loops\n\nLimit correction to 2 loops per task.",
    ],
    [
      "no truthy values",
      {
        title: "No policies",
        policies: { orchestratorReadOnly: false },
        phases: [
          {
            name: "Plan",
            policies: { commit: false, review: false },
            instructions: ["Plan the review."],
          },
        ],
      },
      "## No policies\n\nExecute phases sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Follow each phase's inline instructions in order.",
    ],
  ] as const)(
    "preserves the policy rendering compatibility matrix",
    (label, workflow, expected) => {
      const output = renderWorkflow(workflow);

      expect(output, label).toContain(expected);
      expect(output.match(/^## Policies$/gm) ?? []).toHaveLength(
        label === "no truthy values" ? 0 : 1,
      );
    },
  );

  test("preserves complete output when no policy is rendered", () => {
    expect(
      renderWorkflow({
        title: "No policies",
        phases: [{ name: "Plan", instructions: ["Plan the review."] }],
      }),
    ).toBe(
      "# Adaptive workflow\n\n## Overview\n\nReview the change.\n\n## No policies\n\nExecute phases sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Follow each phase's inline instructions in order.\n\n\n### 1. Plan\n\n1. Plan the review.\n",
    );
  });
});
