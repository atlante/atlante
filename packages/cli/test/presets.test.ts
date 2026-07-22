import { describe, expect, test } from "bun:test";
import { listPresets, presetName, readPreset } from "@atlante/presets";
import { resolve as resolveHarness } from "@atlante/resolver";
import { loadBundledTemplates } from "@atlante/templates";
import { validateDocumentText } from "@atlante/validator";

describe("bundled presets as user configurations", () => {
  test("every preset validates against the same schema as a user config", () => {
    for (const manifest of listPresets().presets) {
      const name = presetName(manifest);
      const source = readPreset(name);
      if (!source) throw new Error(`preset ${name} missing`);
      const { document, diagnostics } = validateDocumentText(
        source,
        `${name}/atlante.jsonc`,
      );
      expect(diagnostics).toEqual([]);
      expect(document).toBeDefined();
    }
  });

  test("code-review resolves to a rendered prompt with a workflow", () => {
    const source = readPreset("code-review");
    if (!source) throw new Error("preset missing");
    const { document } = validateDocumentText(source, "x");
    if (!document) throw new Error("expected a document");
    const { registry } = loadBundledTemplates();
    const { agents, diagnostics } = resolveHarness(document, registry);
    expect(diagnostics).toEqual([]);
    expect(agents[0]?.prompt).toContain("# Workflow");
    expect(agents[0]?.prompt).toContain("my-project");
  });
});
