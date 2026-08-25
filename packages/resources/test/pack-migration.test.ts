import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import {
  createProjectResourcePack,
  interpolateValues,
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
  parseResourceLocator,
  ResourceResolutionError,
  renderResolvedTemplate,
  resolveResourceDocument,
  resolveResourceInstance,
  resolveResourceTemplate,
} from "../src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packRoot = join(repositoryRoot, "packages", "pack");
const created: string[] = [];
const packVersion = packageJson.version;
const firstPartyValues = {
  project: "Atlante",
  "quick-check": "`bun run quick:check`",
  "full-check": "`bun run full:check` and fallow mcp",
};

const expectedWorkflowSkill = `# Workflow

## Overview

Provide a disciplined delivery framework that keeps approved work scoped, maintainable, and accountable from handoff through completion, with decisions and outcomes grounded in the issue's acceptance criteria. This workflow is driven by an orchestrator that delegates each task to a focused sub-agent, coordinates their outputs, and enforces the workflow's quality gates.

## Invariants

The invariants below are binding. Every invariant MUST hold throughout planning, execution, validation, and the final result. You MUST NOT weaken an invariant, invent an exception, or trade temporary violation for progress. If the requested work conflicts with an invariant, you MUST follow a compliant path. If no compliant path can be established, you MUST stop the affected work at the smallest safe point, report the conflict and available evidence, and ask the developer to resolve it. You MUST NOT resume until a compliant path is established.

- Do not begin implementation until the developer approves the implementation plan when a full plan is warranted.
- For behavior changes, do not make implementation changes before a focused test demonstrates the planned behavior.
- The orchestrator drives all phases but never edits files directly; it delegates every write, including corrections, to sub-agents, tracks progress, and integrates results.
- The orchestrator may recall a previously dispatched sub-agent when context preservation is valuable, most notably recalling the plan sub-agent to update its own plan. Fresh sub-agents remain the default for execution tasks and the reviewer must always be fresh.

## Phases

Execute phases sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Follow each phase's inline instructions in order.

## Policies

Policies are binding; follow them in every phase.

- Workflow: the orchestrator is read-only and delegates every file edit.
- build: commit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.
- build: apply task review according to this phase's review criteria.
- build: limit correction to 5 loops per task.


### 1. plan

Turn the issue into the smallest DRY-KISS implementation plan.

1. Use an existing issue or task defined by the user, as the source of truth.

2. Assess the issue's type, size, and risk; decide and record whether to use the full plan or execute TDD-first inline, defaulting to a full plan for non-trivial work.

3. The orchestrator dispatches a sub-agent to read applicable project instructions and inspect the relevant code and tests.

4. For a full plan, the sub-agent breaks the implementation into the smallest essential tasks and writes the plan.

5. For inline execution, skip the plan artifact and its approval and validation; record the judgment in task context and proceed directly to TDD-first execution.

6. The orchestrator reviews a full plan and presents it to the developer for approval before proceeding.

7. When produced, keep this output as the single living plan; recall the same planner when execution or whole-change review findings change decomposition, sequencing, or scope.

8. Judge case by case whether a living-plan update during execution requires renewed developer approval.

Phase output: For full planning, the approved implementation plan, organized into tasks that run sequentially or in parallel as their dependencies require. The artifact should be stored at .atlante/plans/plan-<issue-number>.md. This output is a living artifact that later phases may revisit and update, looping back when needed.



Phase validation: For full planning, review the output plan before presenting it.

### 2. build

Execute the approved tasks with focused implementation, verification, risk-scaled review, commits, and bounded correction loops.

1. Treat the full plan as the source of truth when one exists; for TDD-first inline execution, treat the issue's acceptance criteria and the recorded judgment as the source of truth.

2. The orchestrator executes tasks according to their dependencies, delegating each one to a fresh sub-agent with only its necessary context. Parallelize only independent tasks that cannot conflict.

3. Drive implementation test-first: write a focused failing test before implementation, then make the smallest change needed, run covering tests, and report the evidence.

4. Require per-task review for tasks touching runtime behavior, public API, security, or shared core code; mechanical tasks (renames, formatting, dependency bumps, documentation) may skip review but MUST still follow test-first behavior and pass a quick check.

5. For a required per-task review, dispatch a separate reviewer for specification compliance and code quality. Route findings through delegated corrections and fresh re-review, and do not proceed with unresolved critical or important findings.

6. At the configured correction-loop limit, record explicit rulings for deferred findings and stop with a blocker if a load-bearing issue remains.

7. When execution reveals facts that change decomposition, sequencing, or scope, recall the same planner to update the existing living plan for full-plan work, or update the recorded judgment for inline work, before continuing.

8. Escalate doubt in order: decide and document within scope; ask the orchestrator only for context or scope; ask the developer one question at a time only as a last resort.

9. Preserve unrelated changes and keep implementation within the approved scope.


Phase validation: After each task, run and record a quick check with ${firstPartyValues["quick-check"]}, including after any correction loop. After all tasks and any required whole-change review, run and record the full check with ${firstPartyValues["full-check"]}. Report commands, results, and any checks that could not run; do not claim completion while acceptance criteria or required review findings remain unresolved.

### 3. review

Obtain a fresh, read-only whole-change review, distinct from per-task review, before declaring eligible plans complete.

1. Normally run this whole-change review only when a full plan has more than two tasks; skip it for TDD-first inline execution unless an edge case warrants it.

2. Prepare precise review context with the approved plan when present, otherwise the recorded judgment. Include the change summary, acceptance criteria, applicable project instructions, relevant validation results, and the appropriate base and head revisions or current diff.

3. Dispatch a fresh reviewer with only that context; do not rely on the coordinator's session history or substitute a self-review.

4. The reviewer MUST NOT modify any source file. Its sole job is to inspect, report, and write the review report.

5. Assess the entire diff against the acceptance criteria, including deferred findings, cross-task integration, regressions, compatibility, security, and test coverage. Classify findings as critical, important, or minor.

6. Each fresh reviewer produces one immutable report and returns it as-is without fixing, re-reviewing, or looping.

7. For full-plan work, integrate required findings into the existing living plan; for inline work, update the recorded judgment. Immediately relaunch execute, then dispatch another fresh whole-change reviewer; repeat until clean or explicitly stopped with rulings or a blocker.

8. Do not create a replacement plan or rerun the plan phase, and do not seek developer re-approval for full-plan whole-change review corrections.

9. Only declare the change complete when the review report has no unresolved critical or important findings.

Phase output: An immutable whole-change review report listing all findings, classified by severity. The artifact should be stored at .atlante/reviews/review-<issue-number>.md.

`;

