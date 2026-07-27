import type { ResolvedHarness } from "@atlante/resolver";
import { resolve } from "@atlante/resolver";
import { loadBundledTemplates } from "@atlante/templates";
import type { Diagnostic } from "@atlante/validator";
import {
  createBundledPresetLoader,
  error,
  expandDocument,
  findConfigFile,
  formatDiagnostic,
  hasErrors,
  loadDocument,
  parseDocumentOverlay,
  templateLoadDiagnostics,
} from "@atlante/validator";
import type { Plugin } from "@opencode-ai/plugin";
import type { HostConfig } from "./inject.js";
import { injectAgents } from "./inject.js";
import { createSkillTool, type SkillToolState } from "./skill-tool.js";

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

type Preparation =
  | { kind: "none" }
  | { kind: "ready"; resolved: ResolvedHarness }
  | { kind: "failed"; diagnostics: Diagnostic[] };

function runtimeFailure(cause: unknown): Diagnostic[] {
  return [
    error(
      "plugin-runtime-failed",
      `plugin runtime failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    ),
  ];
}

function restoreConfig(
  config: HostConfig,
  snapshot: PropertyDescriptorMap,
): void {
  for (const key of Reflect.ownKeys(config)) {
    if (!Object.hasOwn(snapshot, key)) Reflect.deleteProperty(config, key);
  }
  for (const key of Reflect.ownKeys(snapshot)) {
    const descriptor = Reflect.get(snapshot, key) as
      | PropertyDescriptor
      | undefined;
    if (descriptor) Object.defineProperty(config, key, descriptor);
  }
}

function commitConfig(
  config: HostConfig,
  staged: HostConfig,
  afterCommit: () => void,
): void {
  const snapshot = Object.getOwnPropertyDescriptors(config);
  try {
    for (const key of Reflect.ownKeys(staged)) {
      const descriptor = Object.getOwnPropertyDescriptor(staged, key);
      if (!descriptor?.enumerable) continue;
      const value =
        "value" in descriptor ? descriptor.value : Reflect.get(staged, key);
      if (Object.hasOwn(config, key)) {
        if (!Reflect.set(config, key, value, config)) {
          throw new TypeError(
            `cannot assign host config property ${String(key)}`,
          );
        }
      } else {
        Object.defineProperty(config, key, {
          configurable: true,
          enumerable: true,
          value,
          writable: true,
        });
      }
    }
    afterCommit();
  } catch (cause) {
    restoreConfig(config, snapshot);
    throw cause;
  }
}

function reportFailure(diagnostics: Diagnostic[]): void {
  try {
    report(diagnostics);
  } catch {
    // Reporting must not turn a failed host-config transaction into a rejected hook.
  }
}

function prepare(directory: string, deps: AtlantePluginDeps): Preparation {
  try {
    const file = findConfigFile(directory);

    // No configuration at all is not an error: Atlante simply does not apply.
    if (!file) {
      const loaded = deps.loadDocument(directory);
      if (loaded.diagnostics.some((d) => d.code === "config-not-found")) {
        return { kind: "none" };
      }
      return { kind: "failed", diagnostics: loaded.diagnostics };
    }

    const parsed = parseDocumentOverlay(file.text, file.path);
    if (!parsed.overlay)
      return { kind: "failed", diagnostics: parsed.diagnostics };

    const { registry, errors } = deps.loadBundledTemplates();
    if (errors.length > 0) {
      return { kind: "failed", diagnostics: templateLoadDiagnostics(errors) };
    }

    const expanded = (deps.expandDocument ?? expandDocument)(
      parsed.overlay,
      createBundledPresetLoader(),
    );
    if (!expanded.document) {
      return { kind: "failed", diagnostics: expanded.diagnostics };
    }

    const resolved = (deps.resolve ?? resolve)(expanded.document, registry);
    if (hasErrors(resolved.diagnostics)) {
      return { kind: "failed", diagnostics: resolved.diagnostics };
    }

    // Keep initialization output independent from mutable resolver-owned arrays.
    return {
      kind: "ready",
      resolved: {
        agents: resolved.agents.map((artifact) => ({ ...artifact })),
        skills: resolved.skills.map((artifact) => ({ ...artifact })),
        diagnostics: resolved.diagnostics.map((diagnostic) => ({
          ...diagnostic,
          ...(diagnostic.location
            ? { location: { ...diagnostic.location } }
            : {}),
        })),
      },
    };
  } catch (cause) {
    return { kind: "failed", diagnostics: runtimeFailure(cause) };
  }
}

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
  return async ({ directory }) => {
    const preparation = prepare(directory, deps);
    if (preparation.kind === "none") {
      return { config: async () => {} };
    }
    if (preparation.kind === "failed") {
      return {
        config: async () => reportFailure(preparation.diagnostics),
      };
    }

    const { resolved } = preparation;
    const state: SkillToolState = { status: "inactive" };
    const skillTool =
      resolved.skills.length > 0
        ? createSkillTool(resolved.skills, state)
        : undefined;

    return {
      config: async (config) => {
        if (state.status === "failed") return;
        try {
          const staged = structuredClone(config) as unknown as HostConfig;
          const warnings =
            resolved.agents.length > 0
              ? (deps.injectAgents ?? injectAgents)(staged, resolved.agents)
              : [];
          commitConfig(config as unknown as HostConfig, staged, () => {
            report([...resolved.diagnostics, ...warnings]);
            state.status = "active";
          });
        } catch (cause) {
          state.status = "failed";
          state.reason = String(cause);
          reportFailure(runtimeFailure(cause));
        }
      },
      ...(skillTool ? { tool: { atlante_skill: skillTool } } : {}),
    };
  };
}

export const AtlantePlugin: Plugin = createAtlantePlugin();
