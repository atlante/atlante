import { readArtifacts } from "@atlante/builder/artifacts";
import type { Plugin } from "@opencode-ai/plugin";
import type { PluginArtifacts, PluginArtifactsReader } from "./artifacts.js";
import {
  type HostConfig,
  type InjectionWarning,
  injectAgents,
} from "./inject.js";
import { createSkillTool, type SkillToolState } from "./skill-tool.js";

function report(warnings: readonly InjectionWarning[]): void {
  for (const warning of warnings) {
    console.error(
      `[atlante] ${warning.severity}: [${warning.code}] ${warning.message}`,
    );
  }
}

export type AtlantePluginDeps = {
  readArtifacts?: PluginArtifactsReader;
  injectAgents?: typeof injectAgents;
};

const defaultDeps: AtlantePluginDeps = {
  readArtifacts,
  injectAgents,
};

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

function reportFailure(warnings: readonly InjectionWarning[]): void {
  try {
    report(warnings);
  } catch {
    // Reporting must not turn a failed host-config transaction into a rejected hook.
  }
}

function prepare(
  directory: string,
  deps: AtlantePluginDeps,
): PluginArtifacts | undefined {
  try {
    const artifacts = (deps.readArtifacts ?? readArtifacts)(directory);
    if (!artifacts) return undefined;

    // Keep initialization output independent from the builder's arrays.
    return {
      agents: artifacts.agents.map((artifact) => ({ ...artifact })),
      skills: artifacts.skills.map((artifact) => ({ ...artifact })),
    };
  } catch {
    // A missing, corrupt, or unsafe publication must not stop OpenCode.
    return undefined;
  }
}

/**
 * Materialization is runtime injection: the resolved prompts are written into
 * the in-memory OpenCode config and nothing is generated on disk. Only a
 * complete, verified builder artifact publication is eligible for injection.
 */
export function createAtlantePlugin(
  deps: AtlantePluginDeps = defaultDeps,
): Plugin {
  return async ({ directory }) => {
    const artifacts = prepare(directory, deps);
    if (!artifacts) {
      return { config: async () => {} };
    }
    const state: SkillToolState = { status: "inactive" };
    const skillTool =
      artifacts.skills.length > 0
        ? createSkillTool(artifacts.skills, state)
        : undefined;

    return {
      config: async (config) => {
        try {
          const staged = structuredClone(config) as unknown as HostConfig;
          const warnings =
            artifacts.agents.length > 0
              ? (deps.injectAgents ?? injectAgents)(staged, artifacts.agents)
              : [];
          commitConfig(config as unknown as HostConfig, staged, () => {
            report(warnings);
            state.status = "active";
          });
        } catch (cause) {
          state.status = "failed";
          state.reason = String(cause);
          reportFailure([
            {
              severity: "warning",
              code: "plugin-runtime-failed",
              message: `plugin runtime failed: ${
                cause instanceof Error ? cause.message : String(cause)
              }`,
            },
          ]);
        }
      },
      ...(skillTool ? { tool: { atlante_skill: skillTool } } : {}),
    };
  };
}

export const AtlantePlugin: Plugin = createAtlantePlugin();