const expectedPackFiles = [
  "agent/template.jsonc",
  "agent/template.md",
  "architect/instance.jsonc",
  "artifact/template.jsonc",
  "artifact/template.md",
  "atlante.jsonc",
  "brainstorming/instance.jsonc",
  "delivery-workflow/instance.jsonc",
  "gotchas/template.jsonc",
  "gotchas/template.md",
  "instructions/template.jsonc",
  "instructions/template.md",
  "invariants/template.jsonc",
  "invariants/template.md",
  "markdown/template.jsonc",
  "markdown/template.md",
  "skill/template.jsonc",
  "skill/template.md",
  "workflow/template.jsonc",
  "workflow/template.md",
] as const;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

function filesUnder(root: string, prefix = ""): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    const relativePath = join(prefix, entry.name);
    return entry.isDirectory()
      ? filesUnder(path, relativePath)
      : [relativePath];
  });
}

function firstPartyProject(config: Record<string, unknown>): {
  readonly root: string;
  readonly configPath: string;
} {
  const root = mkdtempSync(join(repositoryRoot, ".pack-migration-"));
  created.push(root);
  const packageDirectory = join(root, "node_modules", "@atlante");
  mkdirSync(packageDirectory, { recursive: true });
  symlinkSync(packRoot, join(packageDirectory, "pack"), "dir");
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-pack-migration-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": `workspace:${packVersion}` },
    })}\n`,
  );
  const configPath = join(root, "atlante.jsonc");
  writeFileSync(configPath, `${JSON.stringify(config)}\n`);
  return { root, configPath };
}

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("first-party static pack contract", () => {
  test("publishes synchronized static package metadata and only static content", () => {
    expect(existsSync(packRoot)).toBe(true);
    const manifest = readJson(join(packRoot, "package.json"));
    const files = manifest.files;

    expect(manifest.name).toBe("@atlante/pack");
    expect(manifest.version).toBe(packVersion);
    expect(manifest.version).toBe(
      readJson(join(repositoryRoot, "packages", "cli", "package.json")).version,
    );
    expect(manifest.publishConfig).toEqual({ access: "public" });
    expect(manifest.atlante).toEqual({ format: 1 });
    expect(files).toEqual([
      "**/*.json",
      "**/*.jsonc",
      "**/*.md",
      "README.md",
      "LICENSE",
    ]);
    expect(manifest).not.toHaveProperty("main");
    expect(manifest).not.toHaveProperty("module");
    expect(manifest).not.toHaveProperty("exports");
    expect(manifest).not.toHaveProperty("bin");
    expect(manifest).not.toHaveProperty("scripts");
    expect(
      filesUnder(packRoot)
        .filter((path) => path !== "package.json")
        .sort(),
    ).toEqual(["LICENSE", "README.md", ...expectedPackFiles].sort());
    expect(
      filesUnder(packRoot).some((path) => /\.(?:[cm]?ts|[cm]?js)$/.test(path)),
    ).toBe(false);
  });
});

describe("first-party package resolution", () => {
  test("resolves the default preset and template/instance facets with package origins", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const projectPack = createProjectResourcePack(fixture.root);

    const preset = loadPresetFacet(
      projectPack,
      "@atlante/pack",
      fixture.configPath,
    ).facet;
    const template = loadTemplateFacet(
      projectPack,
      "@atlante/pack/agent",
      fixture.configPath,
    ).facet;
    const instance = loadInstanceFacet(
      projectPack,
      "@atlante/pack/architect",
      fixture.configPath,
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
  });

  test("resolves first-party self-references through the generic package path", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const projectPack = createProjectResourcePack(fixture.root);
    const document = resolveResourceDocument({
      pack: projectPack,
      rootFile: fixture.configPath,
    });

    expect(Object.keys(document.bindings.agents)).toEqual(["architect"]);
    expect(Object.keys(document.bindings.skills)).toEqual([
      "brainstorming",
      "workflow",
    ]);
    const descriptionOrigin =
      document.provenance["/agents/architect/description"];
    expect(descriptionOrigin?.kind).toBe("package");
    expect(String(descriptionOrigin?.path)).toBe(
      `@atlante/pack@${packVersion}/atlante.jsonc`,
    );
  });

  test("resolves @atlante/pack/invariants directly through generic package resolution", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const projectPack = createProjectResourcePack(fixture.root);
    const { facet } = loadTemplateFacet(
      projectPack,
      "@atlante/pack/invariants",
      fixture.configPath,
    );

    expect({
      kind: facet.origin.kind,
      path: String(facet.origin.path),
    }).toEqual({
      kind: "package",
      path: `@atlante/pack@${packVersion}/invariants/template.jsonc`,
    });
    expect(facet.source.startsWith("## Invariants")).toBe(true);
  });

  test("rejects removed @atlante/pack/constraints as a missing template", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const projectPack = createProjectResourcePack(fixture.root);

    expect(() =>
      loadTemplateFacet(
        projectPack,
        "@atlante/pack/constraints",
        fixture.configPath,
      ),
    ).toThrow(ResourceResolutionError);

    try {
      loadTemplateFacet(
        projectPack,
        "@atlante/pack/constraints",
        fixture.configPath,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceResolutionError);
      if (error instanceof ResourceResolutionError) {
        expect([
          "missing-target",
          "missing-package-subpath",
        ] as const).toContain(error.failure.code);
        expect(error.failure.message).toContain("unavailable");
      }
    }
  });

  test("renders @atlante/pack/invariants directly as a heading with a bullet list", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const projectPack = createProjectResourcePack(fixture.root);
    const template = resolveResourceTemplate(
      projectPack,
      "@atlante/pack/invariants",
      fixture.configPath,
    );

    const rendered = renderResolvedTemplate({
      template,
      input: ["First preserved property.", "Second preserved property."],
    });

    expect(rendered).toBe(
      `## Invariants\n\nThe invariants below are binding. Every invariant MUST hold throughout planning, execution, validation, and the final result. You MUST NOT weaken an invariant, invent an exception, or trade temporary violation for progress. If the requested work conflicts with an invariant, you MUST follow a compliant path. If no compliant path can be established, you MUST stop the affected work at the smallest safe point, report the conflict and available evidence, and ask the developer to resolve it. You MUST NOT resume until a compliant path is established.\n\n- First preserved property.\n- Second preserved property.\n`,
    );
  });

  test("preserves first-party rendered prompt and skill bytes", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const projectPack = createProjectResourcePack(fixture.root);
    const architect = resolveResourceInstance(
      projectPack,
      "@atlante/pack/architect",
      fixture.configPath,
    );
    const workflow = resolveResourceInstance(
      projectPack,
      "@atlante/pack/delivery-workflow",
      fixture.configPath,
    );
    expect(String(architect.effectiveTemplate.locator)).toBe(
      "@atlante/pack/agent",
    );
    expect(String(workflow.effectiveTemplate.locator)).toBe(
      "@atlante/pack/skill",
    );
    const rendered = renderResolvedTemplate({
      template: architect.effectiveTemplate,
      input: interpolateValues(architect.input, firstPartyValues),
    });
    const renderedWorkflow = renderResolvedTemplate({
      template: workflow.effectiveTemplate,
      input: interpolateValues(workflow.input, firstPartyValues),
    });

    expect(rendered).toContain("You are the lead engineer for Atlante.");
    expect(rendered).not.toContain("{{values.project}}");
    expect(renderedWorkflow).toBe(expectedWorkflowSkill);
    expect(renderedWorkflow).not.toContain("{{values.");
  });
});

