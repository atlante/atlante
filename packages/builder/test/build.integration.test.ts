import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCodeMaterializer } from "@atlante/opencode";
import { resourceTemplateSelection } from "@atlante/resources";
import { SCHEMA_URI } from "@atlante/schema";
import type { Diagnostic } from "@atlante/validator";
import {
  type BuildResult,
  buildProject,
  type HostMaterializer,
  type MaterializationOutcome,
  prepareProject,
  validateProject,
} from "../src/index.js";
import {
  EXTERNAL_AGENT_PROMPT,
  EXTERNAL_SKILL_CONTENT,
  writeExternalPack,
  writeExternalPackContent,
} from "./external-pack-fixture.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function project(document: string): { root: string; config: string } {
  const root = mkdtempSync(join(tmpdir(), "atlante-build-"));
  created.push(root);
  const config = join(root, "atlante.jsonc");
  writeFileSync(config, document);
  cpSync(firstPartyPackRoot, join(root, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-builder-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  return { root, config };
}

function writeTemplate(
  root: string,
  name: string,
  schema: Record<string, unknown>,
  source: string,
): void {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "template.jsonc"),
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      ...schema,
    }),
  );
  writeFileSync(join(directory, "template.md"), source);
}

function externalPackProject(): { root: string; packRoot: string } {
  const { root } = project(
    JSON.stringify({
      $schema: SCHEMA_URI,
      extends: "@acme/review-pack/strict",
    }),
  );
  const packRoot = join(root, "node_modules", "@acme", "review-pack");
  mkdirSync(packRoot, { recursive: true });
  writeExternalPack(packRoot);
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-builder-external-pack-fixture",
      version: "1.0.0",
      devDependencies: {
        "@atlante/pack": "workspace:0.1.6",
        "@acme/review-pack": "1.2.3",
      },
    })}\n`,
  );
  return { root, packRoot };
}

function localEquivalentProject(): string {
  const { root } = project(
    JSON.stringify({
      $schema: SCHEMA_URI,
      values: { project: "strict-project" },
      agents: {
        reviewer: {
          $instance: "./reviewer",
          description: "External reviewer for {{values.project}}.",
          mission: "Review the strict artifact.",
        },
      },
      skills: {
        testing: {
          $instance: "./testing",
          description: "Strict external testing for {{values.project}}.",
          body: "Strict external body.",
        },
      },
    }),
  );
  writeExternalPackContent(root);
  return root;
}

type NestedChildCase = Readonly<{
  composition: "oneOf" | "anyOf" | "allOf";
  order: readonly ("first" | "second")[];
  shape: "object" | "array";
}>;

const nestedChildCases: NestedChildCase[] = [
  { composition: "oneOf", order: ["first", "second"], shape: "object" },
  { composition: "oneOf", order: ["second", "first"], shape: "object" },
  { composition: "oneOf", order: ["first", "second"], shape: "array" },
  { composition: "oneOf", order: ["second", "first"], shape: "array" },
  { composition: "anyOf", order: ["first", "second"], shape: "object" },
  { composition: "anyOf", order: ["second", "first"], shape: "object" },
  { composition: "anyOf", order: ["first", "second"], shape: "array" },
  { composition: "anyOf", order: ["second", "first"], shape: "array" },
  { composition: "allOf", order: ["first", "second"], shape: "object" },
  { composition: "allOf", order: ["second", "first"], shape: "object" },
  { composition: "allOf", order: ["first", "second"], shape: "array" },
  { composition: "allOf", order: ["second", "first"], shape: "array" },
];

function writeNestedChildProject({
  composition,
  order,
  shape,
}: NestedChildCase): string {
  const allOf = composition === "allOf";
  const childInput = (kind: "first" | "second", value: string) => ({
    choice: {
      kind: allOf ? "same" : kind,
      payload: { value },
    },
  });
  const input =
    shape === "object"
      ? { child: childInput("second", "object-selected") }
      : {
          children: [
            childInput("first", "array-first"),
            childInput("second", "array-second"),
          ],
        };
  const slotPath = shape === "object" ? "child" : "children";
  const { root } = project(
    JSON.stringify({
      $schema: SCHEMA_URI,
      agents: {
        selected: {
          $template: "./parent",
          description: "Selected",
          ...input,
        },
      },
    }),
  );

  writeTemplate(
    root,
    "parent",
    {
      type: "object",
      properties: {
        [slotPath]:
          shape === "object"
            ? { template: "./child" }
            : { type: "array", items: { template: "./child" } },
      },
      required: [slotPath],
      additionalProperties: false,
    },
    `{{> slot/${slotPath}}}`,
  );
  writeTemplate(
    root,
    "parent/child",
    {
      type: "object",
      properties: {
        choice: {
          [composition]: order.map((branch) => ({
            type: "object",
            properties: {
              kind: { const: allOf ? "same" : branch },
              payload: { template: `./branch-${branch}` },
            },
            required: ["kind", "payload"],
            additionalProperties: false,
          })),
        },
      },
      required: ["choice"],
      additionalProperties: false,
    },
    "{{> slot/choice/payload}}",
  );
  for (const branch of ["first", "second"] as const)
    writeTemplate(
      root,
      `parent/child/branch-${branch}`,
      {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      `${branch.toUpperCase()} {{value}}`,
    );

  return root;
}

const oneAgent = (id: string, prompt: string) =>
  JSON.stringify({
    $schema: SCHEMA_URI,
    agents: {
      [id]: {
        description: `${id} description`,
        identity: prompt,
        mission: "Do the work.",
      },
    },
  });

type RecordedMaterialization = {
  projectRoot: string;
  agents: Array<{ hostAgentId: string; description: string; prompt: string }>;
  skills: Array<{ skillId: string; description: string; content: string }>;
};

function fakeMaterializer(
  outcome: Partial<MaterializationOutcome> = {},
  host = "opencode",
): HostMaterializer & {
  calls: RecordedMaterialization[];
  preparedOptions: unknown[];
} {
  const calls: RecordedMaterialization[] = [];
  const preparedOptions: unknown[] = [];
  return {
    host,
    calls,
    preparedOptions,
    materialize(projectRoot, prepared) {
      preparedOptions.push(prepared.options);
      calls.push({
        projectRoot,
        agents: prepared.agents.map(({ hostAgentId, description, prompt }) => ({
          hostAgentId,
          description,
          prompt,
        })),
        skills: prepared.skills.map(({ skillId, description, content }) => ({
          skillId,
          description,
          content,
        })),
      });
      return {
        diagnostics: outcome.diagnostics ?? [],
        writtenPaths: outcome.writtenPaths ?? [],
        removedPaths: outcome.removedPaths ?? [],
      };
    },
  };
}

function injectedFailure(code: string, message: string): Diagnostic[] {
  return [{ severity: "error", code, message }];
}

describe("buildProject", () => {
  test("rejects a symlinked project target before materializing", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const target = join(root, "linked-project");
    symlinkSync(root, target);

    expect(() => buildProject(target)).toThrow("project root");
    expect(existsSync(join(root, ".atlante"))).toBe(false);
  });

  test("fails the build when a declared host has no registered materializer", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));

    const result = buildProject(root);
    const withoutMaterializers = buildProject(root, {}, { materializers: [] });

    for (const built of [result, withoutMaterializers]) {
      expect(built.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: "error",
          code: "unsupported-host",
          message: expect.stringContaining("opencode"),
        }),
      );
      expect(built.materializations).toEqual([]);
    }
    expect(existsSync(join(root, ".opencode"))).toBe(false);
  });

  test("runs the registered materializer with the prepared project and reports its outcome", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const materializer = fakeMaterializer({
      writtenPaths: [".opencode/agents/reviewer.md"],
      removedPaths: [".opencode/agents/stale.md"],
    });

    const result = buildProject(root, {}, { materializers: [materializer] });

    expect(result.diagnostics).toEqual([]);
    expect(materializer.calls).toEqual([
      {
        projectRoot: root,
        agents: [
          {
            hostAgentId: "reviewer",
            description: "reviewer description",
            prompt: expect.stringContaining("Review the change."),
          },
        ],
        skills: [],
      },
    ]);
    expect(result.materializations).toEqual([
      {
        host: "opencode",
        writtenPaths: [".opencode/agents/reviewer.md"],
        removedPaths: [".opencode/agents/stale.md"],
      },
    ]);
  });

  test("selects the materializer through an explicit hosts field", () => {
    const { root } = project(
      JSON.stringify({
        $schema: SCHEMA_URI,
        hosts: ["opencode"],
        agents: {
          reviewer: {
            description: "reviewer description",
            identity: "Review the change.",
            mission: "Do the work.",
          },
        },
      }),
    );
    const materializer = fakeMaterializer();

    const result = buildProject(root, {}, { materializers: [materializer] });

    expect(result.diagnostics).toEqual([]);
    expect(materializer.calls).toHaveLength(1);
    expect(result.materializations.map(({ host }) => host)).toEqual([
      "opencode",
    ]);
  });

  test("propagates normalized native output options to the materializer", () => {
    const { root } = project(
      JSON.stringify({
        $schema: SCHEMA_URI,
        options: { agents: { outDir: "generated/agents" } },
        agents: {
          reviewer: {
            description: "Reviews changes.",
            identity: "Review the change.",
            mission: "Find defects.",
          },
        },
      }),
    );
    const materializer = fakeMaterializer();

    const result = buildProject(root, {}, { materializers: [materializer] });

    expect(result.diagnostics).toEqual([]);
    expect(materializer.preparedOptions).toEqual([
      {
        agents: { outDir: "generated/agents" },
        skills: { outDir: ".opencode/skills/atlante" },
      },
    ]);
  });

  test("merges materializer error diagnostics and fails the build", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const materializer = fakeMaterializer({
      diagnostics: injectedFailure(
        "materialization-collision",
        "unowned file at .opencode/agents/reviewer.md",
      ),
    });

    const result = buildProject(root, {}, { materializers: [materializer] });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "materialization-collision",
      }),
    );
    expect(result.materializations).toEqual([
      { host: "opencode", writtenPaths: [], removedPaths: [] },
    ]);
  });

  test("reports no partial materialization when a materializer rolls back", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const target = join(root, ".opencode", "agents", "reviewer.md");
    const materializer: HostMaterializer = {
      host: "opencode",
      materialize: (_projectRoot, prepared) => {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, prepared.agents[0]?.prompt ?? "");
        // The materializer owns rollback semantics: it removes its staged
        // write and reports no written paths for the failed publication.
        rmSync(target, { force: true });
        return {
          diagnostics: injectedFailure(
            "materialization-publication-failed",
            "publication failed and rolled back",
          ),
          writtenPaths: [],
          removedPaths: [],
        };
      },
    };

    const result = buildProject(root, {}, { materializers: [materializer] });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.materializations[0]?.writtenPaths).toEqual([]);
    expect(existsSync(target)).toBe(false);
  });

  test("keeps previous materialized outputs when a valid resource fails Handlebars rendering", () => {
    const { root } = project(
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            $template: "./agent",
            description: "Reviews changes.",
            identity: "You review.",
            mission: "Find defects.",
          },
        },
      }),
    );
    writeTemplate(
      root,
      "agent",
      {
        type: "object",
        properties: {
          identity: { type: "string" },
          mission: { type: "string" },
        },
        required: ["identity", "mission"],
        additionalProperties: false,
      },
      "{{identity}}\n{{mission}}\n",
    );
    const materializer = fakeMaterializer();

    expect(
      buildProject(root, {}, { materializers: [materializer] }).diagnostics,
    ).toEqual([]);
    writeFileSync(join(root, "agent", "template.md"), "{{#if");

    expect(validateProject(root).diagnostics).toEqual([]);
    const failed = buildProject(root, {}, { materializers: [materializer] });

    expect(failed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "template-render-failed" }),
    );
    expect(failed.diagnostics[0]?.message).toContain("agent");
    expect(materializer.calls).toHaveLength(1);
  });

  test("reports an ambiguous slot invocation under its dedicated code", () => {
    const { root } = project(
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            $template: "./parent",
            description: "Reviews changes.",
            // `extra` is not declared by the template schema, so this shape
            // passes resolved-input validation; the ambiguity is only visible
            // at render time, when the partial runs with an item context
            // whose shape blocks the slot walk.
            extra: { sections: [{ meta: "scalar" }] },
          },
        },
      }),
    );
    writeTemplate(
      root,
      "parent",
      {
        type: "object",
        properties: {
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                meta: {
                  type: "object",
                  properties: { markdown: { template: "../blocks" } },
                },
              },
            },
          },
        },
        additionalProperties: true,
      },
      `{{#each extra.sections}}{{> slot/sections/meta/markdown}}{{/each}}`,
    );
    writeTemplate(
      root,
      "blocks",
      { type: "array", items: { type: "string" } },
      "[{{#each (input)}}{{this}}{{/each}}]",
    );
    const materializer = fakeMaterializer();

    const failed = buildProject(root, {}, { materializers: [materializer] });

    expect(failed.diagnostics).toHaveLength(1);
    expect(failed.diagnostics[0]?.code).toBe("ambiguous-slot-invocation");
    expect(failed.diagnostics[0]?.message).toContain("reviewer");
    expect(failed.diagnostics[0]?.path).toBe("/agents/reviewer");
    expect(materializer.calls).toHaveLength(0);
  });

  test("validates and builds a custom local template with its relative children and values", () => {
    const { root } = project(
      JSON.stringify({
        $schema: SCHEMA_URI,
        values: { project: "global" },
        agents: {
          custom: {
            $template: "./custom",
            description: "Built for {{values.project}}.",
            values: { project: "local" },
            left: { value: "{{values.project}}" },
            right: { value: "right" },
          },
        },
      }),
    );
    writeTemplate(
      root,
      "custom",
      {
        type: "object",
        properties: {
          left: { template: "./left" },
          right: { template: "./right" },
        },
        required: ["left", "right"],
        additionalProperties: false,
      },
      "# Custom\n{{> slot/left left}}{{> slot/right right}}\n",
    );
    writeTemplate(
      root,
      "custom/left",
      {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      "LEFT {{value}}",
    );
    writeTemplate(
      root,
      "custom/right",
      {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
      "RIGHT {{value}}",
    );
    const materializer = fakeMaterializer();

    const validated = validateProject(root);
    const built = buildProject(root, {}, { materializers: [materializer] });

    expect(validated.diagnostics).toEqual([]);
    expect(built.diagnostics).toEqual([]);
    expect(materializer.calls[0]?.agents).toEqual([
      {
        hostAgentId: "custom",
        description: "Built for local.",
        prompt: "# Custom\nLEFT localRIGHT right\n",
      },
    ]);
  });

  test("builds a declared external pack into the same prepared payload as its local equivalent", () => {
    const external = externalPackProject();
    const local = localEquivalentProject();
    const externalMaterializer = fakeMaterializer();
    const localMaterializer = fakeMaterializer();

    const externalResult = buildProject(
      external.root,
      {},
      {
        materializers: [externalMaterializer],
      },
    );
    const localResult = buildProject(
      local,
      {},
      {
        materializers: [localMaterializer],
      },
    );

    expect(externalResult.diagnostics).toEqual([]);
    expect(localResult.diagnostics).toEqual([]);
    expect(externalResult.resourceWatch?.trustedRoots).toContainEqual({
      canonical: realpathSync(external.packRoot),
      lexical: external.packRoot,
    });
    expect(externalMaterializer.calls[0]?.agents).toEqual([
      {
        hostAgentId: "reviewer",
        description: "External reviewer for strict-project.",
        prompt: EXTERNAL_AGENT_PROMPT,
      },
    ]);
    expect(externalMaterializer.calls[0]?.skills).toEqual([
      {
        skillId: "testing",
        description: "Strict external testing for strict-project.",
        content: EXTERNAL_SKILL_CONTENT,
      },
    ]);
    expect(externalMaterializer.calls[0]?.agents).toEqual(
      localMaterializer.calls[0]?.agents,
    );
    expect(externalMaterializer.calls[0]?.skills).toEqual(
      localMaterializer.calls[0]?.skills,
    );
  });

  test("does not run a materializer when preparation reports missing values", () => {
    const { root } = project(
      JSON.stringify({
        $schema: SCHEMA_URI,
        values: { project: "global" },
        agents: {
          reviewer: {
            description: "Review",
            values: { project: null },
            identity: "{{values.project}}",
            mission: "Mission",
          },
        },
      }),
    );
    const materializer = fakeMaterializer();

    const result = buildProject(root, {}, { materializers: [materializer] });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-value",
        path: "/agents/reviewer/identity",
      }),
    );
    expect(materializer.calls).toEqual([]);
    expect(result.materializations).toEqual([]);
  });

  test("renders the AJV-matching inline branch, including nested arrays", () => {
    for (const composition of ["oneOf", "anyOf", "allOf"] as const) {
      const { root } = project(
        JSON.stringify({
          $schema: SCHEMA_URI,
          values: {
            branch: composition === "allOf" ? "same" : "second",
          },
          agents: {
            selected: {
              $template: "./parent",
              description: "Selected",
              choice: {
                kind: "{{values.branch}}",
                payload: { value: "single" },
              },
              sections: [
                { kind: "first", payload: { value: "array-first" } },
                { kind: "second", payload: { value: "array-second" } },
              ],
            },
          },
        }),
      );
      const branches = (property: "choice" | "sections") =>
        property === "sections"
          ? {
              type: "array",
              items: {
                oneOf: [
                  {
                    type: "object",
                    properties: {
                      kind: { const: "first" },
                      payload: { template: "./branch-first" },
                    },
                    required: ["kind", "payload"],
                    additionalProperties: false,
                  },
                  {
                    type: "object",
                    properties: {
                      kind: { const: "second" },
                      payload: { template: "./branch-second" },
                    },
                    required: ["kind", "payload"],
                    additionalProperties: false,
                  },
                ],
              },
            }
          : {
              [composition]: [
                {
                  type: "object",
                  properties: {
                    kind: {
                      const: composition === "allOf" ? "same" : "first",
                    },
                    payload: { template: "./branch-first" },
                  },
                  required: ["kind", "payload"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    kind: {
                      const: composition === "allOf" ? "same" : "second",
                    },
                    payload: { template: "./branch-second" },
                  },
                  required: ["kind", "payload"],
                  additionalProperties: false,
                },
              ],
            };
      writeTemplate(
        root,
        "parent",
        {
          type: "object",
          properties: {
            choice: branches("choice"),
            sections: branches("sections"),
          },
          required: ["choice", "sections"],
          additionalProperties: false,
        },
        "{{> slot/choice/payload}} {{> slot/sections/payload}}",
      );
      writeTemplate(
        root,
        "parent/branch-first",
        {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
        "FIRST {{value}}",
      );
      writeTemplate(
        root,
        "parent/branch-second",
        {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
        "SECOND {{value}}",
      );
      const materializer = fakeMaterializer();

      const result = buildProject(root, {}, { materializers: [materializer] });

      expect(result.diagnostics).toEqual([]);
      expect(materializer.calls[0]?.agents[0]?.prompt).toBe(
        `${composition === "allOf" ? "FIRST" : "SECOND"} single FIRST array-firstSECOND array-second`,
      );
    }
  });

  test("keeps inline branch selection independent of declaration order", () => {
    const prompts: string[] = [];
    for (const order of [
      ["first", "second"],
      ["second", "first"],
    ] as const) {
      const { root } = project(
        JSON.stringify({
          $schema: SCHEMA_URI,
          agents: {
            selected: {
              $template: "./parent",
              description: "Selected",
              choice: { kind: "second", payload: { value: "selected" } },
            },
          },
        }),
      );
      for (const branch of ["first", "second"])
        writeTemplate(
          root,
          `parent/branch-${branch}`,
          {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
          },
          `${branch.toUpperCase()} {{value}}`,
        );
      writeTemplate(
        root,
        "parent",
        {
          type: "object",
          properties: {
            choice: {
              oneOf: order.map((branch) => ({
                type: "object",
                properties: {
                  kind: { const: branch },
                  payload: { template: `./branch-${branch}` },
                },
                required: ["kind", "payload"],
                additionalProperties: false,
              })),
            },
          },
          required: ["choice"],
          additionalProperties: false,
        },
        "{{> slot/choice/payload}}",
      );
      const materializer = fakeMaterializer();

      const result = buildProject(root, {}, { materializers: [materializer] });
      expect(result.diagnostics).toEqual([]);
      const prompt = materializer.calls[0]?.agents[0]?.prompt;
      if (prompt) prompts.push(prompt);
    }

    expect(prompts).toEqual(["SECOND selected", "SECOND selected"]);
  });

  test.each(nestedChildCases)(
    "selects inline branches inside resolved child templates",
    (testCase) => {
      const root = writeNestedChildProject(testCase);
      const materializer = fakeMaterializer();

      const result = buildProject(root, {}, { materializers: [materializer] });

      expect(result.diagnostics).toEqual([]);
      const branch = testCase.composition === "allOf" ? "FIRST" : "SECOND";
      expect(materializer.calls[0]?.agents[0]?.prompt).toBe(
        testCase.shape === "object"
          ? `${branch} object-selected`
          : `FIRST array-first${branch} array-second`,
      );
    },
  );

  test("keeps configured child sidecars while selecting a nested inline branch", () => {
    const { root } = project(
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          selected: {
            $template: "./parent",
            description: "Selected",
            child: {
              kind: "second",
              payload: { $instance: "./selected-child" },
            },
          },
        },
      }),
    );
    writeTemplate(
      root,
      "parent",
      {
        type: "object",
        properties: {
          child: {
            oneOf: [
              {
                type: "object",
                properties: {
                  kind: { const: "first" },
                  payload: { template: "./child-first" },
                },
                required: ["kind", "payload"],
                additionalProperties: false,
              },
              {
                type: "object",
                properties: {
                  kind: { const: "second" },
                  payload: { template: "./child-second" },
                },
                required: ["kind", "payload"],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ["child"],
        additionalProperties: false,
      },
      "{{> slot/child/payload}}",
    );
    for (const child of ["first", "second"] as const)
      writeTemplate(
        root,
        `parent/child-${child}`,
        {
          type: "object",
          properties: {
            choice: {
              oneOf: [
                {
                  type: "object",
                  properties: {
                    kind: { const: "first" },
                    payload: { template: "./branch-first" },
                  },
                  required: ["kind", "payload"],
                  additionalProperties: false,
                },
                {
                  type: "object",
                  properties: {
                    kind: { const: "second" },
                    payload: { template: "./branch-second" },
                  },
                  required: ["kind", "payload"],
                  additionalProperties: false,
                },
              ],
            },
          },
          required: ["choice"],
          additionalProperties: false,
        },
        "{{> slot/choice/payload}}",
      );
    for (const child of ["first", "second"] as const)
      for (const branch of ["first", "second"] as const)
        writeTemplate(
          root,
          `parent/child-${child}/branch-${branch}`,
          {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
            additionalProperties: false,
          },
          `${branch.toUpperCase()} {{value}}`,
        );
    mkdirSync(join(root, "selected-child"), { recursive: true });
    writeFileSync(
      join(root, "selected-child", "instance.jsonc"),
      JSON.stringify({
        $template: "../parent/child-second",
        choice: {
          kind: "second",
          payload: { value: "configured" },
        },
      }),
    );

    const loaded = validateProject(root);
    const binding = loaded.resources?.bindings.agents.selected;
    if (!binding) throw new Error("selected binding missing");
    const child = binding.input.child as Record<string, unknown>;
    const payload = child.payload as Record<string, unknown>;
    const choice = payload.choice as Record<string, unknown>;
    const nestedPayload = choice.payload as Record<string, unknown>;

    expect(loaded.diagnostics).toEqual([]);
    expect(resourceTemplateSelection(payload)).toEqual({
      templateId: "./child-second",
    });
    expect(resourceTemplateSelection(nestedPayload)).toEqual({
      templateId: "./branch-second",
    });
    expect(JSON.stringify(binding.input)).toBe(
      '{"child":{"kind":"second","payload":{"choice":{"kind":"second","payload":{"value":"configured"}}}}}',
    );
    expect(
      Object.getOwnPropertySymbols(binding.template.facet.inputSchema),
    ).toEqual([]);

    const materializer = fakeMaterializer();
    const result = buildProject(root, {}, { materializers: [materializer] });

    expect(result.diagnostics).toEqual([]);
    expect(materializer.calls[0]?.agents[0]?.prompt).toBe("SECOND configured");
  });

  test("materializes deterministic native outputs and rebuilds without rewriting", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const materializers = [openCodeMaterializer];

    const first = buildProject(root, {}, { materializers });
    const agentPath = join(root, ".opencode", "agents", "reviewer.md");
    const firstBytes = readFileSync(agentPath);

    const second = buildProject(root, {}, { materializers });

    expect(first.diagnostics).toEqual([]);
    expect(first.materializations).toEqual([
      {
        host: "opencode",
        writtenPaths: [".opencode/agents/reviewer.md"],
        removedPaths: [],
      },
    ]);
    expect(existsSync(join(root, ".atlante", "opencode-native.json"))).toBe(
      true,
    );
    expect(second.diagnostics).toEqual([]);
    expect(second.materializations).toEqual([
      { host: "opencode", writtenPaths: [], removedPaths: [] },
    ]);
    expect(readFileSync(agentPath)).toEqual(firstBytes);
  });

  test("removes stale native outputs on a successful rebuild", () => {
    const { root } = project(oneAgent("old", "Old prompt."));
    const materializers = [openCodeMaterializer];
    buildProject(root, {}, { materializers });
    expect(readdirSync(join(root, ".opencode", "agents"))).toEqual(["old.md"]);

    writeFileSync(join(root, "atlante.jsonc"), oneAgent("new", "New prompt."));
    const rebuilt = buildProject(root, {}, { materializers });

    expect(rebuilt.diagnostics).toEqual([]);
    expect(readdirSync(join(root, ".opencode", "agents"))).toEqual(["new.md"]);
    expect(rebuilt.materializations[0]?.removedPaths).toEqual([
      ".opencode/agents/old.md",
    ]);
    expect(rebuilt.materializations[0]?.writtenPaths).toEqual([
      ".opencode/agents/new.md",
    ]);
  });

  test("materializes an empty prepared project", () => {
    const { root } = project(JSON.stringify({ $schema: SCHEMA_URI }));
    const materializer = fakeMaterializer();

    const result = buildProject(root, {}, { materializers: [materializer] });

    expect(result.diagnostics).toEqual([]);
    expect(materializer.calls).toEqual([
      { projectRoot: root, agents: [], skills: [] },
    ]);
  });

  test("keeps previous materialized outputs when preparation fails", () => {
    const { root } = project(oneAgent("reviewer", "Good prompt."));
    const materializers = [openCodeMaterializer];
    buildProject(root, {}, { materializers });
    const manifestPath = join(root, ".atlante", "opencode-native.json");
    const before = readFileSync(manifestPath);

    writeFileSync(
      join(root, "atlante.jsonc"),
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          broken: {
            description: "Missing value {{values.nope}}",
            identity: "Review.",
            mission: "Do the work.",
          },
        },
      }),
    );
    const result = buildProject(root, {}, { materializers });

    expect(result.diagnostics[0]?.code).toBe("missing-value");
    expect(result.materializations).toEqual([]);
    expect(readFileSync(manifestPath)).toEqual(before);
  });

  test("keeps previous materialized outputs when an external package fails", () => {
    const { root } = project(
      JSON.stringify({ $schema: SCHEMA_URI, extends: "review-pack" }),
    );
    const packageRoot = join(root, "node_modules", "review-pack");
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({
        name: "atlante-builder-fixture",
        version: "1.0.0",
        dependencies: { "review-pack": "1.2.3" },
      })}\n`,
    );
    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "review-pack",
        version: "1.2.3",
        atlante: { format: 1 },
      })}\n`,
    );
    writeFileSync(
      join(packageRoot, "atlante.jsonc"),
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            $template: "review-pack/agent",
            description: "Reviews changes.",
            identity: "You review.",
          },
        },
      })}\n`,
    );
    const agent = join(packageRoot, "agent");
    mkdirSync(agent);
    writeFileSync(
      join(agent, "template.jsonc"),
      `${JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { identity: { type: "string" } },
        required: ["identity"],
        additionalProperties: false,
      })}\n`,
    );
    writeFileSync(join(agent, "template.md"), "{{identity}}\n");
    const materializer = fakeMaterializer();

    const first = buildProject(root, {}, { materializers: [materializer] });
    expect(first.diagnostics).toEqual([]);
    expect(first.resourceWatch?.trustedRoots).toContainEqual({
      canonical: realpathSync(packageRoot),
      lexical: packageRoot,
    });

    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "review-pack",
        version: "1.2.3",
        atlante: { format: 2 },
      })}\n`,
    );
    const failed = buildProject(root, {}, { materializers: [materializer] });

    expect(failed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsupported-pack-format" }),
    );
    const prepared = prepareProject(root);
    expect(prepared.agents).toEqual([]);
    expect(prepared.skills).toEqual([]);
    expect(materializer.calls).toHaveLength(1);
  });

  test("surfaces a real materializer collision as a failed build", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const agentDirectory = join(root, ".opencode", "agents");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(join(agentDirectory, "reviewer.md"), "user-authored\n");

    const result = buildProject(
      root,
      {},
      {
        materializers: [openCodeMaterializer],
      },
    );

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: "error",
      code: "materialization-collision",
    });
    expect(readFileSync(join(agentDirectory, "reviewer.md"), "utf8")).toBe(
      "user-authored\n",
    );
    expect(existsSync(join(root, ".atlante", "opencode-native.json"))).toBe(
      false,
    );
  });
});

// The BuildResult shape the CLI reports on.
describe("BuildResult shape", () => {
  test("carries projectRoot, resourceWatch, diagnostics, and materializations", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const materializer = fakeMaterializer();

    const result: BuildResult = buildProject(
      root,
      {},
      {
        materializers: [materializer],
      },
    );

    expect(result.projectRoot).toBe(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.materializations).toHaveLength(1);
  });
});
