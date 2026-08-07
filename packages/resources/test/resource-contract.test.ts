import { describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import packageJson from "../package.json" with { type: "json" };
import type {
  AuthoredResourceLocator,
  BundledResourceOrigin,
  InstanceFacet,
  Preset,
  PresetResourceGraphNode,
  ProjectResourceOrigin,
  RawBundledResourceOrigin,
  RawProjectResourceOrigin,
  RawResourceLocator,
  RawResourceOrigin,
  ResourceFailure,
  ResourceGraphChain,
  ResourceGraphFailure,
  ResourceGraphNode,
  ResourceLocator,
  ResourceOrigin,
  TemplateFacet,
  ValidatedResourceLocator,
} from "../src/index.js";

const sourceRoot = new URL("../src/", import.meta.url);
const sourceRootPath = fileURLToPath(sourceRoot);

function sourceFiles(root: URL): URL[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(
      `${entry.name}${entry.isDirectory() ? "/" : ""}`,
      root,
    );

    if (entry.isDirectory()) {
      return sourceFiles(entryUrl);
    }

    return entry.isFile() && entry.name.endsWith(".ts") ? [entryUrl] : [];
  });
}

function sourceText(): string {
  return sourceFiles(sourceRoot)
    .map((fileUrl) => readFileSync(fileUrl, "utf8"))
    .join("\n");
}

