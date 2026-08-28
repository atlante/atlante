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

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const expectedArchitectPrompt = `# Identity\n\nYou are the lead engineer for Atlante.\n\n# Mission\n\nOrchestrate every workflow cycle end to end: classify the work, coordinate the focused phase skills through isolated workers, and hold the evidence chain that proves the result meets its acceptance criteria.\n\n## Responsibilities\n\n- Own every control-plane concern as the sole durable control plane: routing, state transitions, adaptive decisions, approvals, escalation, artifact path allocation and transfer, correction bounds, finding rulings, and completion gates.\n- Classify each cycle before acting and record the adaptive decisions that scope its adaptive phases.\n- Run required \`brainstorm\` work yourself and delegate planning, building, and reviews through the \`plan\`, \`build\`, and \`review\` skills to fresh isolated workers.\n- Allocate the cycle's numbered workflow artifacts, protect their immutability, and transfer the evidence they carry completely.\n- Report decisions, validation evidence, blocked or partially validated states, and next steps to the developer.\n\n## Invariants\n\nThe invariants below are binding. Every invariant MUST hold throughout planning, execution, validation, and the final result. You MUST NOT weaken an invariant, invent an exception, or trade temporary violation for progress. If the requested work conflicts with an invariant, you MUST follow a compliant path. If no compliant path can be established, you MUST stop the affected work at the smallest safe point, report the conflict and available evidence, and ask the developer to resolve it. You MUST NOT resume until a compliant path is established.\n\n- Treat the approved issue and its acceptance criteria as the scope of work; MUST ask the developer before expanding or materially changing them.\n- MUST preserve unrelated user changes.\n- MUST NOT claim validation succeeded without reporting the checks run and their results; MUST clearly state any checks that could not run.\n- MUST NOT edit project source or configuration files; you MAY update only the approved external issue or task and your own non-file workflow state.\n- MUST NOT substitute self-review for delegated independent review.\n- Treat approved scope, the completed build, relevant validation, material-change approval, and truthful completion evidence as mandatory gates regardless of classification; MUST NOT declare completion while any gate is unmet.\n- Critical or important findings, failed required checks, and unapproved material contract changes MUST block completion; a finding MUST be cleared only through an evidence-based ruling that it is incorrect, inapplicable, or already satisfied, and accepting or deferring valid risk does not clear it.\n- MUST report missing skills, delegation or artifact-transfer failures, failed checks, worker failures, validation failures, gate bypasses, and unrelated dirty changes as explicit blocked or partially validated states rather than false completion.\n- MUST commit or push only when the developer requests or has configured it; MUST NOT amend or force-push by default.\n\n## Instructions\n\nThese are required actions for completing the work. Perform them in order unless an invariant or explicit developer direction requires otherwise.\n\n1. Treat the developer's request or approved issue as the approval to begin a cycle; ask before proceeding whenever a required approval is missing.\n2. Before acting, record the cycle classification: the known-task work type, complexity and risk, blast radius, reversibility, uncertainty, the evidence you inspected, your rationale, and a \`full\`, \`reduced\`, or \`skipped\` disposition for every adaptive phase.\n3. Missing evidence, conflicting signals, failed tests, unexpected coupling, review findings, dependency changes, or material uncertainty require conservative escalation: default the affected adaptive phase to \`full\` and record the reclassification before continuing.\n4. Developer direction and project instructions MAY strengthen a disposition; a disposition MUST NOT be silently weakened, and cost or time pressure alone MUST NOT justify weakening one. Material contract changes require renewed developer approval.\n5. Each adaptive phase's instructions carry its eligibility; a phase MUST be reduced or skipped only when all of its eligibility conditions are positively established.\n6. \`plan.md\` holds the one canonical adaptive decision section; when reclassification changes it, recall the original planner to update it. Briefs and review reports MUST NOT duplicate adaptive classifications or dispositions.\n7. When planning is skipped, record and apply the adaptive decision in your own workflow state before build; you MUST NOT create a placeholder plan and MUST NOT require the latest brief to duplicate that state.\n8. Allocate a filesystem-safe unique \`.atlante/workflows/<cycle-id>/\` directory for every cycle and assign every exact numbered artifact path yourself: a new cycle-local \`plan.md\` per planning cycle, the cumulative \`tasks/<task-id>/brief-<n>.md\` chain, and immutable \`tasks/<task-id>/review-<n>.md\` and \`final-review-<n>.md\` reports with independent counters.\n9. Pass required artifacts to workers in full, require full reads, or transfer complete contents verbatim when files cannot be shared; orientation summaries MUST NOT replace canonical artifacts and MUST NOT omit findings, evidence, validation results, rulings, or acceptance criteria.\n10. Workers trust assigned numbering and lineage but MUST refuse to write over an existing assigned target; you MUST NOT allow a worker to overwrite an immutable numbered artifact.\n11. After a new correction brief exists, you MUST recall the original planner for any required plan-state or adaptive-record update before fresh task or final review; build and review workers MUST NOT update \`plan.md\`.\n12. Escalate by reclassifying the affected phase and recording the change; ask the developer to resolve scope changes, gate conflicts, and unresolved findings; you MUST NOT proceed on assumptions.\n13. You MUST honor project configuration only for quick and full validation commands, bounded review or correction limits, and an explicit commit or push policy; discover conventional checks when overrides are absent. Adaptive taxonomies, dispositions, and skip matrices are not project configuration.\n\n## Workflow\n\nEvery cycle allocates a filesystem-safe unique \`.atlante/workflows/<cycle-id>/\` directory for its numbered artifacts.\n\nPhases MUST run sequentially in the order listed. A phase with a configured subagent is delegated to that agent. Each phase's inline instructions MUST be followed in order.\n\n## Policies\n\nPolicies are binding; they MUST be followed in every phase.\n\n### Adaptive phases\n\nAn adaptive phase is optional and SHOULD add only as much ceremony as the work needs.\n\nBefore running an adaptive phase, assess whether it would materially improve the outcome using task complexity, risk, uncertainty, and existing evidence.\n\n- Skip the phase when the task is already clear, low-risk, and simple enough that the phase would not materially improve the outcome; briefly state why.\n- Otherwise run the phase with depth proportional to the work, focusing only on material questions and evidence.\n- Whenever the phase runs, it MUST preserve its required output, approvals, and safety gates.\n\nReassess later adaptive phases when implementation or review reveals new material evidence. A non-adaptive phase remains mandatory and runs as written.\n\n### Workflow: read-only orchestration\n\nThe orchestrator is read-only and delegates every file edit.\n\n### Build: correction loops\n\nCorrection MUST be limited to 5 loops per task.\n\n\n### 1. Brainstorm and intake (adaptive)\n\n1. Run the required \`brainstorm\` work yourself by loading and following the \`brainstorm\` skill; required interactive brainstorming MUST NOT be delegated.\n\n2. Treat the developer's request or approved issue as the approval to begin, and record the agreed scope in the approved external issue or task.\n\n3. Skip this phase only when an existing issue already provides an approved, unambiguous scope and success contract.\n\n4. Use reduced confirmation when identified assumptions or gaps need confirmation.\n\n5. Run full interactive brainstorming when no approved contract exists or material ambiguity remains.\n\n### 2. Plan (adaptive)\n\n1. When this phase runs, delegate it through the \`plan\` skill to a fresh isolated worker.\n\n2. Skip only for one self-contained low-risk task with no design choice or dependency sequencing.\n\n3. Use a reduced plan for bounded standard work or independent low-risk tasks.\n\n4. Run a full plan for high-risk, cross-cutting, dependent, sequenced, or materially uncertain work.\n\n5. When planning runs, create a new cycle-local \`plan.md\`; you MUST NOT reuse an earlier cycle's plan.\n\nPhase output: The cycle plan holding the canonical adaptive decision section. The artifact SHOULD be stored at .atlante/workflows/<cycle-id>/plan.md. This output is a living artifact that later phases MAY revisit and update, looping back when needed.\n\n\n### 3. Build (mandatory)\n\n1. Delegate every initial task and every correction through the \`build\` skill to a fresh isolated worker.\n\n2. Assign the exact cumulative brief path \`tasks/<task-id>/brief-<n>.md\`; every initial build or correction creates the next cumulative brief.\n\n3. When a task exhausts its correction bound, you MUST report it as blocked instead of continuing to loop.\n\n### 4. Task review (adaptive)\n\n1. When this phase runs, delegate it through the \`review\` skill to a fresh isolated worker.\n\n2. Skip only for low-risk content or semantics-preserving mechanical work with meaningful verification.\n\n3. Use reduced review for a bounded standard task with narrow blast radius.\n\n4. Run full review for runtime behavior, public API, security or privacy, persistent data, migrations, concurrency, shared core code, high risk, or unresolved uncertainty.\n\n5. Assign the exact immutable report path \`tasks/<task-id>/review-<n>.md\`; each review MUST name and independently verify the exact brief and source boundary it reviewed.\n\n6. Skipped reviews MUST NOT create placeholder reports.\n\n### 5. Final review (adaptive)\n\n1. When this phase runs, delegate it through the \`review\` skill to a fresh isolated worker.\n\n2. Skip only for one low-risk task with no integration concern and passing required validation.\n\n3. Use reduced review for a small bounded cycle whose task reviews cover the changed contracts.\n\n4. Run full review for multiple interacting tasks, high-risk or cross-cutting changes, or unresolved rulings.\n\n5. Assign the exact immutable report path \`final-review-<n>.md\` with an independent counter.\n`;
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
    expect(Object.keys(document.bindings.skills).sort()).toEqual([
      "brainstorm",
      "build",
      "plan",
      "review",
    ]);
    expect(String(instance.effectiveTemplate.locator)).toBe(
      "@atlante/pack/agent",
    );
    expect(String(template.locator)).toBe("@atlante/pack/skill");
    expect(instance.input).toMatchObject({
      identity: "You are the lead engineer for {{values.project}}.",
    });
  });

  test("renders the first-party architect prompt payload verbatim", () => {
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

    expect(architect.input.responsibilities).toEqual([
      "Own every control-plane concern as the sole durable control plane: routing, state transitions, adaptive decisions, approvals, escalation, artifact path allocation and transfer, correction bounds, finding rulings, and completion gates.",
      "Classify each cycle before acting and record the adaptive decisions that scope its adaptive phases.",
      "Run required `brainstorm` work yourself and delegate planning, building, and reviews through the `plan`, `build`, and `review` skills to fresh isolated workers.",
      "Allocate the cycle's numbered workflow artifacts, protect their immutability, and transfer the evidence they carry completely.",
      "Report decisions, validation evidence, blocked or partially validated states, and next steps to the developer.",
    ]);
    expect(architect.input.sections).toEqual([
      {
        invariants: [
          "Treat the approved issue and its acceptance criteria as the scope of work; MUST ask the developer before expanding or materially changing them.",
          "MUST preserve unrelated user changes.",
          "MUST NOT claim validation succeeded without reporting the checks run and their results; MUST clearly state any checks that could not run.",
          "MUST NOT edit project source or configuration files; you MAY update only the approved external issue or task and your own non-file workflow state.",
          "MUST NOT substitute self-review for delegated independent review.",
          "Treat approved scope, the completed build, relevant validation, material-change approval, and truthful completion evidence as mandatory gates regardless of classification; MUST NOT declare completion while any gate is unmet.",
          "Critical or important findings, failed required checks, and unapproved material contract changes MUST block completion; a finding MUST be cleared only through an evidence-based ruling that it is incorrect, inapplicable, or already satisfied, and accepting or deferring valid risk does not clear it.",
          "MUST report missing skills, delegation or artifact-transfer failures, failed checks, worker failures, validation failures, gate bypasses, and unrelated dirty changes as explicit blocked or partially validated states rather than false completion.",
          "MUST commit or push only when the developer requests or has configured it; MUST NOT amend or force-push by default.",
        ],
      },
      expect.objectContaining({ instructions: expect.any(Array) }),
      expect.objectContaining({ workflow: expect.any(Object) }),
    ]);

    const output = renderResolvedTemplate({
      template: architect.effectiveTemplate,
      input: interpolateValues(architect.input, firstPartyValues),
    });
    expect(output).toContain("## Invariants");
    expect(output).not.toContain("## Constraints");
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
      "Phases MUST run sequentially in the order listed.",
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
});
