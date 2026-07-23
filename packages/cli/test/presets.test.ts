import { describe, expect, test } from "bun:test";
import { listPresets, presetName, readPreset } from "@atlante/presets";
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
});
