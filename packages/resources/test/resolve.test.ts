import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ResourceFailureCode,
  ResourceOrigin,
  ResourceResolutionError,
} from "../src/index.js";
import {
  canonicalGraphKey,
  createBundledResourcePack,
  createProjectResourcePack,
  resolveResourceDocument,
  resolveResourceInstance,
  resolveResourceTemplate,
  resourceTemplateSelection,
} from "../src/index.js";

const created: string[] = [];
const schemaUri = "https://json-schema.org/draft/2020-12/schema";

function rootOf(): { root: string; config: string } {
  const root = mkdtempSync(join(tmpdir(), "atlante-resolve-"));
  created.push(root);
  const config = join(root, "atlante.jsonc");
  writeFileSync(config, "{}\n");
  return { root, config };
}

function writeTemplate(
  root: string,
  name: string,
  schema: Record<string, unknown> = { type: "object" },
  source = "{{input}}",
): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "template.jsonc"),
    `${JSON.stringify({ $schema: schemaUri, ...schema }, null, 2)}\n`,
  );
  writeFileSync(join(directory, "template.md"), source);
  return directory;
}

function childSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: { value: { type: "string" } },
  };
}

function writeInstance(
  root: string,
  name: string,
  input: Record<string, unknown>,
): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "instance.jsonc"),
    `${JSON.stringify(input)}\n`,
  );
  return directory;
}

function writePreset(
  root: string,
  name: string,
  input: Record<string, unknown>,
): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "atlante.jsonc"), `${JSON.stringify(input)}\n`);
  return directory;
}

function expectFailure(
  action: () => unknown,
  code: ResourceFailureCode,
): ResourceResolutionError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error && "failure" in error) {
      const failure = (error as ResourceResolutionError).failure;
      expect(failure.code).toBe(code);
      return error as ResourceResolutionError;
    }
  }
  throw new Error(`expected ${code} failure`);
}

function originPath(
  provenance: Readonly<Record<string, ResourceOrigin>>,
  pointer: string,
): string {
  const origin = provenance[pointer];
  if (!origin) throw new Error(`missing provenance for ${pointer}`);
  return origin.path as string;
}

