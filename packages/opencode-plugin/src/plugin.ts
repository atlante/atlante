import { resolve } from "@atlante/resolver";
import type { AtlanteDocument } from "@atlante/schema";
import { loadBundledTemplates } from "@atlante/templates";
import type { Diagnostic } from "@atlante/validator";
import {
  createBundledPresetLoader,
  error,
  expandDocument,
  findConfigFile,
  formatDiagnostic,
  hasAnyExtends,
  hasErrors,
  loadDocument,
  parseDocumentOverlay,
  templateLoadDiagnostics,
} from "@atlante/validator";
import type { Plugin } from "@opencode-ai/plugin";
import type { HostConfig } from "./inject.js";
import { injectAgents } from "./inject.js";

function report(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.error(`[atlante] ${formatDiagnostic(diagnostic)}`);
  }
}

export type AtlantePluginDeps = {
  loadDocument: typeof loadDocument;
  loadBundledTemplates: typeof loadBundledTemplates;
  resolve?: typeof resolve;
  expandDocument?: typeof expandDocument;
  injectAgents?: typeof injectAgents;
};

const defaultDeps: AtlantePluginDeps = {
  loadDocument,
  loadBundledTemplates,
  resolve,
  expandDocument,
  injectAgents,
};

/**
 * Materialization is runtime injection: the resolved prompts are written into
 * the in-memory OpenCode config and nothing is generated on disk.
 *
 * Failure behavior is fail-closed on the Atlante side and fail-open on the host
 * side. A broken atlante.jsonc must not prevent OpenCode from starting, and a
 * partially injected set of prompts would be worse than none at all.
 */
export function createAtlantePlugin(
  deps: AtlantePluginDeps = defaultDeps,
): Plugin {
  return async ({ directory }) => ({
    config: async (config) => {
      try {
        const file = findConfigFile(directory);

        // No configuration at all is not an error: Atlante simply does not apply.
        if (!file) {
          const loaded = deps.loadDocument(directory);
          if (loaded.diagnostics.some((d) => d.code === "config-not-found")) {
            return;
          }
          return report(loaded.diagnostics);
        }

        const parsed = parseDocumentOverlay(file.text, file.path);
        if (!parsed.overlay) return report(parsed.diagnostics);

        const { registry, errors } = deps.loadBundledTemplates();
        if (errors.length > 0) return report(templateLoadDiagnostics(errors));

        let resolvedDocument: AtlanteDocument;

        if (hasAnyExtends(parsed.overlay)) {
          const presetLoader = createBundledPresetLoader();
          const expanded = (deps.expandDocument ?? expandDocument)(
            parsed.overlay,
            presetLoader,
          );
          if (!expanded.document) return report(expanded.diagnostics);
          resolvedDocument = expanded.document;
        } else {
          const loaded = deps.loadDocument(directory);
          if (!loaded.document) return report(loaded.diagnostics);
          resolvedDocument = loaded.document;
        }

        const resolved = (deps.resolve ?? resolve)(resolvedDocument, registry);
        if (hasErrors(resolved.diagnostics))
          return report(resolved.diagnostics);

        const staged = structuredClone(config) as unknown as HostConfig;
        const warnings = (deps.injectAgents ?? injectAgents)(
          staged,
          resolved.agents,
        );
        Object.assign(config, staged);
        report([...resolved.diagnostics, ...warnings]);
      } catch (cause) {
        report([
          error(
            "plugin-runtime-failed",
            `plugin runtime failed: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          ),
        ]);
      }
    },
  });
}

export const AtlantePlugin: Plugin = createAtlantePlugin();
