import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resourceTemplateSelection } from "@atlante/resources";
import { SCHEMA_URI } from "@atlante/schema";
import { readArtifacts } from "../src/artifacts.js";
import {
  buildProject,
  type PublishOperation,
  prepareProject,
  validateProject,
} from "../src/index.js";

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

function privateArtifactEntries(root: string): string[] {
  if (!existsSync(join(root, ".atlante"))) return [];
  return readdirSync(join(root, ".atlante")).filter((entry) =>
    entry.startsWith(".artifacts."),
  );
}

function artifactTreeBytes(
  root: string,
): Array<{ path: string; bytes: Buffer }> {
  const artifactRoot = join(root, ".atlante", "artifacts");
  const paths = [
    "manifest.json",
    ...["agents", "skills"].flatMap((namespace) =>
      readdirSync(join(artifactRoot, namespace)).map((file) =>
        join(namespace, file),
      ),
    ),
  ];
  return paths.sort().map((path) => ({
    path,
    bytes: readFileSync(join(artifactRoot, path)),
  }));
}

describe("buildProject", () => {
  test("rejects a symlinked project target before publishing", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const target = join(root, "linked-project");
    symlinkSync(root, target);

    expect(() => buildProject(target)).toThrow("project root");
    expect(existsSync(join(root, ".atlante"))).toBe(false);
  });

  test("publishes exact prepared payloads and a verified manifest", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const prepared = prepareProject(root);

    const result = buildProject(root);

    expect(result.diagnostics).toEqual([]);
    expect(result.artifactsPath).toBe(join(root, ".atlante", "artifacts"));
    expect(readArtifacts(root)?.agents[0]).toMatchObject({
      hostAgentId: "reviewer",
      description: "reviewer description",
      prompt: prepared.agents[0]?.prompt,
    });
    expect(
      readFileSync(join(result.artifactsPath, "manifest.json"), "utf8"),
    ).toContain('"version": 1');
  });

  test("preserves prior artifacts when a valid resource fails Handlebars rendering", () => {
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

    expect(buildProject(root).diagnostics).toEqual([]);
    const before = artifactTreeBytes(root);
    writeFileSync(join(root, "agent", "template.md"), "{{#if");

    expect(validateProject(root).diagnostics).toEqual([]);
    const failed = buildProject(root);

    expect(failed.diagnostics).toContainEqual(
      expect.objectContaining({ code: "template-render-failed" }),
    );
    expect(failed.diagnostics[0]?.message).toContain("agent");
    expect(artifactTreeBytes(root)).toEqual(before);
    expect(readArtifacts(root)?.agents).toEqual([
      expect.objectContaining({
        hostAgentId: "reviewer",
        prompt: "You review.\nFind defects.\n",
      }),
    ]);
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

    const validated = validateProject(root);
    const built = buildProject(root);

    expect(validated.diagnostics).toEqual([]);
    expect(built.diagnostics).toEqual([]);
    expect(readArtifacts(root)?.agents).toEqual([
      expect.objectContaining({
        hostAgentId: "custom",
        description: "Built for local.",
        prompt: "# Custom\nLEFT localRIGHT right\n",
      }),
    ]);
  });

  test("does not resurrect a tombstoned global value during build", () => {
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

    const result = buildProject(root);

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-value",
        path: "/agents/reviewer/identity",
      }),
    );
    expect(readArtifacts(root)).toBeUndefined();
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

      const result = buildProject(root);

      expect(result.diagnostics).toEqual([]);
      expect(readArtifacts(root)?.agents[0]?.prompt).toBe(
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

      const result = buildProject(root);
      expect(result.diagnostics).toEqual([]);
      const prompt = readArtifacts(root)?.agents[0]?.prompt;
      if (prompt) prompts.push(prompt);
    }

    expect(prompts).toEqual(["SECOND selected", "SECOND selected"]);
  });

  test.each(nestedChildCases)(
    "selects inline branches inside resolved child templates",
    (testCase) => {
      const root = writeNestedChildProject(testCase);
      const result = buildProject(root);

      expect(result.diagnostics).toEqual([]);
      const branch = testCase.composition === "allOf" ? "FIRST" : "SECOND";
      expect(readArtifacts(root)?.agents[0]?.prompt).toBe(
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

    const result = buildProject(root);

    expect(result.diagnostics).toEqual([]);
    expect(readArtifacts(root)?.agents[0]?.prompt).toBe("SECOND configured");
  });

  test("produces deterministic bytes on repeated builds", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));

    buildProject(root);
    const first = [
      readFileSync(join(root, ".atlante", "artifacts", "manifest.json")),
      ...readdirSync(join(root, ".atlante", "artifacts", "agents")).map(
        (file) =>
          readFileSync(join(root, ".atlante", "artifacts", "agents", file)),
      ),
    ];
    buildProject(root);
    const second = [
      readFileSync(join(root, ".atlante", "artifacts", "manifest.json")),
      ...readdirSync(join(root, ".atlante", "artifacts", "agents")).map(
        (file) =>
          readFileSync(join(root, ".atlante", "artifacts", "agents", file)),
      ),
    ];

    expect(second).toEqual(first);
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test("publishes an empty valid manifest", () => {
    const { root } = project(JSON.stringify({ $schema: SCHEMA_URI }));

    const result = buildProject(root);

    expect(result.diagnostics).toEqual([]);
    expect(readArtifacts(root)).toEqual({ agents: [], skills: [] });
  });

  test("removes stale payloads on a successful rebuild", () => {
    const { root } = project(oneAgent("old", "Old prompt."));
    buildProject(root);
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("old");

    writeFileSync(join(root, "atlante.jsonc"), oneAgent("new", "New prompt."));
    buildProject(root);

    expect(
      readArtifacts(root)?.agents.map((agent) => agent.hostAgentId),
    ).toEqual(["new"]);
    expect(
      readdirSync(join(root, ".atlante", "artifacts", "agents")),
    ).toHaveLength(1);
  });

  test("keeps the previous tree when preparation fails", () => {
    const { root } = project(oneAgent("reviewer", "Good prompt."));
    buildProject(root);
    const before = artifactTreeBytes(root);

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
    const result = buildProject(root);

    expect(result.diagnostics[0]?.code).toBe("missing-value");
    expect(artifactTreeBytes(root)).toEqual(before);
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test.each([
    "create-directory",
    "write-manifest",
    "sync-file",
    "sync-directory",
    "write-payload",
    "rename-stage",
    "rename-backup",
  ] as PublishOperation[])(
    "restores the previous tree after %s failure",
    (operation) => {
      const { root } = project(oneAgent("reviewer", "Original prompt."));
      buildProject(root);
      const before = readArtifacts(root);
      let injected = false;

      writeFileSync(
        join(root, "atlante.jsonc"),
        oneAgent("replacement", "New prompt."),
      );
      expect(() =>
        buildProject(
          root,
          {},
          {
            fault: (current) => {
              if (!injected && current === operation) {
                injected = true;
                throw new Error(`injected ${operation} failure`);
              }
            },
          },
        ),
      ).toThrow(`injected ${operation} failure`);

      expect(readArtifacts(root)).toEqual(before);
      expect(privateArtifactEntries(root)).toEqual([]);
    },
  );

  test("reports stage cleanup failures without invalidating the previous tree", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    let thrown: unknown;

    try {
      buildProject(
        root,
        {},
        {
          fault: (operation) => {
            if (operation === "write-manifest") {
              throw new Error("injected publication failure");
            }
            if (operation === "cleanup-stage") {
              throw new Error("injected cleanup-stage failure");
            }
          },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "ArtifactPublicationError",
      recoverability: "no-previous-tree",
      cleanupErrors: [
        expect.objectContaining({ message: "injected cleanup-stage failure" }),
      ],
    });
    expect((thrown as Error).message).toContain(
      "cleanup failed: injected cleanup-stage failure",
    );
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("reviewer");
    expect(privateArtifactEntries(root)).toHaveLength(1);
  });

  test("keeps the backup when restoring after a persistent stage rename failure fails", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    writeFileSync(
      join(root, "atlante.jsonc"),
      oneAgent("replacement", "New prompt."),
    );

    let stageAttempts = 0;
    let restoreAttempts = 0;
    let thrown: unknown;
    try {
      buildProject(
        root,
        {},
        {
          fault: (operation) => {
            if (operation === "rename-stage") {
              stageAttempts += 1;
              throw new Error(
                `persistent stage rename failure ${stageAttempts}`,
              );
            }
            if (operation === "restore-backup") {
              restoreAttempts += 1;
              throw new Error(`restore failure ${restoreAttempts}`);
            }
          },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "ArtifactPublicationError",
      recoverability: "backup-preserved",
    });
    const backupPath = (thrown as { backupPath?: string }).backupPath;
    if (!backupPath)
      throw new Error("publication error did not preserve backup path");
    expect(backupPath && existsSync(backupPath)).toBe(true);
    expect(
      backupPath && readFileSync(join(backupPath, "manifest.json"), "utf8"),
    ).toContain('"reviewer"');
    expect(existsSync(join(root, ".atlante", "artifacts"))).toBe(false);
    expect(privateArtifactEntries(root)).toContain(
      backupPath.substring(backupPath.lastIndexOf("/") + 1),
    );
  });

  test("publishes with a warning when post-swap directory sync fails", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    writeFileSync(
      join(root, "atlante.jsonc"),
      oneAgent("replacement", "New prompt."),
    );
    let injected = false;

    const result = buildProject(
      root,
      {},
      {
        fault: (operation, path) => {
          if (
            !injected &&
            operation === "sync-directory" &&
            path === join(root, ".atlante")
          ) {
            injected = true;
            throw new Error("injected post-swap sync failure");
          }
        },
      },
    );

    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "post-publication-sync-failed",
        path: join(root, ".atlante"),
      }),
    ]);
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("replacement");
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test("publishes with a warning and preserves the backup after persistent cleanup failure", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    writeFileSync(
      join(root, "atlante.jsonc"),
      oneAgent("replacement", "New prompt."),
    );
    let injected = false;

    const result = buildProject(
      root,
      {},
      {
        fault: (operation) => {
          if (operation === "cleanup-backup") {
            injected = true;
            throw new Error("injected backup cleanup failure");
          }
        },
      },
    );

    expect(injected).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "backup-cleanup-failed" }),
    ]);
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("replacement");
    expect(privateArtifactEntries(root)).toHaveLength(1);
  });

  test("does not create a usable tree when publication fails without a previous tree", () => {
    const { root } = project(oneAgent("reviewer", "New prompt."));

    expect(() =>
      buildProject(
        root,
        {},
        {
          fault: (operation) => {
            if (operation === "rename-stage") {
              throw new Error("injected stage rename failure");
            }
          },
        },
      ),
    ).toThrow("injected stage rename failure");

    expect(existsSync(join(root, ".atlante", "artifacts"))).toBe(false);
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test("permits the no-tree visibility window during a live swap", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    writeFileSync(
      join(root, "atlante.jsonc"),
      oneAgent("replacement", "New prompt."),
    );
    let observed: ReturnType<typeof readArtifacts>;

    expect(() =>
      buildProject(
        root,
        {},
        {
          fault: (operation) => {
            if (operation === "rename-stage") {
              observed = readArtifacts(root);
              throw new Error("stop during permitted no-tree window");
            }
          },
        },
      ),
    ).toThrow("stop during permitted no-tree window");

    expect(observed).toBeUndefined();
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("reviewer");
  });

  test("rejects a symlinked .atlante directory before staging", () => {
    const { root } = project(oneAgent("reviewer", "Prompt."));
    const metadataTarget = join(root, "metadata-target");
    mkdirSync(metadataTarget);
    symlinkSync(metadataTarget, join(root, ".atlante"));

    expect(() => buildProject(root)).toThrow(".atlante");
    expect(readdirSync(metadataTarget)).toEqual([]);
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test("rejects a non-directory .atlante path before staging", () => {
    const { root } = project(oneAgent("reviewer", "Prompt."));
    writeFileSync(join(root, ".atlante"), "not a directory");

    expect(() => buildProject(root)).toThrow(".atlante");
    expect(readFileSync(join(root, ".atlante"), "utf8")).toBe(
      "not a directory",
    );
  });
});
