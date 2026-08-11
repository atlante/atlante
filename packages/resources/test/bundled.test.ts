import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  BUNDLED_RESOURCE_PACK,
  BUNDLED_RESOURCES_DIR,
  interpolateValues,
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
  renderResolvedTemplate,
  resolveResourceDocument,
  resolveResourceInstance,
  resolveResourceTemplate,
} from "../src/index.js";

const bundledRootFile = join(BUNDLED_RESOURCE_PACK.root, "atlante.jsonc");

describe("bundled resources", () => {
  test("loads only selected bundled facets through the resource pack", () => {
    const template = loadTemplateFacet(
      BUNDLED_RESOURCE_PACK,
      "atlante/agent",
      bundledRootFile,
    );
    const instance = loadInstanceFacet(
      BUNDLED_RESOURCE_PACK,
      "atlante/architect",
      bundledRootFile,
    );
    const preset = loadPresetFacet(
      BUNDLED_RESOURCE_PACK,
      "atlante/starter",
      bundledRootFile,
    );

    expect({
      kind: template.facet.origin.kind,
      path: String(template.facet.origin.path),
    }).toEqual({
      kind: "bundled",
      path: "atlante/agent/template.jsonc",
    });
    expect({
      kind: instance.facet.origin.kind,
      path: String(instance.facet.origin.path),
    }).toEqual({
      kind: "bundled",
      path: "atlante/architect/instance.jsonc",
    });
    expect({
      kind: preset.facet.origin.kind,
      path: String(preset.facet.origin.path),
    }).toEqual({
      kind: "bundled",
      path: "atlante/starter/atlante.jsonc",
    });
    expect(preset.facet.document.agents).toHaveProperty("architect");
  });

  test("resolves bundled starter, template, and instance facets", () => {
    const document = resolveResourceDocument({
      pack: BUNDLED_RESOURCE_PACK,
      rootFile: bundledRootFile,
    });
    const instance = resolveResourceInstance(
      BUNDLED_RESOURCE_PACK,
      "atlante/architect",
      bundledRootFile,
    );
    const template = resolveResourceTemplate(
      BUNDLED_RESOURCE_PACK,
      "atlante/skill",
      bundledRootFile,
    );

    expect(Object.keys(document.bindings.agents)).toEqual(["architect"]);
    expect(Object.keys(document.bindings.skills)).toEqual([
      "brainstorming",
      "workflow",
    ]);
    expect(String(instance.effectiveTemplate.locator)).toBe("atlante/agent");
    expect(String(template.locator)).toBe("atlante/skill");
    expect(instance.input).toMatchObject({
      identity: "You are the lead engineer for {{values.project}}.",
    });
  });

  test("renders the bundled architect instance through its resolved graph", () => {
    const instance = resolveResourceInstance(
      BUNDLED_RESOURCE_PACK,
      "atlante/architect",
      bundledRootFile,
    );
    const output = renderResolvedTemplate({
      template: instance.effectiveTemplate,
      input: interpolateValues(instance.input, { project: "Atlante" }),
    });

    expect(output).toContain("# Responsibilities");
    expect(output).toContain("You are the lead engineer for Atlante.");
    expect(output).toContain("MUST preserve unrelated user changes.");
  });

  test("keeps the bundled root in one canonical resource directory", () => {
    expect(BUNDLED_RESOURCE_PACK.root).toBe(BUNDLED_RESOURCES_DIR);
    expect(BUNDLED_RESOURCE_PACK.kind).toBe("bundled");
  });
});