describe("first-party ordered invariants sections", () => {
  function firstPartyTemplate(
    locator: "@atlante/pack/agent" | "@atlante/pack/skill",
  ): ReturnType<typeof resolveResourceTemplate> {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    return resolveResourceTemplate(
      createProjectResourcePack(fixture.root),
      locator,
      fixture.configPath,
    );
  }

  test("renders agent sections in deterministic author order with invariants", () => {
    const template = firstPartyTemplate("@atlante/pack/agent");
    const sections = [
      {
        invariants: [
          "The public API stays backward compatible.",
          "Generated files stay untouched.",
        ],
      },
      { instructions: ["Check each guarantee after every step."] },
    ];

    const rendered = renderResolvedTemplate({
      template,
      input: {
        identity: "You are a guardian.",
        mission: "Preserve guarantees.",
        sections,
      },
    });

    expect(rendered).toContain("## Invariants");
    expect(rendered).toContain("- The public API stays backward compatible.");
    expect(rendered.indexOf("## Invariants")).toBeLessThan(
      rendered.indexOf("## Instructions"),
    );

    const reversed = renderResolvedTemplate({
      template,
      input: {
        identity: "You are a guardian.",
        mission: "Preserve guarantees.",
        sections: [...sections].reverse(),
      },
    });

    expect(reversed).toContain("## Invariants");
    expect(reversed.indexOf("## Instructions")).toBeLessThan(
      reversed.indexOf("## Invariants"),
    );
  });

  test("renders skill sections in deterministic author order with invariants", () => {
    const template = firstPartyTemplate("@atlante/pack/skill");
    const sections = [
      { instructions: ["Check each guarantee after every step."] },
      { invariants: ["Session state survives reloads."] },
    ];

    const rendered = renderResolvedTemplate({
      template,
      input: {
        title: "Guarding",
        overview: "Keep project guarantees intact.",
        sections,
      },
    });

    expect(rendered).toContain("## Instructions");
    expect(rendered).toContain("## Invariants");
    expect(rendered).toContain("- Session state survives reloads.");
    expect(rendered.indexOf("## Instructions")).toBeLessThan(
      rendered.indexOf("## Invariants"),
    );

    const reversed = renderResolvedTemplate({
      template,
      input: {
        title: "Guarding",
        overview: "Keep project guarantees intact.",
        sections: [...sections].reverse(),
      },
    });

    expect(reversed).toContain("## Invariants");
    expect(reversed.indexOf("## Invariants")).toBeLessThan(
      reversed.indexOf("## Instructions"),
    );
  });
});

