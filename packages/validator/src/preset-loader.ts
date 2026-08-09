import { join } from "node:path";
import {
  BUNDLED_RESOURCE_PACK,
  loadPresetFacet,
  ResourceResolutionError,
} from "@atlante/resources";
import { error } from "./diagnostic.js";
import { parseDocumentOverlay } from "./document.js";
import type { PresetLoader } from "./expand.js";

/** Transitional adapter for CLI callers that still use generic expansion. */
export function createBundledPresetLoader(): PresetLoader {
  return {
    load(id: string) {
      try {
        const loaded = loadPresetFacet(
          BUNDLED_RESOURCE_PACK,
          id,
          join(BUNDLED_RESOURCE_PACK.root, "atlante.jsonc"),
        );
        const parsed = parseDocumentOverlay(
          JSON.stringify(loaded.facet.document),
          String(loaded.facet.origin.path),
        );
        return { document: parsed.overlay, diagnostics: parsed.diagnostics };
      } catch (cause) {
        if (cause instanceof ResourceResolutionError) {
          return {
            document: undefined,
            diagnostics: [
              error(cause.failure.code, cause.failure.message, {
                source: String(cause.failure.source?.path ?? id),
                ...(cause.failure.pointer
                  ? {
                      path: cause.failure.pointer,
                      pointer: cause.failure.pointer,
                    }
                  : {}),
              }),
            ],
          };
        }
        return {
          document: undefined,
          diagnostics: [
            error("preset-load-error", `preset "${id}" could not be loaded`, {
              source: id,
            }),
          ],
        };
      }
    },
  };
}

/** Checks whether an overlay document uses `extends`. */
export function hasAnyExtends(overlay: { extends?: string }): boolean {
  return !!overlay.extends;
}
