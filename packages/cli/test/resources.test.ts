import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject, prepareProject } from "@atlante/builder";
import { createProjectResourcePack, loadPresetFacet } from "@atlante/resources";
import { SCHEMA_URI } from "@atlante/schema";
import { validateDocumentText } from "@atlante/validator";
import { afterEach, describe, expect, test } from "vitest";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-cli-pack-"));
  created.push(root);
  cpSync(firstPartyPackRoot, join(root, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-cli-pack-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  return root;
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("first-party package resources as user configurations", () => {
  test("the first-party default preset validates against the user configuration schema", () => {
    const root = projectRoot();
    const configPath = join(root, "atlante.jsonc");
    const source = loadPresetFacet(
      createProjectResourcePack(root),
      "@atlante/pack",
      configPath,
    );
    const result = validateDocumentText(
      JSON.stringify(source.facet.document),
      configPath,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.document).toBeDefined();
  });

  test("the first-party preset prepares explicit mode selection and adaptive workflow policies", () => {
    const dir = projectRoot();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "@atlante/pack"
      }`,
    );

    const loaded = loadProject(dir);
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.document?.skills?.workflow).toMatchObject({
      sections: [
        {},
        {
          workflow: {
            policies: { orchestratorReadOnly: true },
            phases: [
              {
                kind: "plan",
                output: { updateable: true },
              },
              {
                kind: "build",
                policies: { commit: true, review: true, maxLoops: 5 },
              },
              { kind: "review" },
            ],
          },
        },
      ],
    });

    const prepared = prepareProject(dir);

    expect(prepared.diagnostics).toEqual([]);
    expect(prepared.agents.map(({ hostAgentId }) => hostAgentId)).toEqual([
      "architect",
    ]);
    expect(prepared.skills.map(({ skillId }) => skillId)).toEqual([
      "brainstorming",
      "workflow",
    ]);

    const architect = prepared.agents[0]?.prompt;
    const workflow = prepared.skills.find(
      ({ skillId }) => skillId === "workflow",
    )?.content;
    expect(architect).toBeDefined();
    expect(workflow).toBeDefined();
    if (!architect || !workflow)
      throw new Error("expected prepared first-party prompts");

    expect({
      omitsSupersededRoleBoundary: !workflow.includes(
        "never plans, implements, or reviews directly",
      ),
      preservesPlanReviewGate: workflow.includes(
        "The orchestrator reviews a full plan and presents it to the developer for approval before proceeding.",
      ),
      preservesReadOnlyBoundary: workflow.includes(
        "The orchestrator drives all phases but never edits files directly; it delegates every write, including corrections, to sub-agents",
      ),
      branchesExecutionUpdatesByPlanningMode: workflow.includes(
        "When execution reveals facts that change decomposition, sequencing, or scope, recall the same planner to update the existing living plan for full-plan work, or update the recorded judgment for inline work, before continuing.",
      ),
    }).toEqual({
      omitsSupersededRoleBoundary: true,
      preservesPlanReviewGate: true,
      preservesReadOnlyBoundary: true,
      branchesExecutionUpdatesByPlanningMode: true,
    });

    expect(architect).toContain(
      "Ask the developer to choose whether to start brainstorming or workflow; their choice is the approval to begin, regardless of whether an approved issue or task already exists.",
    );
    expect(architect).not.toContain(
      "After the developer chooses a mode, request explicit approval before loading and following its skill.",
    );
    expect(architect).not.toContain(
      "When an approved issue or task is available, load and follow the workflow skill.",
    );

    expect(workflow).toContain(
      "### Workflow: read-only orchestration\n\nThe orchestrator is read-only and delegates every file edit.",
    );
    expect(workflow).toContain(
      "### build: task commits\n\nCommit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.",
    );
    expect(workflow).toContain(
      "### build: task review\n\nApply task review according to this phase's review criteria.",
    );
    expect(workflow).not.toContain("review after each task");
    expect(workflow).toContain(
      "Assess the issue's type, size, and risk; decide and record whether to use the full plan or execute TDD-first inline, defaulting to a full plan for non-trivial work.",
    );
    expect(workflow).toContain(
      "For inline execution, skip the plan artifact and its approval and validation; record the judgment in task context and proceed directly to TDD-first execution.",
    );
    expect(workflow).toContain(
      "Treat the full plan as the source of truth when one exists; for TDD-first inline execution, treat the issue's acceptance criteria and the recorded judgment as the source of truth.",
    );
    expect(workflow).toContain(
      "Require per-task review for tasks touching runtime behavior, public API, security, or shared core code; mechanical tasks (renames, formatting, dependency bumps, documentation) may skip review but MUST still follow test-first behavior and pass a quick check.",
    );
    const requiredReview =
      "For a required per-task review, dispatch a separate reviewer for specification compliance and code quality.";
    expect(workflow).toContain(requiredReview);
    expect(workflow).not.toContain(
      "the orchestrator creates the initial focused task commit",
    );
    expect(workflow).not.toContain(
      "create a separate correction commit; never amend or force-push.",
    );
    expect(workflow).toContain(
      "### build: correction loops\n\nLimit correction to 5 loops per task.",
    );
    expect(workflow).not.toContain("five rounds per task");
    expect(workflow).toContain(
      "Escalate doubt in order: decide and document within scope; ask the orchestrator only for context or scope; ask the developer one question at a time only as a last resort.",
    );
    expect(workflow).toContain(
      "When produced, keep this output as the single living plan; recall the same planner when execution or whole-change review findings change decomposition, sequencing, or scope.",
    );
    expect(workflow).toContain(
      "Normally run this whole-change review only when a full plan has more than two tasks; skip it for TDD-first inline execution unless an edge case warrants it.",
    );
    expect(workflow).toContain(
      "Prepare precise review context with the approved plan when present, otherwise the recorded judgment. Include the change summary, acceptance criteria, applicable project instructions, relevant validation results, and the appropriate base and head revisions or current diff.",
    );
    expect(workflow).toContain(
      "Each fresh reviewer produces one immutable report and returns it as-is without fixing, re-reviewing, or looping.",
    );
    expect(workflow).toContain(
      "Assess the entire diff against the acceptance criteria, including deferred findings, cross-task integration, regressions, compatibility, security, and test coverage.",
    );
    expect(workflow).toContain(
      "For full-plan work, integrate required findings into the existing living plan; for inline work, update the recorded judgment. Immediately relaunch execute, then dispatch another fresh whole-change reviewer; repeat until clean or explicitly stopped with rulings or a blocker.",
    );
    expect(workflow).toContain(
      "Do not create a replacement plan or rerun the plan phase, and do not seek developer re-approval for full-plan whole-change review corrections.",
    );
  });

  test("CLI loading returns a canonical document and first-party skill template", () => {
    const dir = projectRoot();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "agents": {
          "reviewer": { "description": "Reviews changes.", "identity": "Review", "mission": "Find defects" }
        },
        "skills": {
          "testing": {
            "description": "Testing guidance",
            "title": "Testing",
            "overview": "Run tests.",
            "sections": [{ "markdown": "Run tests." }]
          }
        }
      }`,
    );

    const loaded = loadProject(dir);

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.document?.skills?.testing?.description).toBe(
      "Testing guidance",
    );
    expect(loaded.resources?.templates.length).toBeGreaterThan(0);
  });
});