function resolveDocument(root: string, config: string) {
  return resolveResourceDocument({
    pack: createProjectResourcePack(root),
    rootFile: config,
    bundledPack: createBundledResourcePack(),
  });
}

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("resource resolution", () => {
  test("resolves template-only, sibling-template, explicit-template, and derived instance facets", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "template-only");
    writeTemplate(root, "sibling");
    writeInstance(root, "sibling", { value: "sibling" });
    writeTemplate(root, "explicit-template");
    writeInstance(root, "explicit-instance", {
      $template: "../explicit-template",
      value: "explicit",
    });
    writeInstance(root, "base-instance", {
      $template: "../explicit-template",
      base: true,
    });
    writeInstance(root, "derived-instance", {
      $instance: "../base-instance",
      derived: true,
    });

    const pack = createProjectResourcePack(root);
    const templateOnly = resolveResourceTemplate({
      pack,
      locator: "./template-only",
      authoringFile: config,
    });
    const sibling = resolveResourceInstance({
      pack,
      locator: "./sibling",
      authoringFile: config,
    });
    const explicit = resolveResourceInstance({
      pack,
      locator: "./explicit-instance",
      authoringFile: config,
    });
    const derived = resolveResourceInstance({
      pack,
      locator: "./derived-instance",
      authoringFile: config,
    });

    expect(templateOnly.origin.path as string).toBe(
      "template-only/template.jsonc",
    );
    expect(sibling.input).toEqual({ value: "sibling" });
    expect(explicit.input).toEqual({ value: "explicit" });
    expect(derived.input).toEqual({ base: true, derived: true });
    expect(derived.template.key).toBe(explicit.template.key);
  });

  test("preserves selected nested templates through a derived $instance", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        child: {
          oneOf: [
            {
              type: "object",
              properties: { payload: { template: "../branch-a" } },
            },
            {
              type: "object",
              properties: { payload: { template: "../branch-z" } },
            },
          ],
        },
      },
    });
    writeTemplate(root, "branch-a", childSchema());
    writeTemplate(root, "branch-z", childSchema());
    writeInstance(root, "selected", {
      $template: "../branch-z",
      value: "selected",
    });
    writeInstance(root, "base", {
      $template: "../parent",
      child: { payload: { $instance: "../selected" } },
      inherited: true,
    });
    writeInstance(root, "derived", {
      $instance: "../base",
      derived: true,
    });

    const result = resolveResourceInstance({
      pack: createProjectResourcePack(root),
      locator: "./derived",
      authoringFile: config,
    });

    expect(result.input).toEqual({
      child: { payload: { value: "selected" } },
      derived: true,
      inherited: true,
    });
    const child = result.input.child;
    if (typeof child !== "object" || child === null || Array.isArray(child))
      throw new Error("resolved child missing");
    expect(
      resourceTemplateSelection((child as Record<string, unknown>).payload),
    ).toEqual({
      templateId: "../branch-z",
    });
  });

  test("preserves selected nested templates through a local $instance overlay", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        child: {
          oneOf: [
            {
              type: "object",
              properties: { payload: { template: "../branch-a" } },
            },
            {
              type: "object",
              properties: { payload: { template: "../branch-z" } },
            },
          ],
        },
      },
    });
    writeTemplate(root, "branch-a", childSchema());
    writeTemplate(root, "branch-z", childSchema());
    writeInstance(root, "selected", {
      $template: "../branch-z",
      value: "selected",
    });
    writeInstance(root, "base", {
      $template: "../parent",
      child: { payload: { $instance: "../selected" } },
      inherited: true,
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          overlay: {
            $instance: "./base",
            description: "Overlay",
            local: true,
          },
        },
      })}\n`,
    );

    const result = resolveDocument(root, config);
    const binding = result.bindings.agents.overlay;
    if (!binding) throw new Error("overlay binding missing");

    expect(binding.input).toEqual({
      child: { payload: { value: "selected" } },
      inherited: true,
      local: true,
    });
    const child = binding.input.child;
    if (typeof child !== "object" || child === null || Array.isArray(child))
      throw new Error("resolved child missing");
    expect(
      resourceTemplateSelection((child as Record<string, unknown>).payload),
    ).toEqual({
      templateId: "../branch-z",
    });
  });

  test("rejects missing effective templates, conflicting selectors, malformed selectors, and wrong facets", () => {
    const { root, config } = rootOf();
    writeInstance(root, "missing", { value: true });
    writeInstance(root, "conflicting", {
      $template: "../template",
      $instance: "../missing",
    });
    writeInstance(root, "non-string", { $template: 42 });
    writeTemplate(root, "template");
    writeInstance(root, "wrong-target", { value: true });
    writeInstance(root, "wrong-instance", { $template: "../wrong-target" });

    const pack = createProjectResourcePack(root);
    expectFailure(
      () =>
        resolveResourceInstance({
          pack,
          locator: "./missing",
          authoringFile: config,
        }),
      "missing-effective-template",
    );
    expectFailure(
      () =>
        resolveResourceInstance({
          pack,
          locator: "./conflicting",
          authoringFile: config,
        }),
      "conflicting-selectors",
    );
    expectFailure(
      () =>
        resolveResourceInstance({
          pack,
          locator: "./non-string",
          authoringFile: config,
        }),
      "invalid-resolved-input",
    );
    expectFailure(
      () =>
        resolveResourceInstance({
          pack,
          locator: "./wrong-instance",
          authoringFile: config,
        }),
      "missing-target",
    );
  });

  test("resolves local and atlante/starter extends from the containing config", () => {
    const { root, config } = rootOf();
    writePreset(root, "base", {
      extends: "atlante/starter",
      values: { inherited: "false", local: "true" },
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        extends: "./base",
        values: { replaced: "root" },
        agents: {
          local: {
            $template: "atlante/agent",
            description: "Local agent",
            identity: "Identity",
            mission: "Mission",
          },
        },
      })}\n`,
    );

    const result = resolveDocument(root, config);

    expect(result.raw).toMatchObject({ extends: "./base" });
    expect(result.normalized.values).toMatchObject({
      inherited: "false",
      local: "true",
      replaced: "root",
    });
    expect(result.normalized.agents).toHaveProperty("architect");
    expect(result.normalized.agents).toHaveProperty("local");
    expect(result.graph.nodes.map(({ kind }) => kind)).toContain("preset");
    expect(result.provenance["/values/inherited"]?.path as string).toBe(
      "base/atlante.jsonc",
    );
    expect(result.provenance["/values/replaced"]?.path as string).toBe(
      "atlante.jsonc",
    );
    expect(
      result.provenance["/agents/architect/description"]?.path as string,
    ).toBe("atlante/starter/atlante.jsonc");
  });

  test("requires root descriptions but keeps nested descriptions as child input", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "parent", {
      type: "object",
      properties: { child: { template: "../child-template" } },
    });
    writeTemplate(root, "child-template", {
      type: "object",
      properties: { description: { type: "string" } },
    });
    writeInstance(root, "child-instance", {
      $template: "../child-template",
      description: "Nested description",
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          configured: {
            $template: "./parent",
            description: "Root description",
            child: { $instance: "./child-instance" },
          },
        },
      })}\n`,
    );

    const result = resolveDocument(root, config);
    const binding = result.bindings.agents.configured;
    if (!binding) throw new Error("configured binding missing");
    expect(binding.description).toBe("Root description");
    expect(binding.input).toEqual({
      child: { description: "Nested description" },
    });
    expect(binding.input).not.toHaveProperty("description");

    writeFileSync(
      config,
      `${JSON.stringify({ agents: { missing: { $template: "./parent" } } })}\n`,
    );
    expectFailure(
      () => resolveDocument(root, config),
      "invalid-resolved-input",
    );
  });

  test("renders compatible nested instances and rejects incompatible nested instances", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "parent", {
      type: "object",
      properties: { child: { template: "../child" } },
    });
    writeTemplate(root, "child");
    writeTemplate(root, "other");
    writeInstance(root, "compatible", { $template: "../child", value: "ok" });
    writeInstance(root, "incompatible", { $template: "../other", value: "no" });

    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          configured: {
            $template: "./parent",
            description: "Parent",
            child: "./compatible",
          },
        },
      })}\n`,
    );
    const compatible = resolveDocument(root, config);
    expect(compatible.bindings.agents.configured?.input).toEqual({
      child: { value: "ok" },
    });

    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          configured: {
            $template: "./parent",
            description: "Parent",
            child: { $instance: "./incompatible" },
          },
        },
      })}\n`,
    );
    expectFailure(() => resolveDocument(root, config), "incompatible-template");
  });

  test("keeps inline slot objects as template input", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "parent", {
      type: "object",
      properties: { child: { template: "../child" } },
    });
    writeTemplate(root, "child", {
      type: "object",
      properties: { description: { type: "string" } },
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          inline: {
            $template: "./parent",
            description: "Root",
            child: { description: "Inline child" },
          },
        },
      })}\n`,
    );

    expect(resolveDocument(root, config).bindings.agents.inline?.input).toEqual(
      {
        child: { description: "Inline child" },
      },
    );
  });

  test("keeps primitive inline slot values as template input", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "parent", {
      type: "object",
      properties: { label: { template: "../label" } },
    });
    writeTemplate(root, "label", { type: "string" });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          inline: {
            $template: "./parent",
            description: "Root",
            label: "Inline label",
          },
        },
      })}\n`,
    );

    expect(resolveDocument(root, config).bindings.agents.inline?.input).toEqual(
      {
        label: "Inline label",
      },
    );
  });

  for (const composition of ["oneOf", "anyOf", "allOf"] as const) {
    test(`selects a configured source from reversed ${composition} branches at one data path`, () => {
      const { root, config } = rootOf();
      writeTemplate(root, "first-child", {
        type: "object",
        properties: { value: { type: "string" } },
      });
      writeTemplate(root, "second-child", {
        type: "object",
        properties: { value: { type: "string" } },
      });
      writeInstance(root, "configured", {
        $template: "../second-child",
        value: "selected",
      });

      for (const branchOrder of [
        ["first-child", "second-child"],
        ["second-child", "first-child"],
      ] as const) {
        writeTemplate(root, "parent", {
          type: "object",
          properties: {
            choice: {
              [composition]: branchOrder.map((template) => ({
                type: "object",
                properties: {
                  payload: { template: `../${template}` },
                },
              })),
            },
          },
        });
        writeFileSync(
          config,
          `${JSON.stringify({
            agents: {
              configured: {
                $template: "./parent",
                description: "Configured branch",
                choice: { payload: { $instance: "./configured" } },
              },
            },
          })}\n`,
        );

        const result = resolveDocument(root, config);
        const binding = result.bindings.agents.configured;
        if (!binding) throw new Error("configured binding missing");
        expect(binding.input).toEqual({
          choice: { payload: { value: "selected" } },
        });
        const choice = binding.input.choice;
        if (typeof choice !== "object" || choice === null)
          throw new Error("resolved choice missing");
        expect(
          resourceTemplateSelection(
            (choice as Record<string, unknown>).payload,
          ),
        ).toEqual({ templateId: "../second-child" });
        expect(originPath(binding.provenance, "/choice/payload/value")).toBe(
          "configured/instance.jsonc",
        );
        const configured = result.instances.find(
          (instance) => instance.origin.path === "configured/instance.jsonc",
        );
        expect(configured?.effectiveTemplate.origin.path as string).toBe(
          "second-child/template.jsonc",
        );

        const nodeLabel = (key: string): string => {
          const node = result.graph.nodes.find(
            (candidate) => canonicalGraphKey(candidate) === key,
          );
          return node ? `${node.kind}:${node.origin.path as string}` : key;
        };
        const edges = result.graph.edges.map(({ from, to }) => [
          nodeLabel(from),
          nodeLabel(to),
        ]);
        expect(edges).toContainEqual([
          "template:parent/template.jsonc",
          "instance:configured/instance.jsonc",
        ]);
        expect(edges).toContainEqual([
          "instance:configured/instance.jsonc",
          "template:second-child/template.jsonc",
        ]);
        expect(edges).not.toContainEqual([
          "instance:configured/instance.jsonc",
          "template:first-child/template.jsonc",
        ]);
      }
    });

    test(`resolves bare locators from mixed implicit ${composition} branch schemas`, () => {
      const { root, config } = rootOf();
      writeTemplate(root, "implicit-child", {
        properties: { value: { type: "string" } },
      });
      writeTemplate(root, "explicit-child", {
        type: "object",
        properties: { value: { type: "string" } },
      });
      writeInstance(root, "configured", {
        $template: "../explicit-child",
        value: "selected",
      });
      writeTemplate(root, "parent", {
        type: "object",
        properties: {
          choice: {
            [composition]: [
              {
                properties: {
                  payload: { template: "../implicit-child" },
                },
              },
              {
                type: "object",
                properties: {
                  payload: { template: "../explicit-child" },
                },
              },
            ],
          },
          literal: { type: "string" },
        },
      });
      writeFileSync(
        config,
        `${JSON.stringify({
          agents: {
            configured: {
              $template: "./parent",
              description: "Configured branch",
              choice: { payload: "./configured" },
              literal: "./keep-as-a-literal",
            },
          },
        })}\n`,
      );

      const result = resolveDocument(root, config);
      expect(result.bindings.agents.configured?.input).toEqual({
        choice: { payload: { value: "selected" } },
        literal: "./keep-as-a-literal",
      });
    });
  }

  test("reports the complete traversal when no same-location branch matches", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        choice: {
          oneOf: [
            { template: "../first-child" },
            { template: "../second-child" },
          ],
        },
      },
    });
    writeTemplate(root, "first-child");
    writeTemplate(root, "second-child");
    writeTemplate(root, "wrong-child");
    writeInstance(root, "configured", {
      $template: "../wrong-child",
      value: "wrong",
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          configured: {
            $template: "./parent",
            description: "Configured branch",
            choice: { $instance: "./configured" },
          },
        },
      })}\n`,
    );

    const failure = expectFailure(
      () => resolveDocument(root, config),
      "incompatible-template",
    );
    expect(failure.failure.pointer).toBe("/agents/configured/choice");
    expect(
      failure.failure.chain?.map(({ origin }) => origin.path as string),
    ).toEqual([
      "atlante.jsonc",
      "parent/template.jsonc",
      "configured/instance.jsonc",
      "wrong-child/template.jsonc",
    ]);
  });

  test("does not mistake an agent input field named agents for a canonical pointer", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "agent", {
      type: "object",
      properties: { agents: { template: "./child" } },
    });
    writeTemplate(root, "agent/child", {
      type: "object",
      properties: { child: { template: "./missing" } },
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          reviewer: { $template: "./agent", description: "Review" },
        },
      })}\n`,
    );

    const failure = expectFailure(
      () => resolveDocument(root, config),
      "missing-target",
    );

    expect(failure.failure.pointer).toBe(
      "/agents/reviewer/$template/agents/child",
    );
  });

  test("does not mistake a skill input field named skills for a canonical pointer", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "skill", {
      type: "object",
      properties: { skills: { template: "./child" } },
    });
    writeTemplate(root, "skill/child", {
      type: "object",
      properties: { child: { template: "./missing" } },
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        skills: {
          testing: { $template: "./skill", description: "Testing" },
        },
      })}\n`,
    );

    const failure = expectFailure(
      () => resolveDocument(root, config),
      "missing-target",
    );

    expect(failure.failure.pointer).toBe(
      "/skills/testing/$template/skills/child",
    );
  });

  test("keeps no-match branch diagnostics identical when branch order is reversed", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "first-child");
    writeTemplate(root, "second-child");
    writeTemplate(root, "wrong-child");
    writeInstance(root, "configured", {
      $template: "../wrong-child",
      value: "wrong",
    });

    const failures = [
      ["first-child", "second-child"],
      ["second-child", "first-child"],
    ].map((branchOrder) => {
      writeTemplate(root, "parent", {
        type: "object",
        properties: {
          choice: {
            oneOf: branchOrder.map((template) => ({
              template: `../${template}`,
            })),
          },
        },
      });
      writeFileSync(
        config,
        `${JSON.stringify({
          agents: {
            configured: {
              $template: "./parent",
              description: "Configured branch",
              choice: "./configured",
            },
          },
        })}\n`,
      );
      return expectFailure(
        () => resolveDocument(root, config),
        "incompatible-template",
      );
    });

    expect(failures[1]?.failure).toEqual(failures[0]?.failure);
    expect(failures[1]?.message).toBe(failures[0]?.message);
  });

  test("preserves inline objects at same-location branch markers for later schema validation", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "parent", {
      type: "object",
      properties: {
        choice: {
          oneOf: [
            { template: "../first-child" },
            { template: "../second-child" },
          ],
        },
      },
    });
    writeTemplate(root, "first-child", {
      type: "object",
      properties: { first: { type: "string" } },
    });
    writeTemplate(root, "second-child", {
      type: "object",
      properties: { second: { type: "string" } },
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          inline: {
            $template: "./parent",
            description: "Inline branch",
            choice: {
              authored: "as-is",
              nested: { keep: ["content"] },
            },
          },
        },
      })}\n`,
    );

    const result = resolveDocument(root, config);
    const binding = result.bindings.agents.inline;
    if (!binding) throw new Error("inline binding missing");
    expect(binding.input).toEqual({
      choice: {
        authored: "as-is",
        nested: { keep: ["content"] },
      },
    });
    expect(originPath(binding.provenance, "/choice/authored")).toBe(
      "atlante.jsonc",
    );
    expect(originPath(binding.provenance, "/choice/nested/keep/0")).toBe(
      "atlante.jsonc",
    );
  });

  test("resolves local template composition from the facet file and loads only transitive facets", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "outer", {
      type: "object",
      properties: { detail: { template: "../inner" } },
    });
    writeTemplate(root, "inner");
    const unrelated = join(root, "unrelated");
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, "template.jsonc"), "{ not JSONC");
    writeFileSync(join(unrelated, "template.md"), "unrelated");
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          composed: {
            $template: "./outer",
            description: "Composed",
            detail: { value: "nested" },
          },
        },
      })}\n`,
    );

    const result = resolveDocument(root, config);
    expect(
      result.templates.map((template) => template.origin.path as string),
    ).toEqual(["inner/template.jsonc", "outer/template.jsonc"]);
    expect(result.dependencies.some((path) => path.includes("unrelated"))).toBe(
      false,
    );
  });

  test("resolves inherited selectors from their authored preset while preserving overlay origins", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "base/agent-template");
    writeTemplate(root, "base/skill-template");
    writeInstance(root, "base/agent-instance", {
      $template: "../agent-template",
      instanceValue: "base instance",
    });
    writePreset(root, "base", {
      values: { base: "base", shared: "base" },
      agents: {
        inherited: {
          $instance: "./agent-instance",
          description: "Base agent",
          values: {
            bindingBase: "base",
            bindingShared: "base",
          },
          baseInput: "base",
        },
      },
      skills: {
        inherited: {
          $template: "./skill-template",
          description: "Base skill",
          baseInput: "base",
        },
      },
    });
    writePreset(root, "overlays/child", {
      extends: "../../base",
      values: { overlay: "overlay", shared: "overlay" },
      agents: {
        inherited: {
          description: "Overlay agent",
          values: {
            bindingOverlay: "overlay",
            bindingShared: "overlay",
          },
          overlayInput: "overlay",
        },
      },
      skills: {
        inherited: {
          overlayInput: "overlay",
        },
      },
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        extends: "./overlays/child",
        values: { root: "root", shared: "root" },
        agents: {
          inherited: {
            values: {
              bindingRoot: "root",
              bindingShared: "root",
            },
            rootInput: "root",
          },
        },
        skills: {
          inherited: {
            description: "Root skill",
            rootInput: "root",
          },
        },
      })}\n`,
    );

    const result = resolveDocument(root, config);
    const agent = result.bindings.agents.inherited;
    const skill = result.bindings.skills.inherited;
    if (!agent || !skill) throw new Error("inherited bindings missing");

    expect(agent.template.origin.path as string).toBe(
      "base/agent-template/template.jsonc",
    );
    expect(skill.template.origin.path as string).toBe(
      "base/skill-template/template.jsonc",
    );
    expect(agent.input).toEqual({
      baseInput: "base",
      instanceValue: "base instance",
      overlayInput: "overlay",
      rootInput: "root",
    });
    expect(agent.input).not.toHaveProperty("values");
    expect(agent.values).toEqual({
      bindingBase: "base",
      bindingOverlay: "overlay",
      bindingRoot: "root",
      bindingShared: "root",
    });
    expect(skill.input).toEqual({
      baseInput: "base",
      overlayInput: "overlay",
      rootInput: "root",
    });
    expect(result.normalized.values).toEqual({
      base: "base",
      overlay: "overlay",
      root: "root",
      shared: "root",
    });
    expect(originPath(result.provenance, "/values/base")).toBe(
      "base/atlante.jsonc",
    );
    expect(originPath(result.provenance, "/values/overlay")).toBe(
      "overlays/child/atlante.jsonc",
    );
    expect(originPath(result.provenance, "/values/root")).toBe("atlante.jsonc");
    expect(originPath(result.provenance, "/values/shared")).toBe(
      "atlante.jsonc",
    );
    expect(originPath(result.provenance, "/agents/inherited/description")).toBe(
      "overlays/child/atlante.jsonc",
    );
    expect(
      originPath(result.provenance, "/agents/inherited/values/bindingBase"),
    ).toBe("base/atlante.jsonc");
    expect(
      originPath(result.provenance, "/agents/inherited/values/bindingOverlay"),
    ).toBe("overlays/child/atlante.jsonc");
    expect(
      originPath(result.provenance, "/agents/inherited/values/bindingRoot"),
    ).toBe("atlante.jsonc");
    expect(
      originPath(result.provenance, "/agents/inherited/values/bindingShared"),
    ).toBe("atlante.jsonc");
    expect(originPath(result.provenance, "/skills/inherited/description")).toBe(
      "atlante.jsonc",
    );
    expect(originPath(agent.provenance, "/baseInput")).toBe(
      "base/atlante.jsonc",
    );
    expect(originPath(agent.provenance, "/instanceValue")).toBe(
      "base/agent-instance/instance.jsonc",
    );
    expect(originPath(agent.provenance, "/overlayInput")).toBe(
      "overlays/child/atlante.jsonc",
    );
    expect(originPath(agent.provenance, "/rootInput")).toBe("atlante.jsonc");
    expect(originPath(agent.provenance, "/values/bindingBase")).toBe(
      "base/atlante.jsonc",
    );
    expect(originPath(agent.provenance, "/values/bindingOverlay")).toBe(
      "overlays/child/atlante.jsonc",
    );
    expect(originPath(agent.provenance, "/values/bindingRoot")).toBe(
      "atlante.jsonc",
    );
    expect(originPath(agent.provenance, "/values/bindingShared")).toBe(
      "atlante.jsonc",
    );
  });

  test("resolves selectors from lexical facet paths instead of canonical origins", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "template");
    const canonicalInstance = writeInstance(root, "deep/a/b", {
      $template: "../../../template",
      value: "lexical escape",
    });
    symlinkSync(canonicalInstance, join(root, "alias"), "dir");

    const failure = expectFailure(
      () =>
        resolveResourceInstance({
          pack: createProjectResourcePack(root),
          locator: "./alias",
          authoringFile: config,
        }),
      "unsafe-path",
    );

    expect(failure.failure.source?.path as string).toBe(
      "deep/a/b/instance.jsonc",
    );
    expect(JSON.stringify(failure.failure)).not.toContain(root);
  });

  test("does not let resolution order erase lexical safety checks", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "template");
    const canonicalInstance = writeInstance(root, "deep/a/b", {
      $template: "../../../template",
      value: "lexical safety",
    });
    symlinkSync(canonicalInstance, join(root, "alias"), "dir");

    const failures = [
      ["a-direct", "z-alias"],
      ["a-alias", "z-direct"],
    ] as const;
    const safetyFailures = failures.map(([first, second]) => {
      const source = {
        agents: {
          [first]: {
            $instance: first.endsWith("direct") ? "./deep/a/b" : "./alias",
            description: "First",
          },
          [second]: {
            $instance: second.endsWith("direct") ? "./deep/a/b" : "./alias",
            description: "Second",
          },
        },
      };
      writeFileSync(config, `${JSON.stringify(source)}\n`);
      return expectFailure(() => resolveDocument(root, config), "unsafe-path");
    });

    expect(safetyFailures.map(({ failure }) => failure.code)).toEqual([
      "unsafe-path",
      "unsafe-path",
    ]);
    expect(safetyFailures.map(({ failure }) => failure.locator)).toEqual([
      "../../../template",
      "../../../template",
    ]);
  });

  test("keeps each preset traversal context for inherited bindings", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "middle/middle-template");
    writePreset(root, "base", {});
    writePreset(root, "middle", {
      extends: "../base",
      agents: {
        inherited: {
          $template: "./middle-template",
          description: "Middle",
        },
      },
    });
    writeFileSync(config, `${JSON.stringify({ extends: "./middle" })}\n`);

    const result = resolveDocument(root, config);
    const nodeLabel = (key: string): string => {
      const node = result.graph.nodes.find(
        (candidate) => canonicalGraphKey(candidate) === key,
      );
      return node ? `${node.kind}:${node.origin.path as string}` : key;
    };
    const edges = result.graph.edges.map(({ from, to }) => [
      nodeLabel(from),
      nodeLabel(to),
    ]);

    expect(edges).toContainEqual([
      "preset:middle/atlante.jsonc",
      "template:middle/middle-template/template.jsonc",
    ]);
    expect(edges).not.toContainEqual([
      "preset:base/atlante.jsonc",
      "template:middle/middle-template/template.jsonc",
    ]);
  });

  test("counts mixed preset, instance, and template hops at the shared boundary", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "hop-template");

    for (const count of [32, 33]) {
      const instances = count === 32 ? 30 : 31;
      writePreset(root, `hop-preset-${count}`, {});
      for (let index = 0; index < instances; index++) {
        writeInstance(
          root,
          `hop-instance-${count}-${index}`,
          index === instances - 1
            ? { $template: "../hop-template" }
            : {
                $instance: `../hop-instance-${count}-${index + 1}`,
              },
        );
      }
      writeFileSync(
        config,
        `${JSON.stringify({
          extends: `./hop-preset-${count}`,
          agents: {
            mixed: {
              $instance: `./hop-instance-${count}-0`,
              description: "Mixed hop chain",
            },
          },
        })}\n`,
      );

      const action = () => resolveDocument(root, config);
      if (count === 32) {
        expect(action).not.toThrow();
      } else {
        const failure = expectFailure(action, "resource-depth-exceeded");
        expect(failure.failure.chain?.length).toBe(33);
      }
    }
  });

  test("does not let a cached shared tail bypass the depth boundary", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "template");
    writeInstance(root, "shared", { $template: "../template" });
    for (let index = 0; index < 31; index++) {
      writeInstance(root, `deep-${index}`, {
        $instance: index === 30 ? "../shared" : `../deep-${index + 1}`,
      });
    }

    const failures = [
      ["a-shallow", "z-deep"],
      ["a-deep", "z-shallow"],
    ] as const;
    const depthFailures = failures.map(([first, second]) => {
      const source = {
        agents: {
          [first]: {
            $instance: first.endsWith("shallow") ? "./shared" : "./deep-0",
            description: "First",
          },
          [second]: {
            $instance: second.endsWith("shallow") ? "./shared" : "./deep-0",
            description: "Second",
          },
        },
      };
      writeFileSync(config, `${JSON.stringify(source)}\n`);
      return expectFailure(
        () => resolveDocument(root, config),
        "resource-depth-exceeded",
      );
    });

    expect(depthFailures.map(({ failure }) => failure.code)).toEqual([
      "resource-depth-exceeded",
      "resource-depth-exceeded",
    ]);
    expect(depthFailures.map(({ failure }) => failure.chain?.length)).toEqual([
      34, 34,
    ]);
  });

  test("keeps invalid sibling failure chains independent of binding order", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "valid-template");
    writeInstance(root, "valid-instance", {
      $template: "../valid-template",
      value: "valid",
    });

    const failures = [
      ["a-valid", "z-invalid"],
      ["z-valid", "a-invalid"],
    ] as const;
    for (const [validId, invalidId] of failures) {
      writeFileSync(
        config,
        `${JSON.stringify({
          agents: {
            [validId]: {
              $instance: "./valid-instance",
              description: "Valid",
            },
            [invalidId]: true,
          },
        })}\n`,
      );
      const failure = expectFailure(
        () => resolveDocument(root, config),
        "invalid-resolved-input",
      );

      expect(
        failure.failure.chain?.map(({ origin }) => origin.path as string),
      ).toEqual(["atlante.jsonc"]);
    }
  });

  test("threads nested instance and template traversal through graph edges", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "outer", {
      type: "object",
      properties: { child: { template: "../child" } },
    });
    writeTemplate(root, "child", {
      type: "object",
      properties: { grandchild: { template: "../grandchild" } },
    });
    writeTemplate(root, "grandchild");
    writeInstance(root, "child-instance", {
      $template: "../child",
      grandchild: { $instance: "../grandchild-instance" },
    });
    writeInstance(root, "grandchild-instance", {
      $template: "../grandchild",
      value: "nested",
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          nested: {
            $template: "./outer",
            description: "Nested",
            child: { $instance: "./child-instance" },
          },
        },
      })}\n`,
    );

    const result = resolveDocument(root, config);
    expect(result.bindings.agents.nested?.input).toEqual({
      child: { grandchild: { value: "nested" } },
    });

    const nodeLabel = (key: string): string => {
      const node = result.graph.nodes.find(
        (candidate) => canonicalGraphKey(candidate) === key,
      );
      return node ? `${node.kind}:${node.origin.path as string}` : key;
    };
    const edges = result.graph.edges.map(({ from, to }) => [
      nodeLabel(from),
      nodeLabel(to),
    ]);
    expect(edges).toContainEqual([
      "template:outer/template.jsonc",
      "instance:child-instance/instance.jsonc",
    ]);
    expect(edges).toContainEqual([
      "instance:child-instance/instance.jsonc",
      "template:child/template.jsonc",
    ]);
    expect(edges).toContainEqual([
      "template:child/template.jsonc",
      "instance:grandchild-instance/instance.jsonc",
    ]);
    expect(edges).toContainEqual([
      "instance:grandchild-instance/instance.jsonc",
      "template:grandchild/template.jsonc",
    ]);
  });

  test("reports the actual nested chain for incompatible configured instances", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "outer", {
      type: "object",
      properties: { child: { template: "../child" } },
    });
    writeTemplate(root, "child", {
      type: "object",
      properties: { grandchild: { template: "../grandchild" } },
    });
    writeTemplate(root, "grandchild");
    writeTemplate(root, "wrong-grandchild");
    writeInstance(root, "child-instance", {
      $template: "../child",
      grandchild: { $instance: "../grandchild-instance" },
    });
    writeInstance(root, "grandchild-instance", {
      $template: "../wrong-grandchild",
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          nested: {
            $template: "./outer",
            description: "Nested",
            child: { $instance: "./child-instance" },
          },
        },
      })}\n`,
    );

    const failure = expectFailure(
      () => resolveDocument(root, config),
      "incompatible-template",
    );
    expect(
      failure.failure.chain?.map(({ origin }) => origin.path as string),
    ).toEqual([
      "atlante.jsonc",
      "outer/template.jsonc",
      "child-instance/instance.jsonc",
      "child/template.jsonc",
      "grandchild-instance/instance.jsonc",
      "wrong-grandchild/template.jsonc",
    ]);
    expect(failure.failure.pointer).toBe(
      "/agents/nested/child/$instance/grandchild",
    );
  });

  test("enters inline child templates before nested compatibility checks", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "outer", {
      type: "object",
      properties: { child: { template: "../child" } },
    });
    writeTemplate(root, "child", {
      type: "object",
      properties: { grandchild: { template: "../grandchild" } },
    });
    writeTemplate(root, "grandchild");
    writeTemplate(root, "wrong-template");
    writeInstance(root, "wrong-instance", {
      $template: "../wrong-template",
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          nested: {
            $template: "./outer",
            description: "Nested",
            child: {
              grandchild: { $instance: "./wrong-instance" },
            },
          },
        },
      })}\n`,
    );

    const failure = expectFailure(
      () => resolveDocument(root, config),
      "incompatible-template",
    );
    expect(
      failure.failure.chain?.map(({ origin }) => origin.path as string),
    ).toEqual([
      "atlante.jsonc",
      "outer/template.jsonc",
      "child/template.jsonc",
      "wrong-instance/instance.jsonc",
      "wrong-template/template.jsonc",
    ]);
  });

  test("preserves delegated selector pointers and facet failures", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "outer", {
      type: "object",
      properties: { child: { template: "../child" } },
    });
    writeTemplate(root, "child");
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          malformed: {
            $template: "./outer",
            description: "Malformed",
            child: { $template: "not-a-locator" },
          },
        },
      })}\n`,
    );
    const selectorFailure = expectFailure(
      () => resolveDocument(root, config),
      "invalid-locator",
    );
    expect(selectorFailure.failure.source?.path as string).toBe(
      "atlante.jsonc",
    );
    expect(selectorFailure.failure.pointer).toBe(
      "/agents/malformed/child/$template",
    );
    expect(
      selectorFailure.failure.chain?.map(({ origin }) => origin.path as string),
    ).toEqual(["atlante.jsonc", "outer/template.jsonc"]);

    writeInstance(root, "nonregular", { value: true });
    mkdirSync(join(root, "nonregular", "template.jsonc"));
    const nonregularFailure = expectFailure(
      () =>
        resolveResourceInstance({
          pack: createProjectResourcePack(root),
          locator: "./nonregular",
          authoringFile: config,
        }),
      "wrong-target-type",
    );
    expect(
      nonregularFailure.failure.chain?.map(
        ({ origin }) => origin.path as string,
      ),
    ).toEqual(["nonregular/instance.jsonc"]);

    writeInstance(root, "incomplete", { value: true });
    writeFileSync(
      join(root, "incomplete", "template.jsonc"),
      JSON.stringify({ $schema: schemaUri, type: "object" }),
    );
    expectFailure(
      () =>
        resolveResourceInstance({
          pack: createProjectResourcePack(root),
          locator: "./incomplete",
          authoringFile: config,
        }),
      "missing-target",
    );

    writeTemplate(root, "broken-parent", {
      type: "object",
      properties: { broken: { template: "../broken-child" } },
    });
    const brokenChild = join(root, "broken-child");
    mkdirSync(brokenChild);
    writeFileSync(join(brokenChild, "template.jsonc"), "{ not JSONC");
    writeFileSync(join(brokenChild, "template.md"), "broken\n");
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          broken: {
            $template: "./broken-parent",
            description: "Broken",
          },
        },
      })}\n`,
    );
    const facetFailure = expectFailure(
      () => resolveDocument(root, config),
      "malformed-jsonc",
    );
    expect(facetFailure.failure.source?.path as string).toBe(
      "broken-child/template.jsonc",
    );
    expect(
      facetFailure.failure.chain?.map(({ origin }) => origin.path as string),
    ).toEqual([
      "atlante.jsonc",
      "broken-parent/template.jsonc",
      "broken-child/template.jsonc",
    ]);
  });

  test("replaces root array composition values while resolving inline and configured items", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "outer", {
      type: "object",
      properties: { children: { template: "../array" } },
    });
    writeTemplate(root, "array", {
      type: "array",
      items: { template: "../child" },
    });
    writeTemplate(root, "child", {
      type: "object",
      properties: { label: { type: "string" } },
    });
    writeInstance(root, "configured-child", {
      $template: "../child",
      label: "configured",
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          array: {
            $template: "./outer",
            description: "Array",
            children: [
              { label: "inline" },
              { $instance: "./configured-child" },
            ],
          },
        },
      })}\n`,
    );

    const result = resolveDocument(root, config);
    expect(result.bindings.agents.array?.input).toEqual({
      children: [{ label: "inline" }, { label: "configured" }],
    });
    expect(
      result.bindings.agents.array?.provenance["/children/0/label"]
        ?.path as string,
    ).toBe("atlante.jsonc");
    expect(
      result.bindings.agents.array?.provenance["/children/1/label"]
        ?.path as string,
    ).toBe("configured-child/instance.jsonc");
  });

  test("returns deterministic isolated normalized data on repeated resolution", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "template");
    writeFileSync(
      config,
      `${JSON.stringify({
        agents: {
          stable: {
            $template: "./template",
            description: "Stable",
            value: "one",
          },
        },
      })}\n`,
    );

    const first = resolveDocument(root, config);
    const second = resolveDocument(root, config);
    expect(JSON.stringify(first.normalized)).toBe(
      JSON.stringify(second.normalized),
    );
    expect(JSON.stringify(first.provenance)).toBe(
      JSON.stringify(second.provenance),
    );
    expect(first.normalized).not.toBe(second.normalized);
    (first.normalized.agents.stable as Record<string, unknown>).value =
      "changed";
    expect(second.normalized.agents.stable?.value).toBe("one");
  });

  test("rejects an invalid base instance value before a valid derived override masks it", () => {
    const { root, config } = rootOf();
    writeTemplate(root, "agent", {
      type: "object",
      properties: { identity: { type: "string" } },
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

    const failure = expectFailure(
      () =>
        resolveResourceInstance({
          pack: createProjectResourcePack(root),
          locator: "./derived",
          authoringFile: config,
        }),
      "invalid-resolved-input",
    );

    expect(failure.failure.source?.path as string).toBe("base/instance.jsonc");
    expect(failure.failure.pointer).toContain("/values/count");
    expect(failure.failure.location).toEqual({ line: 1, column: 43 });
  });

  test("keeps binding value tombstones separate from canonical values", () => {
    const { root, config } = rootOf();
    writePreset(root, "base", {
      values: { project: "global" },
      agents: {
        reviewer: {
          values: { project: "base" },
          description: "Review",
          identity: "Identity",
          mission: "Mission",
        },
      },
      skills: {
        testing: {
          values: { project: "base" },
          description: "Testing",
          title: "Testing",
          overview: "Overview",
          sections: [],
        },
      },
    });
    writeFileSync(
      config,
      `${JSON.stringify({
        extends: "./base",
        values: { project: "global" },
        agents: { reviewer: { values: { project: null } } },
        skills: { testing: { values: { project: null } } },
      })}\n`,
    );

    const result = resolveDocument(root, config);
    const agent = result.bindings.agents.reviewer;
    const skill = result.bindings.skills.testing;
    if (!agent || !skill) throw new Error("tombstoned bindings missing");

    expect(agent.values).toEqual({});
    expect(skill.values).toEqual({});
    expect(JSON.stringify(agent.values)).not.toContain("null");
    expect(JSON.stringify(skill.values)).not.toContain("null");
    expect(JSON.stringify(result.normalized)).not.toContain('"project":null');
  });
});