describe("first-party section semantics", () => {
  function sectionDescription(name: string): string {
    const description = readJson(
      join(packRoot, name, "template.jsonc"),
    ).description;
    expect(typeof description).toBe("string");
    return description as string;
  }

  test("distinguishes invariants from action limits, instructions, responsibilities, and gotchas", () => {
    const invariants = sectionDescription("invariants");

    expect(invariants).toBe(
      "Conditions that MUST remain true throughout the work. Use invariants for durable guarantees, safety boundaries, and approval gates. State each as one concrete, observable rule and include the compliant path when non-obvious. Back critical invariants with deterministic enforcement when possible. Use instructions for ordered actions, responsibilities for owned outcomes, and gotchas for situational risks. Do not duplicate requirements across sections.",
    );
    for (const phrase of [
      "durable guarantees",
      "safety boundaries",
      "approval gates",
      "one concrete, observable rule",
      "compliant path",
      "deterministic enforcement",
      "instructions for ordered actions",
      "responsibilities for owned outcomes",
      "gotchas for situational risks",
      "Do not duplicate requirements across sections",
    ])
      expect(invariants).toContain(phrase);
  });

  test("renders the invariant intro as a binding lifecycle rule", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const template = resolveResourceTemplate(
      createProjectResourcePack(fixture.root),
      "@atlante/pack/agent",
      fixture.configPath,
    );
    const rendered = renderResolvedTemplate({
      template,
      input: {
        identity: "You are a guardian.",
        mission: "Preserve guarantees.",
        sections: [
          { invariants: ["The API remains stable."] },
          { instructions: ["Verify the API."] },
        ],
      },
    });
    const invariantSection = rendered.slice(
      rendered.indexOf("## Invariants"),
      rendered.indexOf("\n\n- The API remains stable."),
    );
    const intro = invariantSection.slice(invariantSection.indexOf("\n\n") + 2);

    for (const phrase of [
      "MUST",
      "MUST NOT",
      "planning, execution, validation, and the final result",
      "compliant path",
      "smallest safe point",
      "conflict and available evidence",
      "ask the developer to resolve it",
      "invent an exception",
    ])
      expect(intro).toContain(phrase);
    expect(intro).not.toContain("make an exception");
    expect(rendered).toContain(
      "Perform them in order unless an invariant or explicit developer direction requires otherwise.",
    );
    expect(rendered).not.toContain(
      "Perform them in order unless a constraint or explicit developer direction requires otherwise.",
    );
  });

  test("keeps responsibilities, instructions, and gotchas semantically separate", () => {
    const agentSchema = readJson(join(packRoot, "agent", "template.jsonc"));
    const branches = (
      (agentSchema.properties as Record<string, unknown>).sections as {
        items: { oneOf: Array<{ properties?: Record<string, unknown> }> };
      }
    ).items.oneOf;
    const responsibilities = branches
      .map((branch) => branch.properties?.responsibilities)
      .find((property) => typeof property === "object") as {
      description?: string;
    };

    expect(responsibilities.description).toContain("outcomes");
    expect(responsibilities.description).toContain("not for behavioral limits");
    expect(sectionDescription("instructions")).toContain("ordered instruction");
    expect(sectionDescription("gotchas")).toContain("situational");
  });
});

describe("temporary first-party vocabulary removal", () => {
  test("rejects old built-in locators instead of assigning a bundled identity", () => {
    for (const locator of [
      "atlante/starter",
      "atlante/agent",
      "atlante/skill",
    ]) {
      try {
        parseResourceLocator(locator);
        throw new Error(`expected ${locator} to be rejected`);
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceResolutionError);
        if (error instanceof ResourceResolutionError)
          expect(error.failure.code).toBe("invalid-locator");
      }
    }
  });

  test("removes the old bundled source tree and resolver module", () => {
    expect(
      existsSync(join(repositoryRoot, "packages", "resources", "bundled")),
    ).toBe(false);
    expect(
      existsSync(
        join(repositoryRoot, "packages", "resources", "src", "bundled.ts"),
      ),
    ).toBe(false);
    expect(
      readFileSync(
        join(repositoryRoot, "packages", "resources", "src", "index.ts"),
        "utf8",
      ),
    ).not.toContain("BUNDLED_");
    expect(
      readFileSync(
        join(repositoryRoot, "packages", "cli", "src", "main.ts"),
        "utf8",
      ),
    ).not.toContain("BUNDLED_");
  });
});
