import { afterEach, describe, expect, test } from "bun:test";
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
import packageJson from "../package.json" with { type: "json" };
import {
  createProjectResourcePack,
  interpolateValues,
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
  parseResourceLocator,
  type ResourceBindingCollectionSpec,
  ResourceResolutionError,
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
const created: string[] = [];
const packVersion = packageJson.version;
const firstPartyValues = {
  project: "Atlante",
  "workflow-root": ".atlante/workflows",
};

const expectedPackFiles = [
  "agent/template.jsonc",
  "agent/template.md",
  "atlante/instance.jsonc",
  "artifact/template.jsonc",
  "artifact/template.md",
  "atlante.jsonc",
  "eval/fixtures/calculator/src/sum.ts",
  "eval/fixtures/calculator/verify.ts",
  "eval/fixtures/policy-shim/harness/policy.jsonc",
  "eval/fixtures/policy-shim/src/app.ts",
  "eval/fixtures/policy-shim/verify.ts",
  "eval/fixtures/scope/docs/notes.md",
  "eval/fixtures/scope/src/format.ts",
  "eval/fixtures/scope/src/range.ts",
  "eval/fixtures/scope/verify.ts",
  "eval/report.json",
  "eval/scenarios/harness-red-green.eval.json",
  "eval/scenarios/policy-invariant.eval.json",
  "eval/scenarios/scope-discipline.eval.json",
  "brainstorm/instance.jsonc",
  "build/instance.jsonc",
  "gotchas/template.jsonc",
  "gotchas/template.md",
  "harness/instance.jsonc",
  "instructions/template.jsonc",
  "instructions/template.md",
  "invariants/template.jsonc",
  "invariants/template.md",
  "markdown/template.jsonc",
  "markdown/template.md",
  "plan/instance.jsonc",
  "references/template.jsonc",
  "references/template.md",
  "responsibilities/template.jsonc",
  "responsibilities/template.md",
  "review/instance.jsonc",
  "skill/template.jsonc",
  "skill/template.md",
  "workflow/instance.jsonc",
  "workflow/template.jsonc",
  "workflow/template.md",
  "test/atlante.unit.test.ts",
  "test/brainstorm.unit.test.ts",
  "test/build.unit.test.ts",
  "test/harness.unit.test.ts",
  "test/markdown-template.unit.test.ts",
  "test/normative-language.unit.test.ts",
  "test/plan.unit.test.ts",
  "test/preset.integration.test.ts",
  "test/review.unit.test.ts",
  "test/selection-fixture.ts",
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
      "eval/**/*.ts",
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
        .filter(
          (path) => path !== "package.json" && !path.includes("node_modules"),
        )
        .sort(),
    ).toEqual(["LICENSE", "README.md", ...expectedPackFiles].sort());
    expect(
      filesUnder(packRoot)
        .filter(
          (path) => !path.startsWith("test/") && !path.includes("node_modules"),
        )
        .filter((path) => /\.(?:[cm]?ts|[cm]?js)$/.test(path))
        .every((path) => path.startsWith("eval/")),
    ).toBe(true);
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
      "@atlante/pack/atlante",
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
      path: `@atlante/pack@${packVersion}/atlante/instance.jsonc`,
    });
  });

  test("resolves first-party self-references through the generic package path", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const projectPack = createProjectResourcePack(fixture.root);
    const document = resolveResourceDocument({
      pack: projectPack,
      rootFile: fixture.configPath,
      bindingCollections: atlanteBindingCollections,
    });

    expect(Object.keys(document.bindings.agents)).toEqual(["atlante"]);
    expect(Object.keys(document.bindings.skills).sort()).toEqual([
      "brainstorm",
      "build",
      "harness",
      "plan",
      "review",
    ]);
    const descriptionOrigin =
      document.provenance["/agents/atlante/description"];
    expect(descriptionOrigin?.kind).toBe("package");
    expect(String(descriptionOrigin?.path)).toBe(
      `@atlante/pack@${packVersion}/atlante/instance.jsonc`,
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

  test("preserves the first-party atlante rendered prompt bytes", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const projectPack = createProjectResourcePack(fixture.root);
    const atlante = resolveResourceInstance(
      projectPack,
      "@atlante/pack/atlante",
      fixture.configPath,
    );
    expect(String(atlante.effectiveTemplate.locator)).toBe(
      "@atlante/pack/agent",
    );
    const rendered = renderResolvedTemplate({
      template: atlante.effectiveTemplate,
      input: interpolateValues(atlante.input, firstPartyValues),
    });

    expect(rendered).toContain("You are the lead engineer for Atlante.");
    expect(rendered).not.toContain("{{values.project}}");
    expect(rendered).not.toContain("{{values.");
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
      "Conditions that MUST remain true throughout the work. Keep the set minimal and focused; include only consequential rules that must hold continuously. Use invariants for durable guarantees, safety boundaries, and approval gates. State each as one concrete, observable rule and include the compliant path when non-obvious. Back critical invariants with deterministic enforcement when possible. Use instructions for ordered actions, responsibilities for owned outcomes, and gotchas for situational risks. Do not duplicate requirements across sections.",
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
    const sectionBranches = (name: string) =>
      (
        readJson(join(packRoot, name, "template.jsonc")).properties as {
          sections: {
            items: { oneOf: Array<{ properties?: Record<string, unknown> }> };
          };
        }
      ).sections.items.oneOf.flatMap((branch) =>
        Object.keys(branch.properties ?? {}),
      );

    for (const surface of ["agent", "skill"]) {
      expect(sectionBranches(surface)).toContain("responsibilities");
      expect(
        readJson(join(packRoot, surface, "template.jsonc")).properties,
      ).not.toHaveProperty("responsibilities");
    }
    expect(sectionDescription("responsibilities")).toContain("outcomes");
    expect(sectionDescription("responsibilities")).toContain(
      "not for behavioral limits",
    );
    expect(sectionDescription("instructions")).toContain("ordered instruction");
    expect(sectionDescription("gotchas")).toContain("situational");
  });
});

describe("temporary first-party vocabulary removal", () => {
  test("parses old built-in locators as ordinary package locators", () => {
    for (const [locator, subpath] of [
      ["atlante/starter", "starter"],
      ["atlante/agent", "agent"],
      ["atlante/skill", "skill"],
    ] as const)
      expect(parseResourceLocator(locator)).toMatchObject({
        kind: "package",
        packageName: "atlante",
        subpath,
      });
    expect(() => parseResourceLocator("atlante/")).toThrow(
      ResourceResolutionError,
    );
  });

  test("fails old built-in locators through the generic declared-package path", () => {
    const fixture = firstPartyProject({ extends: "@atlante/pack" });
    const projectPack = createProjectResourcePack(fixture.root);

    try {
      loadTemplateFacet(projectPack, "atlante/starter", fixture.configPath);
      throw new Error("expected atlante/starter to fail resolution");
    } catch (error) {
      expect(error).toBeInstanceOf(ResourceResolutionError);
      if (error instanceof ResourceResolutionError)
        expect(error.failure.code).toBe("package-not-declared");
    }
  });
});
