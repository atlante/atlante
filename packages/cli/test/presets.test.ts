import { describe, expect, test } from "bun:test";
import { listPresets, readPreset } from "@atlante/presets";
import { validateDocumentText } from "@atlante/validator";

describe("bundled presets as user configurations", () => {
  test("every preset validates against the same schema as a user config", () => {
    for (const id of listPresets().presets) {
      const source = readPreset(id);
      if (!source) throw new Error(`preset ${id} missing`);
      const { document, diagnostics } = validateDocumentText(
        source,
        `${id}/atlante.jsonc`,
      );
      expect(diagnostics).toEqual([]);
      expect(document).toBeDefined();
    }
  });
});
