import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resourceTemplateSelection } from "@atlante/resources";
import { SCHEMA_URI } from "@atlante/schema";
import { afterEach, describe, expect, test } from "vitest";
import { loadDocument } from "../src/index.js";

const DRAFT_URI = "https://json-schema.org/draft/2020-12/schema";
const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

type LoadedResourceDocument = ReturnType<typeof loadDocument> & {
  resources?: {
    document: Record<string, unknown>;
    normalized: Record<string, unknown>;
    bindings: {
      agents: Record<string, { input: Record<string, unknown> }>;
      skills: Record<string, { input: Record<string, unknown> }>;
    };
    dependencies: string[];
  };
};

function project(config: unknown, name = "atlante-validator-") {
  const root = mkdtempSync(join(tmpdir(), name));
  created.push(root);
  const configPath = join(root, "atlante.jsonc");
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const firstPartyPackage = join(root, "node_modules", "@atlante", "pack");
  cpSync(firstPartyPackRoot, firstPartyPackage, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-validator-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  return { root, configPath };
}

function writeTemplate(
  root: string,
  name: string,
  schema: Record<string, unknown>,
  source = "{{input}}",
): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "template.jsonc"),
    `${JSON.stringify({ $schema: DRAFT_URI, ...schema }, null, 2)}\n`,
  );
  writeFileSync(join(directory, "template.md"), source);
  return directory;
}

function writeRawTemplate(
  root: string,
  name: string,
  schema: string,
  source = "{{input}}",
): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "template.jsonc"), schema);
  writeFileSync(join(directory, "template.md"), source);
  return directory;
}

function writeInstance(
  root: string,
  name: string,
  input: unknown,
  filename = "instance.jsonc",
): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, filename), `${JSON.stringify(input)}\n`);
  return directory;
}

function load(configPath: string): LoadedResourceDocument {
  return loadDocument(configPath) as LoadedResourceDocument;
}

function expectFailure(
  configPath: string,
  code: string,
): LoadedResourceDocument {
  const result = load(configPath);
  expect(result.document).toBeUndefined();
  expect(result.resources).toBeUndefined();
  expect(
    result.diagnostics.map(({ code: diagnosticCode }) => diagnosticCode),
  ).toContain(code);
  return result;
}

type InvalidValueKeyLayer = "global" | "agent" | "skill" | "instance";

function invalidValueKeyConfig(
  layer: InvalidValueKeyLayer,
): Record<string, unknown> {
  if (layer === "global")
    return {
      $schema: SCHEMA_URI,
      extends: "./base",
      values: { valid: "local" },
    };
  if (layer === "instance")
    return {
      $schema: SCHEMA_URI,
      agents: { reviewer: { $instance: "./derived", description: "Review" } },
    };
  return {
    $schema: SCHEMA_URI,
    extends: "./base",
    [layer === "agent" ? "agents" : "skills"]: {
      inherited: { values: { valid: "local" } },
    },
  };
}

function writeInvalidValueKeyLayer(
  root: string,
  layer: InvalidValueKeyLayer,
): void {
  if (layer === "instance") {
    writeInstance(root, "base", {
      $template: "@atlante/pack/agent",
      values: { "bad.key": "invalid" },
    });
    writeInstance(root, "derived", { $instance: "../base" });
    return;
  }

  const base = join(root, "base");
  mkdirSync(base);
  const source =
    layer === "global"
      ? { values: { "bad.key": "invalid" } }
      : {
          [layer === "agent" ? "agents" : "skills"]: {
            inherited: {
              $template: `@atlante/pack/${layer}`,
              description: "Inherited",
              values: { "bad.key": "invalid" },
            },
          },
        };
  writeFileSync(join(base, "atlante.jsonc"), `${JSON.stringify(source)}\n`);
}

