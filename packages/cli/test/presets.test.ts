import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject, prepareProject } from "@atlante/builder";
import { listPresets, readPreset } from "@atlante/presets";
import { SCHEMA_URI } from "@atlante/schema";
import {
  expandDocument,
  parseDocumentOverlay,
  validateDocumentText,
} from "@atlante/validator";

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("bundled presets as user configurations", () => {
  test("every preset validates against the same schema as a user config", () => {
    for (const id of listPresets().presets) {
      const source = readPreset(id);
      if (!source) throw new Error(`preset ${id} missing`);
      const { document, diagnostics } = validateDocumentText(
        source,
        `${id}/atlante.jsonc`,
      );
      expect(diagnostics).toEqual([]);
      expect(document).toBeDefined();
    }
  });

  test("starter prepares explicit mode selection and adaptive workflow policies", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlante-cli-starter-"));
    created.push(dir);
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "atlante/starter"
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
      throw new Error("expected prepared starter prompts");

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
      "- Workflow: the orchestrator is read-only and delegates every file edit.",
    );
    expect(workflow).toContain(
      "- build: commit task implementation and corrections in separate commits, after the task's focused tests and checks pass; the orchestrator owns all commit authorship and pushing, and never amends or force-pushes.",
    );
    expect(workflow).toContain(
      "- build: apply task review according to this phase's review criteria.",
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
      "- build: limit correction to 5 loops per task.",
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

  test("CLI loading returns a canonical document and bundled skill template", () => {
    const dir = mkdtempSync(join(tmpdir(), "atlante-cli-preset-"));
    created.push(dir);
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "agents": {
          "reviewer": { "description": "Reviews changes.", "identity": "Review", "mission": "Find defects" }
        },
        "skills": {
          "testing": { "description": "Testing guidance", "content": "Run tests." }
        }
      }`,
    );

    const loaded = loadProject(dir);

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.document?.skills?.testing?.description).toBe(
      "Testing guidance",
    );
    expect(loaded.registry?.get("atlante/skill")).toBeDefined();
  });

  test("expands inherited preset skills through the shared overlay path", () => {
    const source = `{
      "$schema": "${SCHEMA_URI}",
      "extends": "atlante/with-skills",
      "agents": {}
    }`;
    const parsed = parseDocumentOverlay(source, "project/atlante.jsonc");
    expect(parsed.diagnostics).toEqual([]);
    if (!parsed.overlay) throw new Error("expected a valid overlay");

    const expanded = expandDocument(parsed.overlay, {
      load(id) {
        expect(id).toBe("atlante/with-skills");
        return {
          document: {
            $schema: SCHEMA_URI,
            agents: {},
            skills: {
              inherited: {
                description: "Inherited guidance",
                content: "Use tests.",
              },
            },
          },
          diagnostics: [],
        };
      },
    });

    expect(expanded.diagnostics).toEqual([]);
    expect(expanded.document?.skills?.inherited?.description).toBe(
      "Inherited guidance",
    );
    expect(expanded.document?.skills?.inherited?.content).toBe("Use tests.");
  });
});
