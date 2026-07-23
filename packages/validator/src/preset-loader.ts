import { listPresets, presetName, readPreset } from "@atlante/presets";
import { error } from "./diagnostic.ts";
import { parseDocumentOverlay } from "./document.ts";
import type { PresetLoader } from "./expand.ts";

/** Creates a PresetLoader backed by the bundled @atlante/presets. */
export function createBundledPresetLoader(): PresetLoader {
  return {
    load(id: string) {
      const { presets, errors } = listPresets();
      const manifest = presets.find((m) => m.id === id);
      if (!manifest) {
        const known = presets.map((m) => m.id).join(", ");
        const diags = errors.map((e) =>
          error("preset-load-error", `${e.directory}: ${e.message}`),
        );
        return {
          document: undefined,
          diagnostics: [
            error(
              "unknown-preset",
              `preset "${id}" not found${known ? `; available: ${known}` : ""}`,
            ),
            ...diags,
          ],
        };
      }

      const name = presetName(manifest);
      const source = readPreset(name);
      if (!source) {
        return {
          document: undefined,
          diagnostics: [
            error(
              "preset-load-error",
              `preset "${id}": manifest found but document is missing or unreadable`,
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
