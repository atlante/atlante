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
});