const forbiddenImport =
  /(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)["']@atlante\/(?:schema|validator|builder|presets|templates)(?:["'/])/;

function trusted<T>(value: unknown): T {
  return value as T;
}

function compileTimeLocatorContracts(): void {
  // Trusted locators are branded and can only come from a later validation
  // constructor. Raw authored values remain ordinary strings at this seam.
  const trustedLocator = undefined as unknown as ValidatedResourceLocator;
  const trustedLocators = [trustedLocator] satisfies ResourceLocator[];
  void trustedLocators;

  const rawEmptyBuiltin: RawResourceLocator = "atlante/";
  const rawNestedBuiltin: RawResourceLocator = "atlante/group/child";
  const rawFacetFile: RawResourceLocator = "./resources/agent/template.md";
  const rawMalformed: RawResourceLocator = "resources/agent";
  const rawAbsolute: RawResourceLocator = "/tmp/agent";
  // @ts-expect-error Raw authored values are not validated identities.
  const emptyBuiltin: ResourceLocator = rawEmptyBuiltin;
  // @ts-expect-error Raw authored values are not validated identities.
  const nestedBuiltin: ResourceLocator = rawNestedBuiltin;
  // @ts-expect-error Raw authored values are not validated identities.
  const facetFile: ResourceLocator = rawFacetFile;
  // @ts-expect-error Raw authored values are not validated identities.
  const malformed: ResourceLocator = rawMalformed;
  // @ts-expect-error Raw authored values are not validated identities.
  const absolute: ResourceLocator = rawAbsolute;
  void emptyBuiltin;
  void nestedBuiltin;
  void facetFile;
  void malformed;
  void absolute;
}

function compileTimeOriginContracts(): void {
  const rawTraversal: RawProjectResourceOrigin = {
    kind: "project",
    path: "../outside",
  };
  const rawAbsolute: RawProjectResourceOrigin = {
    kind: "project",
    path: "/absolute",
  };
  const rawEmptyBuiltin: RawBundledResourceOrigin = {
    kind: "bundled",
    path: "atlante/",
  };
  // @ts-expect-error Raw authored origins are not validated identities.
  const traversal: ProjectResourceOrigin = rawTraversal;
  // @ts-expect-error Raw authored origins are not validated identities.
  const absolute: ProjectResourceOrigin = rawAbsolute;
  // @ts-expect-error Raw authored origins are not validated identities.
  const emptyBuiltin: BundledResourceOrigin = rawEmptyBuiltin;
  void traversal;
  void absolute;
  void emptyBuiltin;
}

function compileTimeFailureContracts(): void {
  // @ts-expect-error Graph failures must retain their complete typed chain.
  const incomplete: ResourceFailure = {
    code: "resource-cycle",
    message: "resource graph contains a cycle",
  };
  void incomplete;
}

void compileTimeLocatorContracts;
void compileTimeOriginContracts;
void compileTimeFailureContracts;

describe("resource contract", () => {
  test("exposes typed locator, facet, origin, preset, and failure forms", () => {
    const origin = trusted<ResourceOrigin>({
      kind: "project",
      path: "resources/agent/template.jsonc",
    });
    const template: TemplateFacet = {
      kind: "template",
      locator: trusted<ResourceLocator>("./resources/agent"),
      origin,
      inputSchema: { type: "object" },
      source: "# Agent",
    };
    const instance: InstanceFacet = {
      kind: "instance",
      locator: trusted<ResourceLocator>("atlante/architect"),
      origin: trusted<ResourceOrigin>({
        kind: "bundled",
        path: "atlante/architect/instance.jsonc",
      }),
      input: { identity: "You are an architect." },
    };
    const preset: Preset = {
      kind: "preset",
      locator: trusted<ResourceLocator>("atlante/starter"),
      origin: trusted<ResourceOrigin>({
        kind: "bundled",
        path: "atlante/starter/atlante.jsonc",
      }),
      document: { extends: "atlante/starter" },
    };
    const failure: ResourceFailure = {
      code: "unsafe-path",
      message: "resource locator escapes its trusted root",
      locator: "../outside",
      source: origin,
      pointer: "/agents/reviewer/$instance",
      location: { line: 3, column: 5 },
    };

    expect(template.kind).toBe("template");
    expect(instance.kind).toBe("instance");
    expect(preset.kind).toBe("preset");
    expect(failure.source).toEqual(origin);
  });

  test("keeps authored locators distinct from trusted locators", () => {
    const locators = [
      "./resources/agent",
      "../shared/agent",
      "atlante/agent",
      "atlante/starter",
    ] satisfies RawResourceLocator[];
    const authored: AuthoredResourceLocator = "atlante/";

    expect(locators).toEqual([
      "./resources/agent",
      "../shared/agent",
      "atlante/agent",
      "atlante/starter",
    ]);
    expect(authored).toBe("atlante/");
  });

  test("requires complete typed graph chains for graph failures", () => {
    const presetNode: PresetResourceGraphNode = {
      kind: "preset",
      locator: trusted<ResourceLocator>("atlante/starter"),
      origin: trusted<ResourceOrigin>({
        kind: "bundled",
        path: "atlante/starter/atlante.jsonc",
      }),
    };
    const chain = [
      presetNode,
      {
        kind: "instance",
        locator: trusted<ResourceLocator>("./resources/agent"),
        origin: trusted<ResourceOrigin>({
          kind: "project",
          path: "resources/agent/instance.jsonc",
        }),
      },
      {
        kind: "template",
        locator: trusted<ResourceLocator>("./resources/agent"),
        origin: trusted<ResourceOrigin>({
          kind: "project",
          path: "resources/agent/template.jsonc",
        }),
      },
    ] satisfies ResourceGraphChain;
    const cycle: ResourceGraphFailure = {
      code: "resource-cycle",
      message: "resource graph contains a cycle",
      chain,
    };
    const nodes: readonly ResourceGraphNode[] = cycle.chain;

    expect(nodes.map((node) => node.kind)).toEqual([
      "preset",
      "instance",
      "template",
    ]);
    expect(cycle.chain).toHaveLength(3);
  });
});

describe("resources package boundary", () => {
  test("scans nested source files and catches every forbidden import form", () => {
    const temporaryRoot = mkdtempSync(join(sourceRootPath, ".boundary-"));
    const nestedRoot = join(temporaryRoot, "nested");
    const nestedSource = [
      'import { schema } from "@atlante/schema";',
      'import type { Validator } from "@atlante/validator";',
      'void import("@atlante/builder");',
      'import "@atlante/presets";',
      'require("@atlante/schema");',
    ].join("\n");

    mkdirSync(nestedRoot);
    writeFileSync(join(nestedRoot, "forbidden.ts"), nestedSource);

    try {
      const source = sourceText();

      expect(source).toContain(nestedSource);
      for (const importStatement of nestedSource.split("\n")) {
        expect(importStatement).toMatch(forbiddenImport);
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("has no dependency on validator, builder, or old registries", () => {
    expect(packageJson.name).toBe("@atlante/resources");
    expect(packageJson.private).toBe(true);
    expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
      "handlebars",
      "jsonc-parser",
    ]);
    expect(Object.hasOwn(packageJson, "publishConfig")).toBe(false);
    expect(packageJson.dependencies).not.toHaveProperty("@atlante/builder");
    expect(packageJson.dependencies).not.toHaveProperty("@atlante/presets");
    expect(packageJson.dependencies).not.toHaveProperty("@atlante/templates");
    expect(packageJson.dependencies).not.toHaveProperty("@atlante/validator");
  });

  test("does not expose the forbidden legacy module vocabulary", () => {
    const source = sourceText();

    expect(source).not.toContain("module.jsonc");
    expect(source).not.toMatch(/\$module\b/);
    expect(source).not.toMatch(/\bmodule\b/);
  });

  test("keeps forbidden Atlante imports out of resource source", () => {
    const source = sourceText();

    expect(source).not.toMatch(forbiddenImport);
  });

  test("keeps raw origins separate from validated origins", () => {
    const rawOrigin: RawResourceOrigin = {
      kind: "project",
      path: "../outside",
    };
    const rawBundledOrigin: RawResourceOrigin = {
      kind: "bundled",
      path: "atlante/",
    };

    expect(rawOrigin.path).toBe("../outside");
    expect(rawBundledOrigin.path).toBe("atlante/");
  });
});
