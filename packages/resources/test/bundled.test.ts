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
  "workflow-root": ".atlante/workflows",
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

const approvedArchitect = {
  description:
    "General-purpose Atlante agent for planning, implementing, and reviewing software changes.",
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
    "Choose only the workflow phases and skills that materially improve the result; omitted phases require no classification, placeholder, or artifact, but implementation is not complete until it has an independent review or a stated reason for omitting one.",
    "Run selected workflow phases in their listed order and scale their depth to the work's complexity, risk, uncertainty, and available evidence while preserving any required output.",
    "Reassess the remaining workflow phases when new material evidence changes the work.",
    "When current work touches Atlante initialization, source configuration, resources, artifacts, validation, materialization, host integration, or harness improvement, load the `harness` skill alongside the active phase skills; it supplements them rather than replacing them, and an accepted harness improvement runs as its own delivery cycle.",
  ],
} as const;
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
      "harness",
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

  test("renders the first-party architect prompt payload with the approved sections", () => {
    const { root, config } = fixture();
    const instance = resolveResourceInstance(
      createProjectResourcePack(root),
      "@atlante/pack/architect",
      config,
    );
    const output = renderResolvedTemplate({
      template: instance.effectiveTemplate,
      input: interpolateValues(instance.input, firstPartyValues),
    });

    expect(instance.input.description).toBe(approvedArchitect.description);
    expect(output).toContain(
      `# Identity\n\nYou are the lead engineer for Atlante.\n\n# Mission\n\n${approvedArchitect.mission}`,
    );
    expect(output).not.toContain("## Responsibilities");
    for (const invariant of approvedArchitect.invariants)
      expect(output).toContain(`- ${invariant}`);
    for (const [index, instruction] of approvedArchitect.instructions.entries())
      expect(output).toContain(`${index + 1}. ${instruction}`);
    expect(output).toContain("## Workflow");
  });

  test("keeps the bundled architect content on invariant, instruction, and workflow sections", () => {
    const { root, config } = fixture();
    const pack = createProjectResourcePack(root);
    const architect = resolveResourceInstance(
      pack,
      "@atlante/pack/architect",
      config,
    );

    expect(architect.input.responsibilities).toBeUndefined();
    expect(architect.input.sections).toEqual([
      { invariants: approvedArchitect.invariants },
      { instructions: approvedArchitect.instructions },
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
              phases: [{ name: "Plan", instructions: ["Plan the review."] }],
            },
          },
          { invariants: ["After workflow"] },
        ],
      },
    });

    const markers = ["Before workflow", "## Workflow", "After workflow"];
    for (const marker of markers) expect(output).toContain(marker);
    expect(output.indexOf(markers[0])).toBeLessThan(output.indexOf(markers[1]));
    expect(output.indexOf(markers[1])).toBeLessThan(output.indexOf(markers[2]));
    expect(output).toContain(
      "The phases below describe the available workflow in their configured order.",
    );
  });

  test("renders responsibilities as an authored section after mission and preserves section order", () => {
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
        sections: [
          { responsibilities: ["Own the outcome."] },
          { instructions: ["Authored instruction."] },
          { invariants: ["Authored invariant."] },
          { markdown: [{ p: ["Authored markdown."] }] },
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