function invalidValueKeySource(layer: InvalidValueKeyLayer): string {
  return layer === "instance" ? "base/instance.jsonc" : "base/atlante.jsonc";
}

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("resource-backed document validation", () => {
  test("anchors a missing extends target at the authored root pointer", () => {
    const { configPath } = project({
      $schema: SCHEMA_URI,
      extends: "./missing",
    });

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "missing-target",
    );

    expect(diagnostic).toMatchObject({
      code: "missing-target",
      path: "/extends",
      pointer: "/extends",
      source: "atlante.jsonc",
      location: { line: 3 },
    });
    expect(diagnostic?.location?.column).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostic)).not.toContain(configPath);
  });

  test("anchors an invalid inherited extends array entry at its source location", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      extends: "./base",
    });
    const base = join(root, "base");
    mkdirSync(base);
    mkdirSync(join(root, "valid"));
    writeFileSync(join(root, "valid", "atlante.jsonc"), "{}\n");
    writeFileSync(
      join(base, "atlante.jsonc"),
      `${JSON.stringify({ extends: ["./valid", 42] }, null, 2)}\n`,
    );

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "invalid-resolved-input",
    );

    expect(result.document).toBeUndefined();
    expect(diagnostic).toMatchObject({
      code: "invalid-resolved-input",
      path: "/extends/1",
      pointer: "/extends/1",
      source: "base/atlante.jsonc",
      location: { line: 4, column: 5 },
      chain: [
        { kind: "preset", locator: "./", source: "atlante.jsonc" },
        { kind: "preset", locator: "./base", source: "base/atlante.jsonc" },
      ],
    });
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("preserves facet parser coordinates and the authored selector pointer", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        broken: {
          $template: "./broken",
          description: "Broken",
        },
      },
    });
    writeRawTemplate(
      root,
      "broken",
      `{
        "$schema": "${DRAFT_URI}",
        "type":
      }`,
    );

    const result = load(configPath);
    expect(result.resourceWatch).toEqual({
      dependencies: [
        join(realpathSync(root), "atlante.jsonc"),
        join(realpathSync(root), "broken", "template.jsonc"),
        join(realpathSync(root), "broken", "template.md"),
        join(root, "atlante.json"),
      ].sort(),
      unresolvedParents: [join(realpathSync(root), "broken")],
    });
    expect(result.diagnostics).toEqual([
      {
        severity: "error",
        code: "malformed-jsonc",
        message: "selected resource JSONC is malformed",
        path: "/agents/broken/$template",
        pointer: "/agents/broken/$template",
        source: "broken/template.jsonc",
        location: { line: 4, column: 7 },
        chain: [
          { kind: "preset", locator: "./", source: "atlante.jsonc" },
          {
            kind: "template",
            locator: "./broken",
            source: "broken/template.jsonc",
          },
        ],
      },
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain(root);
  });

  test("keeps the authored pointer for an invalid template facet schema", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        broken: {
          $template: "./broken",
          description: "Broken",
        },
      },
    });
    writeRawTemplate(root, "broken", '{ "type": "object" }');

    const diagnostic = load(configPath).diagnostics[0];

    expect(diagnostic).toMatchObject({
      code: "invalid-template-schema",
      path: "/agents/broken/$template",
      pointer: "/agents/broken/$template",
      source: "broken/template.jsonc",
      location: { line: 1, column: 1 },
    });
  });

  test("uses each resolved child template when relative locators repeat", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          left: { child: { leftValue: 1 } },
          right: { child: { rightValue: 1 } },
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        left: { template: "./left" },
        right: { template: "./right" },
      },
    });
    for (const branch of ["left", "right"]) {
      writeTemplate(root, `parent/${branch}`, {
        type: "object",
        properties: { child: { template: "./child" } },
      });
    }
    writeTemplate(root, "parent/left/child", {
      type: "object",
      properties: { leftValue: { type: "string" } },
      required: ["leftValue"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/right/child", {
      type: "object",
      properties: { rightValue: { type: "string" } },
      required: ["rightValue"],
      additionalProperties: false,
    });

    const result = load(configPath);

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics.map(({ path }) => path)).toEqual([
      "/agents/reviewer/left/child/leftValue",
      "/agents/reviewer/right/child/rightValue",
    ]);
    expect(result.diagnostics.map(({ source }) => source)).toEqual([
      "parent/left/child/template.jsonc",
      "parent/right/child/template.jsonc",
    ]);
    expect(
      result.diagnostics.every(({ location }) => location?.line !== undefined),
    ).toBe(true);
    expect(
      result.diagnostics.every(({ code }) => code === "invalid-prompt-input"),
    ).toBe(true);
  });

  test("keeps nested schema diagnostics on the canonical child template", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          left: { child: {} },
          right: { child: {} },
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        left: { template: "./left" },
        right: { template: "./right" },
      },
    });
    for (const branch of ["left", "right"])
      writeTemplate(root, `parent/${branch}`, {
        type: "object",
        properties: { child: { template: "./child" } },
      });
    writeTemplate(root, "parent/left/child", {
      type: "object",
      properties: { value: { type: "not-a-json-schema-type" } },
    });
    writeTemplate(root, "parent/right/child", { type: "object" });

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "invalid-input-schema",
    );

    expect(diagnostic).toMatchObject({
      code: "invalid-input-schema",
      path: "/agents/reviewer/left/child",
      pointer: "/agents/reviewer/left/child",
      source: "parent/left/child/template.jsonc",
    });
    expect(diagnostic?.location?.line).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("preserves decorated diagnostic source and location from the template", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./template",
          description: "Review",
        },
      },
    });
    writeTemplate(root, "template", {
      type: "object",
      properties: { marker: { template: 42 } },
    });

    const diagnostic = load(configPath).diagnostics.find(
      ({ code }) => code === "invalid-input-schema",
    );

    expect(diagnostic).toMatchObject({
      source: "template/template.jsonc",
      path: "/agents/reviewer/marker",
      pointer: "/agents/reviewer/marker",
    });
    expect(diagnostic?.location?.line).toBeGreaterThan(0);
  });

  test.each(["oneOf", "anyOf", "allOf"] as const)(
    "attributes same-path %s child failures to the matching template after branch reversal",
    (keyword) => {
      const { root, configPath } = project({
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            $template: "./parent",
            description: "Review",
            choice: {},
          },
        },
      });
      writeTemplate(root, "left", {
        type: "object",
        properties: { leftOnly: { type: "string" } },
        required: ["leftOnly"],
        additionalProperties: false,
      });
      writeTemplate(root, "right", {
        type: "object",
        properties: { rightOnly: { type: "string" } },
        required: ["rightOnly"],
        additionalProperties: false,
      });

      for (const order of [
        ["left", "right"],
        ["right", "left"],
      ]) {
        writeTemplate(root, "parent", {
          type: "object",
          properties: {
            choice: {
              [keyword]: order.map((name) => ({ template: `../${name}` })),
            },
          },
          required: ["choice"],
          additionalProperties: false,
        });

        const diagnostics = load(configPath).diagnostics.filter(
          ({ path }) =>
            path === "/agents/reviewer/choice/leftOnly" ||
            path === "/agents/reviewer/choice/rightOnly",
        );

        expect(diagnostics).toHaveLength(2);
        expect(diagnostics).toContainEqual(
          expect.objectContaining({
            code: "invalid-prompt-input",
            path: "/agents/reviewer/choice/leftOnly",
            pointer: "/agents/reviewer/choice/leftOnly",
            source: "left/template.jsonc",
          }),
        );
        expect(diagnostics).toContainEqual(
          expect.objectContaining({
            code: "invalid-prompt-input",
            path: "/agents/reviewer/choice/rightOnly",
            pointer: "/agents/reviewer/choice/rightOnly",
            source: "right/template.jsonc",
          }),
        );
      }
    },
  );

  test("selects a valid inline branch and annotates its nested input", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          choice: { leftOnly: "selected" },
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        choice: {
          oneOf: [{ template: "../left" }, { template: "../right" }],
        },
      },
      required: ["choice"],
      additionalProperties: false,
    });
    writeTemplate(root, "left", {
      type: "object",
      properties: { leftOnly: { type: "string" } },
      required: ["leftOnly"],
      additionalProperties: false,
    });
    writeTemplate(root, "right", {
      type: "object",
      properties: { rightOnly: { type: "string" } },
      required: ["rightOnly"],
      additionalProperties: false,
    });

    const result = load(configPath);

    expect(result.diagnostics).toEqual([]);
    expect(
      resourceTemplateSelection(
        result.resources?.bindings.agents.reviewer?.input.choice,
      ),
    ).toEqual({ templateId: "../left" });
  });

  test("records the selected output for a direct nested child template", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          child: { value: "selected" },
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: { child: { template: "./child" } },
      required: ["child"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/child", {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    });

    const result = load(configPath);

    expect(result.diagnostics).toEqual([]);
    expect(
      resourceTemplateSelection(
        result.resources?.bindings.agents.reviewer?.input.child,
      ),
    ).toEqual({ templateId: "./child" });
  });

  test("validates input through a direct nested child template", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          child: { value: 42 },
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: { child: { template: "./child" } },
      required: ["child"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/child", {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    });

    expect(load(configPath).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "invalid-prompt-input",
        path: "/agents/reviewer/child/value",
        source: "parent/child/template.jsonc",
      }),
    );
  });

  test("preserves an authored inline selection over lexical branch fallback", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          choice: { $instance: "./selected" },
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        choice: {
          anyOf: [{ template: "../z-left" }, { template: "../a-right" }],
        },
      },
      required: ["choice"],
      additionalProperties: false,
    });
    for (const name of ["z-left", "a-right"])
      writeTemplate(root, name, {
        type: "object",
        properties: { shared: { type: "string" } },
        required: ["shared"],
        additionalProperties: false,
      });
    writeInstance(root, "selected", {
      $template: "../z-left",
      shared: "selected",
    });

    const result = load(configPath);
    const choice = result.resources?.bindings.agents.reviewer?.input.choice;

    expect(result.diagnostics).toEqual([]);
    expect(resourceTemplateSelection(choice)).toEqual({
      templateId: "../z-left",
    });
  });

  test.each(["anyOf", "allOf"] as const)(
    "uses stable lexical fallback for same-shape %s branches",
    (keyword) => {
      const { root, configPath } = project({
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            $template: "./parent",
            description: "Review",
            choice: { shared: "selected" },
          },
        },
      });
      writeTemplate(root, "parent", {
        type: "object",
        properties: {
          choice: {
            [keyword]: [{ template: "./z-left" }, { template: "./a-right" }],
          },
        },
        required: ["choice"],
        additionalProperties: false,
      });
      for (const name of ["z-left", "a-right"])
        writeTemplate(root, `parent/${name}`, {
          type: "object",
          properties: { shared: { type: "string" } },
          required: ["shared"],
          additionalProperties: false,
        });

      const result = load(configPath);
      const choice = result.resources?.bindings.agents.reviewer?.input.choice;

      expect(result.diagnostics).toEqual([]);
      expect(resourceTemplateSelection(choice)).toEqual({
        templateId: "./a-right",
      });
    },
  );

  test("retains branch selection while recursing into a selected child", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          choice: { $instance: "./selected" },
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        choice: {
          anyOf: [{ template: "./left" }, { template: "./right" }],
        },
      },
      required: ["choice"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/left", {
      type: "object",
      properties: { nested: { template: "../nested" } },
      required: ["nested"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/right", {
      type: "object",
      properties: { nested: { template: "../nested" } },
      required: ["nested"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/nested", {
      type: "object",
      properties: { right: { type: "string" } },
      required: ["right"],
      additionalProperties: false,
    });
    writeInstance(root, "selected", {
      $template: "../parent/right",
      nested: { right: "selected" },
    });

    const result = load(configPath);
    const choice = result.resources?.bindings.agents.reviewer?.input.choice;

    expect(result.diagnostics).toEqual([]);
    expect(resourceTemplateSelection(choice)).toEqual({
      templateId: "./right",
    });
    expect(
      resourceTemplateSelection((choice as Record<string, unknown>).nested),
    ).toEqual({ templateId: "../nested" });
  });

  test("rebases tuple child validation paths for each prefix item", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          items: [{ name: 1 }, { count: "not-a-number" }],
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        items: {
          type: "array",
          prefixItems: [{ template: "./name" }, { template: "./count" }],
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ["items"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/name", {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/count", {
      type: "object",
      properties: { count: { type: "number" } },
      required: ["count"],
      additionalProperties: false,
    });

    const diagnostics = load(configPath).diagnostics;

    expect(diagnostics.map(({ path }) => path)).toEqual([
      "/agents/reviewer/items/1/count",
      "/agents/reviewer/items/0/name",
    ]);
    expect(
      diagnostics.every(({ code }) => code === "invalid-prompt-input"),
    ).toBe(true);
  });

  test("rebases nested child-template paths below tuple items", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          items: [{ metadata: { value: 1 } }, { metadata: { value: false } }],
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        items: {
          type: "array",
          prefixItems: [{ template: "./name" }, { template: "./count" }],
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ["items"],
      additionalProperties: false,
    });
    for (const name of ["name", "count"])
      writeTemplate(root, `parent/${name}`, {
        type: "object",
        properties: { metadata: { template: "../metadata" } },
        required: ["metadata"],
        additionalProperties: false,
      });
    writeTemplate(root, "parent/metadata", {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    });

    const diagnostics = load(configPath).diagnostics;

    expect(diagnostics.map(({ path }) => path)).toEqual([
      "/agents/reviewer/items/0/metadata/value",
      "/agents/reviewer/items/1/metadata/value",
    ]);
    expect(
      diagnostics.every(({ code }) => code === "invalid-prompt-input"),
    ).toBe(true);
  });

  test("annotates every item when a child template is selected through array items", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          items: [{ name: "first" }, { name: "second" }],
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { template: "./item" },
          minItems: 2,
        },
      },
      required: ["items"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/item", {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    });

    const result = load(configPath);
    const items = result.resources?.bindings.agents.reviewer?.input.items;

    expect(result.diagnostics).toEqual([]);
    expect(Array.isArray(items)).toBe(true);
    if (Array.isArray(items)) {
      expect(items.map(resourceTemplateSelection)).toEqual([
        { templateId: "./item" },
        { templateId: "./item" },
      ]);
    }
  });

  test("selects inline branches independently for each array item", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          items: [{ left: "first" }, { right: "second" }],
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            oneOf: [{ template: "./left" }, { template: "./right" }],
          },
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ["items"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/left", {
      type: "object",
      properties: { left: { type: "string" } },
      required: ["left"],
      additionalProperties: false,
    });
    writeTemplate(root, "parent/right", {
      type: "object",
      properties: { right: { type: "string" } },
      required: ["right"],
      additionalProperties: false,
    });

    const result = load(configPath);
    const items = result.resources?.bindings.agents.reviewer?.input.items;

    expect(result.diagnostics).toEqual([]);
    expect(Array.isArray(items)).toBe(true);
    if (Array.isArray(items)) {
      expect(items.map(resourceTemplateSelection)).toEqual([
        { templateId: "./left" },
        { templateId: "./right" },
      ]);
    }
  });

  test("reports unresolved interpolated descriptions", () => {
    const unresolved = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./template",
          description: "{{values.missing}}",
        },
      },
    });
    writeTemplate(unresolved.root, "template", { type: "object" });
    expect(load(unresolved.configPath).diagnostics).toEqual([
      expect.objectContaining({
        code: "missing-value",
        path: "/agents/reviewer/description",
      }),
    ]);
  });

  test("accepts a nested input property named template", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
          settings: { template: "literal" },
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        settings: {
          type: "object",
          properties: {
            template: {
              type: "string",
              template: "test/not-a-composition-marker",
            },
          },
          required: ["template"],
          additionalProperties: false,
        },
      },
      required: ["settings"],
      additionalProperties: false,
    });

    const result = load(configPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.agents?.reviewer?.settings).toEqual({
      template: "literal",
    });
  });

  test("anchors malformed inherited binding values at the preset source", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      extends: "./base",
    });
    const base = join(root, "base");
    mkdirSync(base);
    writeFileSync(
      join(base, "atlante.jsonc"),
      `${JSON.stringify(
        {
          $schema: SCHEMA_URI,
          agents: {
            inherited: {
              $template: "@atlante/pack/agent",
              description: "Inherited",
              values: "not-an-object",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "invalid-resolved-input",
    );

    expect(diagnostic).toMatchObject({
      code: "invalid-resolved-input",
      path: "/agents/inherited/values",
      pointer: "/agents/inherited/values",
      source: "base/atlante.jsonc",
    });
    expect(diagnostic?.location?.line).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("rejects an unused inherited numeric binding value at its authored key", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      extends: "./base",
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: { identity: { type: "string" } },
      required: ["identity"],
      additionalProperties: false,
    });
    const base = join(root, "base");
    mkdirSync(base);
    writeFileSync(
      join(base, "atlante.jsonc"),
      `${JSON.stringify(
        {
          $schema: SCHEMA_URI,
          agents: {
            inherited: {
              $template: "../agent",
              description: "Inherited",
              values: { count: 3 },
              identity: "Identity",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ path }) => path === "/agents/inherited/values/count",
    );

    expect(result.document).toBeUndefined();
    expect(diagnostic).toMatchObject({
      code: "non-string-value",
      path: "/agents/inherited/values/count",
      pointer: "/agents/inherited/values/count",
      source: "base/atlante.jsonc",
    });
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("rejects an unused inherited invalid binding value key at its authored key", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      extends: "./base",
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: { identity: { type: "string" } },
      required: ["identity"],
      additionalProperties: false,
    });
    const base = join(root, "base");
    mkdirSync(base);
    writeFileSync(
      join(base, "atlante.jsonc"),
      `${JSON.stringify(
        {
          $schema: SCHEMA_URI,
          agents: {
            inherited: {
              $template: "../agent",
              description: "Inherited",
              values: { "bad key": "unused" },
              identity: "Identity",
            },
          },
        },
        null,
        2,
      )}\n`,
    );

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ path }) => path === "/agents/inherited/values/bad key",
    );

    expect(result.document).toBeUndefined();
    expect(diagnostic).toMatchObject({
      code: "invalid-value-reference",
      path: "/agents/inherited/values/bad key",
      pointer: "/agents/inherited/values/bad key",
      source: "base/atlante.jsonc",
    });
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test.each([
    ["agents", "agent"],
    ["skills", "skill"],
  ] as const)(
    "rejects an invalid inherited numeric %s binding value before a local override",
    (kind, subject) => {
      const { root, configPath } = project({
        $schema: SCHEMA_URI,
        extends: "./base",
        [kind]: {
          inherited: {
            values: { count: "local" },
          },
        },
      });
      writeTemplate(root, subject, {
        type: "object",
        properties: { identity: { type: "string" } },
        required: ["identity"],
        additionalProperties: false,
      });
      const base = join(root, "base");
      mkdirSync(base);
      writeFileSync(
        join(base, "atlante.jsonc"),
        `${JSON.stringify(
          {
            $schema: SCHEMA_URI,
            [kind]: {
              inherited: {
                $template: `../${subject}`,
                description: "Inherited",
                values: { count: 3 },
                identity: "Identity",
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const result = load(configPath);
      const path = `/${kind}/inherited/values/count`;
      const diagnostic = result.diagnostics.find(
        ({ pointer }) => pointer === path,
      );

      expect(result.document).toBeUndefined();
      expect(diagnostic).toMatchObject({
        code: "non-string-value",
        path,
        pointer: path,
        source: "base/atlante.jsonc",
      });
      expect(diagnostic?.location?.line).toBeGreaterThan(0);
      expect(JSON.stringify(diagnostic)).not.toContain(root);
    },
  );

  test.each([
    ["agents", "identity"],
    ["skills", "title"],
  ] as const)(
    "applies a binding tombstone before merging global %s values",
    (kind, referenceField) => {
      const { root, configPath } = project({
        $schema: SCHEMA_URI,
        extends: "./base",
        values: { project: "global" },
        [kind]: {
          inherited: { values: { project: null } },
        },
      });
      const binding =
        kind === "agents"
          ? {
              values: { project: "base" },
              description: "Inherited",
              identity: "{{values.project}}",
              mission: "Mission",
            }
          : {
              values: { project: "base" },
              description: "Inherited",
              title: "{{values.project}}",
              overview: "Overview",
              sections: [],
            };
      const base = join(root, "base");
      mkdirSync(base);
      writeFileSync(
        join(base, "atlante.jsonc"),
        `${JSON.stringify({
          $schema: SCHEMA_URI,
          [kind]: { inherited: binding },
        })}\n`,
      );

      const result = load(configPath);

      expect(result.document).toBeUndefined();
      expect(
        result.diagnostics.filter(
          ({ code, path }) =>
            code === "missing-value" &&
            path === `/${kind}/inherited/${referenceField}`,
        ),
      ).toHaveLength(1);
      expect(
        result.diagnostics.some(({ code }) => code === "non-string-value"),
      ).toBe(false);
    },
  );

  test("applies a tombstone carried by a derived instance before global interpolation", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      values: { project: "global" },
      agents: {
        derived: {
          $instance: "./derived",
          description: "Derived",
          identity: "{{values.project}}",
        },
      },
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: {
        identity: { type: "string" },
        mission: { type: "string" },
      },
      required: ["identity", "mission"],
      additionalProperties: false,
    });
    writeInstance(root, "base", {
      $template: "../agent",
      values: { project: "base" },
      identity: "Base identity",
      mission: "Base mission",
    });
    writeInstance(root, "derived", {
      $instance: "../base",
      values: { project: null },
    });

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-value",
        path: "/agents/derived/identity",
      }),
    );
  });

  test("reports all schema contract failures with input paths and template locations", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./template",
          description: "Review",
          extra: true,
        },
      },
    });
    writeRawTemplate(
      root,
      "template",
      `{
  "$schema": "${DRAFT_URI}",
  "type": "object",
  "properties": { "requiredValue": { "type": "string" } },
  "required": ["requiredValue"],
  "additionalProperties": false
}
`,
    );

    const diagnostics = load(configPath).diagnostics;

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid-prompt-input",
        message: expect.stringContaining("must NOT have additional properties"),
        path: "/agents/reviewer/extra",
        pointer: "/agents/reviewer/extra",
        source: "atlante.jsonc",
      }),
      expect.objectContaining({
        code: "invalid-prompt-input",
        message: expect.stringMatching(/must have required property/),
        path: "/agents/reviewer/requiredValue",
        pointer: "/agents/reviewer/requiredValue",
        source: "template/template.jsonc",
      }),
    ]);
  });

  test("rejects invalid composition markers throughout nested arrays with stable paths", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./template",
          description: "Review",
          items: [{ template: "" }, { template: "not-a-locator" }],
        },
      },
    });
    writeTemplate(root, "template", {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { template: "" },
        },
      },
    });

    const diagnostics = load(configPath).diagnostics;

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "invalid-input-schema",
        path: "/agents/reviewer/items",
        pointer: "/agents/reviewer/items",
        source: "template/template.jsonc",
      }),
    ]);
  });

  test("diagnoses unknown system values without a consuming binding", () => {
    const { configPath } = project({
      $schema: SCHEMA_URI,
      values: { unused: "{{sys.unknown}}" },
    });

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "unknown-system-variable",
    );

    expect(diagnostic).toMatchObject({
      code: "unknown-system-variable",
      path: "/values/unused",
      pointer: "/values/unused",
      source: "atlante.jsonc",
    });
    expect(diagnostic?.message).toContain('value "unused"');
  });

  test("anchors unknown system values inherited from a preset", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      extends: "./base",
    });
    const base = join(root, "base");
    mkdirSync(base);
    writeFileSync(
      join(base, "atlante.jsonc"),
      `${JSON.stringify(
        {
          $schema: SCHEMA_URI,
          values: { inherited: "{{sys.unknown}}" },
        },
        null,
        2,
      )}\n`,
    );

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "unknown-system-variable",
    );

    expect(diagnostic).toMatchObject({
      code: "unknown-system-variable",
      path: "/values/inherited",
      pointer: "/values/inherited",
      source: "base/atlante.jsonc",
    });
  });

  test("fails closed for inherited resolver properties in document values", () => {
    for (const key of ["constructor", "toString", "__proto__"]) {
      const { configPath } = project({
        $schema: SCHEMA_URI,
        values: { value: `{{sys.${key}}}` },
      });

      const result = load(configPath);

      expect(result.document).toBeUndefined();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "unknown-system-variable",
          path: "/values/value",
          source: "atlante.jsonc",
        }),
      );
    }
  });

  test("fails closed for inherited resolver properties in preset values", () => {
    for (const key of ["constructor", "toString", "__proto__"]) {
      const { root, configPath } = project({
        $schema: SCHEMA_URI,
        extends: "./base",
      });
      const base = join(root, "base");
      mkdirSync(base);
      writeFileSync(
        join(base, "atlante.jsonc"),
        `${JSON.stringify({
          $schema: SCHEMA_URI,
          values: { value: `{{sys.${key}}}` },
        })}\n`,
      );

      const result = load(configPath);

      expect(result.document).toBeUndefined();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "unknown-system-variable",
          path: "/values/value",
          source: "base/atlante.jsonc",
        }),
      );
    }
  });

  test("fails closed for inherited resolver properties in binding values", () => {
    for (const key of ["constructor", "toString", "__proto__"]) {
      const { configPath } = project({
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            $template: "@atlante/pack/agent",
            description: "Review",
            values: { system: `{{sys.${key}}}` },
            identity: "{{values.system}}",
            mission: "Find issues.",
          },
        },
      });

      const result = load(configPath);

      expect(result.document).toBeUndefined();
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "unknown-system-variable",
          path: "/agents/reviewer",
          source: "atlante.jsonc",
        }),
      );
    }
  });

  test("retains binding-specific unknown system diagnostics and source", () => {
    const { configPath } = project({
      $schema: SCHEMA_URI,
      values: { project: "{{sys.unknown}}" },
      agents: {
        reviewer: {
          $template: "@atlante/pack/agent",
          description: "Review",
          identity: "Review",
        },
      },
    });

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ path }) => path === "/agents/reviewer",
    );

    expect(diagnostic).toMatchObject({
      code: "unknown-system-variable",
      path: "/agents/reviewer",
      pointer: "/agents/reviewer",
      source: "atlante.jsonc",
    });
    expect(diagnostic?.message).toContain('agent "reviewer"');
  });

  test("anchors a missing nested slot template at its declaring schema slot", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
        },
      },
    });
    writeRawTemplate(
      root,
      "parent",
      `{
  "$schema": "${DRAFT_URI}",
  "type": "object",
  "properties": {
    "child": { "template": "./missing" }
  }
}
`,
    );

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "missing-target",
    );

    expect(diagnostic).toMatchObject({
      code: "missing-target",
      path: "/agents/reviewer/$template/child",
      pointer: "/agents/reviewer/$template/child",
      source: "parent/template.jsonc",
    });
    expect(diagnostic?.location).toEqual({ line: 5, column: 14 });
    expect(diagnostic?.chain?.map(({ source }) => source)).toEqual([
      "atlante.jsonc",
      "parent/template.jsonc",
    ]);
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("keeps a nested resource selector pointer and location", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        broken: {
          $instance: "./outer",
          description: "Broken",
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: { child: { template: "../child" } },
    });
    writeTemplate(root, "child", { type: "object" });
    const outer = join(root, "outer");
    mkdirSync(outer, { recursive: true });
    writeFileSync(
      join(outer, "instance.jsonc"),
      `{
  "$template": "../parent",
  "child": { "$template": "https://example.com/template" }
}
`,
    );

    const result = load(configPath);
    const diagnostic = result.diagnostics[0];

    expect(diagnostic).toMatchObject({
      code: "invalid-locator",
      path: "/agents/broken/$instance/child/$template",
      pointer: "/agents/broken/$instance/child/$template",
      source: "outer/instance.jsonc",
      location: { line: 3, column: 27 },
    });
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("uses the nested instance selector source and location for delegated failures", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        broken: {
          $instance: "./outer",
          description: "Broken",
        },
      },
    });
    mkdirSync(join(root, "outer"), { recursive: true });
    writeFileSync(
      join(root, "outer", "instance.jsonc"),
      `{
  "note": "outer",
  "$instance": "../inner"
}
`,
    );
    mkdirSync(join(root, "inner"), { recursive: true });
    writeFileSync(
      join(root, "inner", "instance.jsonc"),
      `{
  "$template": "../missing"
}
`,
    );

    const diagnostic = load(configPath).diagnostics[0];

    expect(diagnostic).toMatchObject({
      code: "missing-target",
      path: "/agents/broken/$instance/$instance/$template",
      pointer: "/agents/broken/$instance/$instance/$template",
      source: "inner/instance.jsonc",
      location: { line: 2, column: 16 },
    });
    expect(diagnostic?.chain?.map(({ source }) => source)).toEqual([
      "atlante.jsonc",
      "outer/instance.jsonc",
      "inner/instance.jsonc",
    ]);
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("maps nested child marker failures to complete canonical input pointers", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Review",
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: { child: { template: "./child" } },
    });
    writeTemplate(root, "parent/child", {
      type: "object",
      properties: {
        metadata: {
          type: "object",
          properties: { invalid: { template: 42 } },
        },
        sections: { type: "array", items: { template: "" } },
        choice: {
          oneOf: [
            {
              type: "object",
              properties: { branch: { template: "not-namespaced" } },
            },
          ],
        },
      },
    });

    const diagnostics = load(configPath).diagnostics;

    expect(diagnostics).toHaveLength(3);
    expect(diagnostics.map(({ path }) => path)).toEqual([
      "/agents/reviewer/child/choice/branch",
      "/agents/reviewer/child/metadata/invalid",
      "/agents/reviewer/child/sections",
    ]);
    expect(
      diagnostics.every(
        ({ source }) => source === "parent/child/template.jsonc",
      ),
    ).toBe(true);
  });

  test("rejects legacy built-in ids as semantic composition markers", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./legacy-markers",
          description: "Review",
        },
      },
    });
    writeTemplate(root, "legacy-markers", {
      type: "object",
      properties: {
        agent: { template: "atlante/agent" },
        skill: { template: "atlante/skill" },
        starter: { template: "atlante/starter" },
      },
    });

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.diagnostics.map(({ code }) => code)).toEqual([
      "invalid-input-schema",
      "invalid-input-schema",
      "invalid-input-schema",
    ]);
    expect(result.diagnostics.map(({ path }) => path)).toEqual([
      "/agents/reviewer/agent",
      "/agents/reviewer/skill",
      "/agents/reviewer/starter",
    ]);
  });

  test("sanitizes an absolute invalid composition marker from every diagnostic field", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./bad-marker",
          description: "Review",
        },
      },
    });
    writeTemplate(root, "bad-marker", {
      type: "object",
      properties: {
        choice: { template: join(root, "outside", "absolute-template") },
      },
    });

    const diagnostics = load(configPath).diagnostics;
    const diagnostic = diagnostics.find(
      ({ code }) => code === "invalid-input-schema",
    );

    expect(diagnostic).toMatchObject({
      code: "invalid-input-schema",
      path: "/agents/reviewer/choice",
      pointer: "/agents/reviewer/choice",
      source: "bad-marker/template.jsonc",
    });
    expect(JSON.stringify(diagnostics)).not.toContain(root);
  });

  test("loads local resource overlays and binding facets from the project root", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./agent",
          description: "Reviews the change.",
          identity: "You are a reviewer.",
          mission: "Find defects.",
        },
      },
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: {
        identity: { type: "string", minLength: 1 },
        mission: { type: "string", minLength: 1 },
      },
      required: ["identity", "mission"],
      additionalProperties: false,
    });

    const result = load(configPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.agents?.reviewer).toEqual({
      description: "Reviews the change.",
      identity: "You are a reviewer.",
      mission: "Find defects.",
    });
    expect(result.resources?.bindings.agents.reviewer?.input).toEqual({
      identity: "You are a reviewer.",
      mission: "Find defects.",
    });
    expect(
      result.resources?.dependencies.some((path) => path.includes(root)),
    ).toBe(true);
  });

  test("reports a value-reference collision in a resource-backed binding", () => {
    const { configPath } = project({
      $schema: SCHEMA_URI,
      values: { project: "atlante" },
      agents: {
        reviewer: {
          $template: "@atlante/pack/agent",
          description: "Reviews the change.",
          identity: "You review.",
          mission: "Find defects.",
          "{{values.project}}": "first",
          atlante: "second",
        },
      },
    });

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "value-reference-collision",
        path: "/agents/reviewer",
        message: expect.stringContaining("interpolated object keys collide"),
      }),
    );
  });

  test("reports an empty resource-backed description after interpolation", () => {
    const { configPath } = project({
      $schema: SCHEMA_URI,
      values: { empty: "" },
      agents: {
        reviewer: {
          $template: "@atlante/pack/agent",
          description: "{{values.empty}}",
          identity: "You review.",
          mission: "Find defects.",
        },
      },
    });

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "invalid-agent-description",
        path: "/agents/reviewer/description",
      }),
    );
  });

  test("reports a non-string resource-backed description after resolution", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "@atlante/pack/agent",
          description: null,
          identity: "You review.",
          mission: "Find defects.",
        },
      },
    });

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "invalid-resolved-input",
      message: "agent description must be a non-empty string after resolution",
      path: "/agents/reviewer/description",
      pointer: "/agents/reviewer/description",
      source: "atlante.jsonc",
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain(root);
  });

  test("reports unknown values and system references through resource validation", () => {
    const unknownValue = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "@atlante/pack/agent",
          description: "Reviews the change.",
          identity: "{{values.missing}}",
          mission: "Find defects.",
        },
      },
    });
    expect(load(unknownValue.configPath).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-value",
        path: "/agents/reviewer/identity",
      }),
    );

    const unknownSystem = project({
      $schema: SCHEMA_URI,
      values: { project: "{{sys.notAResolver}}" },
      agents: {
        reviewer: {
          $template: "@atlante/pack/agent",
          description: "Reviews the change.",
          identity: "You review.",
          mission: "Find defects.",
        },
      },
    });
    expect(load(unknownSystem.configPath).diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unknown-system-variable",
        path: "/values/project",
      }),
    );
  });

  test("distinguishes invalid, missing, and non-string binding references", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        invalid: {
          $template: "./agent",
          description: "Invalid",
          identity: "{{values.}}",
        },
        missing: {
          $template: "./agent",
          description: "Missing",
          identity: "{{values.absent}}",
        },
      },
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: { identity: { type: "string" } },
      required: ["identity"],
      additionalProperties: false,
    });

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-value-reference",
          path: "/agents/invalid/identity",
          message: expect.stringContaining(
            'invalid values reference "{{values.}}"',
          ),
        }),
        expect.objectContaining({
          code: "missing-value",
          path: "/agents/missing/identity",
          message: expect.stringContaining(
            'missing required value "{{values.absent}}"',
          ),
        }),
      ]),
    );
  });

  test("reports binding value contracts before resolving system values", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      extends: "./base",
      agents: { reviewer: { values: { valid: "local" } } },
    });
    writeTemplate(root, "agent", { type: "object" });
    mkdirSync(join(root, "base"));
    writeFileSync(
      join(root, "base", "atlante.jsonc"),
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            $template: "../agent",
            description: "Review",
            values: { "bad key": "invalid" },
          },
        },
      })}\n`,
    );

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-value-reference",
          path: "/agents/reviewer/values/bad key",
          message: expect.stringContaining('binding value name "bad key"'),
        }),
      ]),
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "unknown-system-variable" }),
    );
  });

  test("does not validate the prompt schema when a value reference is unresolved", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./agent",
          description: "Review",
          identity: "{{values.missing}}",
          mission: 42,
        },
      },
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: {
        identity: { type: "string", minLength: 99 },
        mission: { type: "string" },
      },
      required: ["identity", "mission"],
      additionalProperties: false,
    });

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "missing-value",
        path: "/agents/reviewer/identity",
      }),
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "invalid-prompt-input" }),
    );
  });

  test.each([
    [
      "unknown workflow policy",
      {
        policies: { orchestratorWrites: true },
        phases: [{ kind: "build", instructions: ["Make the change."] }],
      },
    ],
    [
      "phase without a name or kind",
      { phases: [{ instructions: ["Make the change."] }] },
    ],
    [
      "invalid phase input",
      { phases: [{ kind: "build", instructions: [{ description: "old" }] }] },
    ],
    [
      "unknown section input",
      { sections: [{ markdown: "Run tests.", extra: true }] },
    ],
  ] as const)("rejects negative bundled skill input: %s", (_label, input) => {
    const { configPath } = project({
      $schema: SCHEMA_URI,
      skills: {
        testing: {
          $template: "@atlante/pack/skill",
          description: "Testing guidance",
          title: "Testing",
          overview: "Run tests.",
          sections:
            "sections" in input ? input.sections : [{ workflow: input }],
        },
      },
    });

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-prompt-input" }),
    );
  });

  test("uses a declared package resource without loading unrelated siblings", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "custom-pack/agent",
          description: "Reviews the change.",
          identity: "Review it.",
        },
      },
    });
    const packageRoot = join(root, "node_modules", "custom-pack");
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({
        name: "atlante-validator-fixture",
        version: "1.0.0",
        dependencies: {
          "@atlante/pack": "workspace:0.1.6",
          "custom-pack": "1.0.0",
        },
      })}\n`,
    );
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "custom-pack",
        version: "1.0.0",
        atlante: { format: 1 },
      })}\n`,
    );
    writeTemplate(
      packageRoot,
      "agent",
      {
        type: "object",
        properties: { identity: { type: "string" } },
        required: ["identity"],
        additionalProperties: false,
      },
      "{{#if",
    );
    const unrelated = join(packageRoot, "broken");
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, "template.jsonc"), "{ not JSONC");
    writeFileSync(join(unrelated, "template.md"), "unrelated");

    const result = load(configPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.document).toBeDefined();
    expect(
      result.resources?.dependencies.some((path) => path.includes("broken")),
    ).toBe(false);
  });

  test("resolves local and first-party package root extends through the same resource path", () => {
    const local = project({
      $schema: SCHEMA_URI,
      extends: "./base",
      values: { local: "value" },
      agents: {
        local: {
          $template: "./agent",
          description: "Local agent",
          identity: "Local",
        },
      },
    });
    writeTemplate(local.root, "agent", {
      type: "object",
      properties: { identity: { type: "string" } },
      required: ["identity"],
      additionalProperties: false,
    });
    const base = join(local.root, "base");
    mkdirSync(base);
    writeFileSync(
      join(base, "atlante.jsonc"),
      JSON.stringify({
        $schema: SCHEMA_URI,
        values: { inherited: "value" },
        agents: {
          inherited: {
            $template: "../agent",
            description: "Inherited agent",
            identity: "Inherited",
          },
        },
      }),
    );

    const localResult = load(local.configPath);
    expect(localResult.diagnostics).toEqual([]);
    expect(localResult.document?.values).toEqual({
      inherited: "value",
      local: "value",
    });
    expect(localResult.document?.agents).toHaveProperty("inherited");
    expect(localResult.document?.agents).toHaveProperty("local");

    const builtin = project({
      $schema: SCHEMA_URI,
      extends: "@atlante/pack",
    });
    const builtinResult = load(builtin.configPath);
    expect(builtinResult.diagnostics).toEqual([]);
    expect(builtinResult.document?.agents).toHaveProperty("architect");
    expect(
      builtinResult.resources?.graph.nodes.some(
        ({ kind }) => kind === "preset",
      ),
    ).toBe(true);
  });

  test("keeps strict root JSON separate from JSONC resource facets", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./agent",
          description: "Reviews the change.",
          identity: "Review it.",
        },
      },
    });
    writeRawTemplate(
      root,
      "agent",
      `{
        // comments are valid in a facet
        "$schema": "${DRAFT_URI}",
        "type": "object",
        "properties": { "identity": { "type": "string" } },
        "required": ["identity"],
      }`,
    );

    expect(load(configPath).diagnostics).toEqual([]);

    const strictRoot = join(root, "atlante.json");
    writeFileSync(
      strictRoot,
      `{
        // comments are not valid in the root JSON facet
        "$schema": "${SCHEMA_URI}"
      }\n`,
    );
    const strictResult = loadDocument(strictRoot) as LoadedResourceDocument;
    expect(strictResult.document).toBeUndefined();
    expect(strictResult.diagnostics[0]?.code).toBe("invalid-json");
  });

  test("emits stable source-aware sorted diagnostics without absolute paths", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        zulu: { $template: "./agent", description: "Zulu" },
        alpha: { $template: "./agent", description: "Alpha" },
      },
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: { identity: { type: "string" } },
      required: ["identity"],
      additionalProperties: false,
    });

    const result = load(configPath);
    const diagnostics = result.diagnostics as Array<
      Record<string, unknown> & { path?: string; source?: string }
    >;

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map(({ path }) => path)).toEqual([
      "/agents/alpha/identity",
      "/agents/zulu/identity",
    ]);
    expect(diagnostics.every(({ source }) => typeof source === "string")).toBe(
      true,
    );
    expect(JSON.stringify(diagnostics)).not.toContain(root);
    expect(
      diagnostics.every(({ code }) => code === "invalid-prompt-input"),
    ).toBe(true);
  });

  test("retains root and nested descriptions at their semantic boundaries", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $template: "./parent",
          description: "Root description",
          child: "./child-instance",
        },
      },
    });
    writeTemplate(root, "parent", {
      type: "object",
      properties: { child: { template: "../child" } },
      required: ["child"],
      additionalProperties: false,
    });
    writeTemplate(root, "child", {
      type: "object",
      properties: { description: { type: "string" } },
      required: ["description"],
      additionalProperties: false,
    });
    writeInstance(root, "child-instance", {
      $template: "../child",
      description: "Nested description",
    });

    const result = load(configPath);

    expect(result.diagnostics).toEqual([]);
    expect(result.document?.agents?.reviewer).toEqual({
      description: "Root description",
      child: { description: "Nested description" },
    });

    writeFileSync(
      configPath,
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          reviewer: {
            $template: "./parent",
            child: "./child-instance",
          },
        },
      })}\n`,
    );
    expectFailure(configPath, "invalid-resolved-input");
  });

  test("preserves agent, skill, value, system-value, and composition diagnostics", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      values: { project: "Project" },
      agents: {
        reviewer: {
          $template: "./agent",
          description: "Review {{values.missing}}.",
          identity: "{{values.missing}}",
        },
      },
      skills: {
        testing: {
          $template: "./skill",
          description: "Testing",
          title: "Testing",
          overview: "Run tests.",
          sections: 42,
        },
      },
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: { identity: { type: "string" } },
    });
    writeTemplate(root, "skill", {
      type: "object",
      properties: { title: { type: "string" } },
      additionalProperties: false,
    });

    const result = load(configPath);
    const codes = result.diagnostics.map(({ code }) => code);

    expect(codes).toContain("missing-value");
    expect(codes).toContain("invalid-prompt-input");
    expect(result.diagnostics.map(({ path }) => path)).toContain(
      "/agents/reviewer/identity",
    );
    expect(result.diagnostics.map(({ path }) => path)).toContain(
      "/skills/testing/sections",
    );

    writeFileSync(
      configPath,
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        values: { project: "{{sys.unknown}}" },
        agents: {
          reviewer: {
            $template: "./agent",
            description: "Review",
            identity: "Review",
          },
        },
      })}\n`,
    );
    expect(load(configPath).diagnostics[0]?.code).toBe(
      "unknown-system-variable",
    );

    writeRawTemplate(
      root,
      "broken-composition",
      `{
        "$schema": "${DRAFT_URI}",
        "type": "object",
        "properties": { "child": { "template": 42 } }
      }`,
    );
    writeFileSync(
      configPath,
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          broken: {
            $template: "./broken-composition",
            description: "Broken composition",
          },
        },
      })}\n`,
    );
    expectFailure(configPath, "invalid-input-schema");
  });

  test("returns no canonical or resolved result for every resource failure category", () => {
    const cases: Array<{
      name: string;
      code: string;
      setup: (root: string) => Record<string, unknown>;
    }> = [
      {
        name: "invalid locator",
        code: "invalid-locator",
        setup: () => ({
          $template: "https://example.com/template",
          description: "Invalid",
        }),
      },
      {
        name: "missing target",
        code: "missing-target",
        setup: () => ({ $template: "./missing", description: "Missing" }),
      },
      {
        name: "wrong target type",
        code: "wrong-target-type",
        setup: (root) => {
          writeFileSync(join(root, "file"), "not a directory\n");
          return { $template: "./file", description: "Wrong target" };
        },
      },
      {
        name: "malformed JSONC",
        code: "malformed-jsonc",
        setup: (root) => {
          writeRawTemplate(root, "broken", "{ not JSONC");
          return { $template: "./broken", description: "Malformed" };
        },
      },
      {
        name: "invalid template schema",
        code: "invalid-template-schema",
        setup: (root) => {
          writeRawTemplate(root, "broken", '{ "type": "object" }');
          return { $template: "./broken", description: "Invalid schema" };
        },
      },
      {
        name: "conflicting selectors",
        code: "conflicting-selectors",
        setup: (root) => {
          writeTemplate(root, "template", { type: "object" });
          writeInstance(root, "instance", {
            $template: "../template",
            $instance: "../template",
          });
          return "./instance" as unknown as Record<string, unknown>;
        },
      },
      {
        name: "missing effective template",
        code: "missing-effective-template",
        setup: (root) => {
          writeInstance(root, "instance", { value: "no template" });
          return "./instance" as unknown as Record<string, unknown>;
        },
      },
      {
        name: "unsafe path",
        code: "unsafe-path",
        setup: () => ({ $template: "../../outside", description: "Unsafe" }),
      },
      {
        name: "invalid resolved input",
        code: "invalid-resolved-input",
        setup: (root) => {
          writeInstance(root, "array-instance", ["not an object"]);
          return "./array-instance" as unknown as Record<string, unknown>;
        },
      },
      {
        name: "ambiguous preset facet",
        code: "ambiguous-facet",
        setup: (root) => {
          const base = join(root, "base");
          mkdirSync(base);
          writeFileSync(join(base, "atlante.json"), "{}\n");
          writeFileSync(join(base, "atlante.jsonc"), "{}\n");
          return { extends: "./base" };
        },
      },
      {
        name: "resource cycle",
        code: "resource-cycle",
        setup: (root) => {
          writeInstance(root, "first", { $instance: "../second" });
          writeInstance(root, "second", { $instance: "../first" });
          return "./first" as unknown as Record<string, unknown>;
        },
      },
      {
        name: "incompatible nested template",
        code: "incompatible-template",
        setup: (root) => {
          writeTemplate(root, "parent", {
            type: "object",
            properties: { child: { template: "../child" } },
          });
          writeTemplate(root, "child", { type: "object" });
          writeTemplate(root, "other", { type: "object" });
          writeInstance(root, "wrong", { $template: "../other" });
          return {
            $template: "./parent",
            description: "Incompatible",
            child: "./wrong",
          };
        },
      },
    ];

    for (const testCase of cases) {
      const root = mkdtempSync(
        join(tmpdir(), `atlante-validator-${testCase.name}-`),
      );
      created.push(root);
      const source = testCase.setup(root);
      const config =
        testCase.name === "ambiguous preset facet"
          ? { $schema: SCHEMA_URI, ...source }
          : {
              $schema: SCHEMA_URI,
              agents: { broken: source },
            };
      const configPath = join(root, "atlante.jsonc");
      writeFileSync(configPath, `${JSON.stringify(config)}\n`);
      const result = expectFailure(configPath, testCase.code);
      if (testCase.code === "invalid-locator") {
        expect(result.diagnostics[0]?.source).toBe("atlante.jsonc");
        expect(result.diagnostics[0]?.pointer).toBe("/agents/broken/$template");
        expect(result.diagnostics[0]?.location?.line).toBeGreaterThan(0);
      }
    }
  });

  test("reports depth failures with the complete resource chain", () => {
    const root = mkdtempSync(join(tmpdir(), "atlante-validator-depth-"));
    created.push(root);
    for (let index = 0; index < 34; index++) {
      writeInstance(root, `node-${index}`, {
        $instance: index === 33 ? "../node-0" : `../node-${index + 1}`,
      });
    }
    const configPath = join(root, "atlante.jsonc");
    writeFileSync(
      configPath,
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        agents: { broken: "./node-0" },
      })}\n`,
    );

    const result = expectFailure(configPath, "resource-depth-exceeded");
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === "resource-depth-exceeded",
    ) as (typeof result.diagnostics)[number] & {
      chain?: readonly unknown[];
    };
    expect(diagnostic.chain?.length).toBeGreaterThan(32);
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("fails closed when semantic validation finds one bad binding among valid bindings", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        good: {
          $template: "./agent",
          description: "Good",
          identity: "valid",
        },
        bad: { $template: "./agent", description: "Bad" },
      },
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: { identity: { type: "string", minLength: 1 } },
      required: ["identity"],
      additionalProperties: false,
    });

    const result = load(configPath);

    expect(result.document).toBeUndefined();
    expect(result.resources).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.path).toBe("/agents/bad/identity");
  });

  test("does not mask an invalid inherited global value with a valid local override", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      extends: "./base",
      values: { count: "local" },
    });
    const base = join(root, "base");
    mkdirSync(base);
    writeFileSync(
      join(base, "atlante.jsonc"),
      `${JSON.stringify({ $schema: SCHEMA_URI, values: { count: 3 } })}\n`,
    );

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(
      ({ pointer }) => pointer === "/values/count",
    );

    expect(result.document).toBeUndefined();
    expect(diagnostic).toMatchObject({
      code: "non-string-value",
      path: "/values/count",
      pointer: "/values/count",
      source: "base/atlante.jsonc",
    });
    expect(diagnostic?.location?.line).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("does not mask an invalid base instance value with a valid derived override", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $instance: "./derived",
          description: "Review",
        },
      },
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: { identity: { type: "string" } },
      required: ["identity"],
      additionalProperties: false,
    });
    writeInstance(root, "base", {
      $template: "../agent",
      values: { count: 3 },
      identity: "base",
    });
    writeInstance(root, "derived", {
      $instance: "../base",
      values: { count: "local" },
    });

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(({ source }) =>
      source?.endsWith("base/instance.jsonc"),
    );

    expect(result.document).toBeUndefined();
    expect(diagnostic).toMatchObject({
      code: "non-string-value",
      source: "base/instance.jsonc",
    });
    expect(diagnostic?.path).toContain("/values/count");
    expect(diagnostic?.pointer).toContain("/values/count");
    expect(diagnostic?.location?.line).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  test("does not mask an invalid derived instance value with a valid root binding override", () => {
    const { root, configPath } = project({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $instance: "./derived",
          description: "Review",
          values: { count: "root" },
        },
      },
    });
    writeTemplate(root, "agent", {
      type: "object",
      properties: { identity: { type: "string" } },
      required: ["identity"],
      additionalProperties: false,
    });
    writeInstance(root, "base", {
      $template: "../agent",
      values: { count: "base" },
      identity: "base",
    });
    writeInstance(root, "derived", {
      $instance: "../base",
      values: { count: 3 },
    });

    const result = load(configPath);
    const diagnostic = result.diagnostics.find(({ source }) =>
      source?.endsWith("derived/instance.jsonc"),
    );

    expect(result.document).toBeUndefined();
    expect(diagnostic).toMatchObject({
      code: "non-string-value",
      source: "derived/instance.jsonc",
    });
    expect(diagnostic?.path).toContain("/values/count");
    expect(diagnostic?.pointer).toContain("/values/count");
    expect(diagnostic?.location?.line).toBeGreaterThan(0);
    expect(JSON.stringify(diagnostic)).not.toContain(root);
  });

  type ExternalPackageFailureKind =
    | "lookup"
    | "metadata"
    | "missing format"
    | "unsupported format"
    | "subpath"
    | "facet";

  type ExternalPackageFixture = {
    root: string;
    configPath: string;
    packageRoot: string;
  };

  function externalPackageDocument(
    failureKind: ExternalPackageFailureKind,
  ): Record<string, unknown> {
    return {
      $schema: SCHEMA_URI,
      extends:
        failureKind === "subpath" ? "review-pack/missing" : "review-pack",
      ...(failureKind === "facet"
        ? {
            agents: {
              broken: {
                $template: "review-pack/agent",
                description: "Broken",
              },
            },
          }
        : {}),
    };
  }

  function externalPackageManifest(
    failureKind: ExternalPackageFailureKind,
  ): string {
    if (failureKind === "metadata") return "{ broken\n";
    const manifest = {
      name: "review-pack",
      version: "1.2.3",
      ...(failureKind === "missing format"
        ? {}
        : {
            atlante: {
              format: failureKind === "unsupported format" ? 2 : 1,
            },
          }),
    };
    return `${JSON.stringify(manifest)}\n`;
  }

  function externalPackageFixture(
    failureKind: ExternalPackageFailureKind,
  ): ExternalPackageFixture {
    const { root, configPath } = project(externalPackageDocument(failureKind));
    const packageRoot = join(root, "node_modules", "review-pack");
    if (failureKind !== "lookup") {
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(
        join(packageRoot, "package.json"),
        externalPackageManifest(failureKind),
      );
      writeFileSync(join(packageRoot, "atlante.jsonc"), "{}\n");
    }
    if (failureKind === "facet") {
      const agent = join(packageRoot, "agent");
      mkdirSync(agent);
      writeFileSync(join(agent, "template.jsonc"), "{ broken\n");
      writeFileSync(join(agent, "template.md"), "broken\n");
    }
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify({
        name: "atlante-validator-fixture",
        version: "1.0.0",
        ...(failureKind === "lookup"
          ? {}
          : { dependencies: { "review-pack": "1.2.3" } }),
      })}\n`,
    );
    return { root, configPath, packageRoot };
  }

  function expectExternalPackageFailure(
    fixture: ExternalPackageFixture,
    failureKind: ExternalPackageFailureKind,
    expectedCode: string,
  ): void {
    const result = load(fixture.configPath);
    const diagnostic = result.diagnostics.find(
      ({ code }) => code === expectedCode,
    );
    const facetPath = "/agents/broken/$template";
    const path = failureKind === "facet" ? facetPath : "/extends";

    expect(result.document).toBeUndefined();
    expect(result.resources).toBeUndefined();
    expect(diagnostic).toMatchObject({
      code: expectedCode,
      source:
        failureKind === "facet"
          ? "review-pack@1.2.3/agent/template.jsonc"
          : "atlante.jsonc",
      pointer: path,
      path,
    });
    expect(diagnostic?.location?.line).toBeGreaterThan(0);
    expect(diagnostic?.chain?.[0]).toMatchObject({
      kind: "preset",
      locator: "./",
    });
    if (failureKind === "facet")
      expect(diagnostic?.chain).toContainEqual(
        expect.objectContaining({
          kind: "template",
          locator: "review-pack/agent",
          source: "review-pack@1.2.3/agent/template.jsonc",
        }),
      );
    expect(JSON.stringify(result.diagnostics)).not.toContain(fixture.root);
    if (failureKind !== "lookup")
      expect(result.resourceWatch?.trustedRoots).toContainEqual({
        canonical: realpathSync(fixture.packageRoot),
        lexical: fixture.packageRoot,
      });
  }

  test.each([
    ["lookup", "package-not-declared"],
    ["metadata", "package-metadata-unreadable"],
    ["missing format", "missing-pack-format"],
    ["unsupported format", "unsupported-pack-format"],
    ["subpath", "missing-package-subpath"],
    ["facet", "malformed-jsonc"],
  ] as const)(
    "translates external package %s failures into stable source diagnostics",
    (failureKind, expectedCode) =>
      expectExternalPackageFailure(
        externalPackageFixture(failureKind),
        failureKind,
        expectedCode,
      ),
  );

  test.each(["global", "agent", "skill", "instance"] as const)(
    "rejects invalid authored value keys in a %s layer",
    (layer) => {
      const { root, configPath } = project(invalidValueKeyConfig(layer));
      writeInvalidValueKeyLayer(root, layer);

      const result = load(configPath);
      const diagnostic = result.diagnostics.find(({ source }) =>
        source?.includes(invalidValueKeySource(layer)),
      );

      expect(result.document).toBeUndefined();
      expect(diagnostic).toMatchObject({
        code: "invalid-value-reference",
        source: invalidValueKeySource(layer),
      });
      expect(diagnostic?.path).toContain("/values/bad.key");
      expect(diagnostic?.pointer).toContain("/values/bad.key");
      expect(diagnostic?.location?.line).toBeGreaterThan(0);
      expect(JSON.stringify(diagnostic)).not.toContain(root);
    },
  );
});
