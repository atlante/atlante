import { listPresets, readPreset } from "@atlante/presets";
import { error } from "./diagnostic.js";
import { parseDocumentOverlay } from "./document.js";
import type { PresetLoader } from "./expand.js";

/** Creates a PresetLoader backed by the bundled @atlante/presets. */
export function createBundledPresetLoader(): PresetLoader {
  return {
    load(id: string) {
      const { presets, errors } = listPresets();
      if (!presets.includes(id)) {
        const diags = errors.map((e) =>
          error("preset-load-error", `${e.directory}: ${e.message}`),
        );
        return {
          document: undefined,
          diagnostics: diags,
        };
      }

      const source = readPreset(id);
      if (!source) {
        return {
          document: undefined,
          diagnostics: [
            error(
              "preset-load-error",
              `preset "${id}": document is missing or unreadable`,
            ),
          ],
        };
      }

      const { overlay, diagnostics } = parseDocumentOverlay(
        source,
        `preset:${id}`,
      );
      return { document: overlay, diagnostics };
    },
  };
}

/** Checks whether an overlay document uses `extends`, which requires the expansion path. */
export function hasAnyExtends(overlay: { extends?: string }): boolean {
  return !!overlay.extends;
}
