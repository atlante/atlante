import { listPresets, presetName, readPreset } from "@atlante/presets";
import type { AtlanteDocument } from "@atlante/schema";
import {
  loadBundledTemplates,
  type TemplateRegistry,
} from "@atlante/templates";
import type { PresetLoader } from "@atlante/validator";
import {
  type Diagnostic,
  error,
  expandDocument,
  findConfigFile,
  loadDocument,
  parseDocumentOverlay,
  templateLoadDiagnostics,
} from "@atlante/validator";

export type LoadedCliResources = {
  document?: AtlanteDocument;
  path?: string;
  registry?: TemplateRegistry;
  diagnostics: Diagnostic[];
};

/**
 * Creates a PresetLoader backed by the bundled @atlante/presets.
 * Enforces that the requested preset ID matches the manifest ID.
 */
function createBundledPresetLoader(): PresetLoader {
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

/**
 * Checks whether an overlay document uses `extends`, which requires the expansion path.
 */
function hasAnyExtends(overlay: { extends?: string }): boolean {
  return !!overlay.extends;
}

/**
 * Loads the user document, expands preset inheritance, and loads bundled
 * templates. Returns a canonical document ready for validation or resolution.
 */
export function loadCliResources(target: string): LoadedCliResources {
  const config = findConfigFile(target);
  if (!config) {
    return loadDocument(target);
  }

  // Parse as overlay first — this accepts extends and tombstone nulls.
  const parsed = parseDocumentOverlay(config.text, config.path);
  if (!parsed.overlay) {
    return { path: config.path, diagnostics: parsed.diagnostics };
  }

  // Load bundled templates.
  const { registry, errors } = loadBundledTemplates();
  if (errors.length > 0) {
    return {
      path: config.path,
      diagnostics: templateLoadDiagnostics(errors),
    };
  }

  // If the document has no extends anywhere, use the canonical path.
  if (!hasAnyExtends(parsed.overlay)) {
    const loaded = loadDocument(target);
    if (!loaded.document) {
      return { path: config.path, registry, diagnostics: loaded.diagnostics };
    }
    return {
      document: loaded.document,
      path: config.path,
      registry,
      diagnostics: [],
    };
  }

  const presetLoader = createBundledPresetLoader();
  const expanded = expandDocument(parsed.overlay, presetLoader);
  return {
    document: expanded.document,
    path: config.path,
    registry,
    diagnostics: expanded.diagnostics,
  };
}
