import { afterEach, describe, expect, test } from "bun:test";
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
import {
  createProjectResourcePack,
  interpolateValues,
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
  renderResolvedTemplate,
  resolveResourceDocument,
  resolveResourceInstance,
  resolveResourceTemplate,
} from "../src/index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const packRoot = join(repositoryRoot, "packages", "pack");
const packVersion = JSON.parse(
  readFileSync(join(packRoot, "package.json"), "utf8"),
).version as string;
const created: string[] = [];

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

## Constraints

These are non-negotiable limits on how you may act. Follow every constraint throughout your work; do not treat them as suggested outcomes or trade them off for convenience.

- Introduce abstractions only when they remove real duplication or improve clarity.
- Treat the approved issue and its acceptance criteria as the scope of work; MUST ask the developer before expanding or materially changing them.
- MUST preserve unrelated user changes.
- MUST NOT claim validation succeeded without reporting the checks run and their results; MUST clearly state any checks that could not run.

## Instructions

These are required actions for completing the work. Perform them in order unless a constraint or explicit developer direction requires otherwise.

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
    const document = resolveResourceDocument({ pack, rootFile: config });
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
});
