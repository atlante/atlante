import { resolve } from "@atlante/resolver";
import { loadBundledTemplates } from "@atlante/templates";
import type { Diagnostic } from "@atlante/validator";
import {
  error,
  formatDiagnostic,
  hasErrors,
  loadDocument,
  templateLoadDiagnostics,
} from "@atlante/validator";
import type { Plugin } from "@opencode-ai/plugin";
import type { HostConfig } from "./inject.ts";
import { injectAgents } from "./inject.ts";

function report(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.error(`[atlante] ${formatDiagnostic(diagnostic)}`);
  }
}

export type AtlantePluginDeps = {
  loadDocument: typeof loadDocument;
  loadBundledTemplates: typeof loadBundledTemplates;
  resolve?: typeof resolve;
  injectAgents?: typeof injectAgents;
};

const defaultDeps: AtlantePluginDeps = {
  loadDocument,
  loadBundledTemplates,
  resolve,
  injectAgents,
};

/**
 * Materialization is runtime injection: the resolved prompts are written into
 * the in-memory OpenCode config and nothing is generated on disk.
 *
 * Failure behavior is fail-closed on the Atlante side and fail-open on the host
 * side. A broken atlante.jsonc must not prevent OpenCode from starting, and a
 * partially injected set of prompts would be worse than none at all.
 *
 * `deps` is a dependency-injection seam used only by tests, to exercise the
 * template-load-error path without mutating the real bundled templates on
 * disk or mocking a shared module (`bun test` runs every file in one process,
 * so a module mock in one file leaks into the next). Production code never
 * overrides it; `AtlantePlugin` below is the only instance OpenCode loads.
 */
export function createAtlantePlugin(
  deps: AtlantePluginDeps = defaultDeps,
): Plugin {
  return async ({ directory }) => ({
    config: async (config) => {
      try {
        const loaded = deps.loadDocument(directory);

        // No configuration at all is not an error: Atlante simply does not apply.
        if (loaded.diagnostics.some((d) => d.code === "config-not-found")) {
          return;
        }

        if (!loaded.document) return report(loaded.diagnostics);

        const { registry, errors } = deps.loadBundledTemplates();
        if (errors.length > 0) return report(templateLoadDiagnostics(errors));

        const resolved = (deps.resolve ?? resolve)(loaded.document, registry);
        if (hasErrors(resolved.diagnostics))
          return report(resolved.diagnostics);

        // Stage materialization so an unexpected adapter failure cannot leave
        // OpenCode with a partially injected configuration.
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
