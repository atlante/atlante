import type {
  AgentBinding,
  AgentBindingOverlay,
  AgentsOverlay,
  AtlanteDocument,
  AtlanteDocumentOverlay,
  ValuesMapOverlay,
} from "@atlante/schema";
import { atlanteDocumentSchema } from "@atlante/schema";
import type { Diagnostic } from "./diagnostic.ts";
import { error, escapeJsonPointerSegment } from "./diagnostic.ts";

export const MAX_PRESET_DEPTH = 32;

/** @atlante/validator does not depend on @atlante/presets. */
export interface PresetLoader {
  load(id: string): {
    document: AtlanteDocumentOverlay | undefined;
    diagnostics: Diagnostic[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Safely assigns a property that may be `__proto__` without side effects.
 * Uses `Object.defineProperty` so the assignment is always an own data property.
 */
function own<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Creates an object with no inherited properties. All keys assigned via
 * `own()` are safely stored as own properties.
 */
function safeObject(): Record<string, unknown> {
  return Object.create(null);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? (value as Record<string, unknown>) : safeObject();
}

function asSafeRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return safeObject();
  const result = safeObject();
  for (const key of Object.keys(value as Record<string, unknown>)) {
    own(result, key, (value as Record<string, unknown>)[key]);
  }
  return result;
}

/** Strips null entries from a values overlay after merge. */
function canonicalizeValues(
  overlay: ValuesMapOverlay | undefined,
): Record<string, string> | undefined {
  if (!overlay) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== null) own(result, key, value);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * JSON Merge Patch: local takes precedence.
 * - `null` removes the key.
 * - Scalars replace.
 * - Objects merge recursively (when both are plain objects).
 * - Arrays replace completely.
 * - When override is a plain object and base is absent/non-object, merge
 *   against an empty object (full JSON Merge Patch semantics).
 */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = safeObject();
  const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);

  for (const key of allKeys) {
    const overrideValue = override[key];
    if (overrideValue === null) continue;

    const baseValue = base[key];
    const hasOwnOverride = Object.hasOwn(override, key);

    if (hasOwnOverride) {
      if (isRecord(overrideValue) && !Array.isArray(overrideValue)) {
        const mergedBase =
          isRecord(baseValue) && !Array.isArray(baseValue)
            ? baseValue
            : safeObject();
        own(result, key, deepMerge(mergedBase, overrideValue));
      } else {
        own(result, key, overrideValue);
      }
    } else {
      own(result, key, baseValue);
    }
  }

  return result;
}

/**
 * Merges two agent bindings. The local binding can tombstone properties with
 * `null`. `extends` is consumed and never reaches the output.
 */
function mergeAgentBinding(
  base: AgentBindingOverlay,
  local: AgentBindingOverlay,
): AgentBinding {
  const baseRecord = asSafeRecord(base);
  const localRecord = asSafeRecord(local);

  // Strip `values: undefined` from the local side so it doesn't erase
  // inherited values when the user simply omitted `values`.
  if (!Object.hasOwn(local, "values")) {
    delete localRecord.values;
  }
  if (!Object.hasOwn(local, "extends")) {
    delete localRecord.extends;
  }

  const merged = deepMerge(baseRecord, localRecord);
  delete merged.extends;
  return merged as unknown as AgentBinding;
}

/**
 * Recursively expands extends chains for the document level.
 */
function expandDocumentChain(
  overlay: AtlanteDocumentOverlay,
  presetLoader: PresetLoader,
  chain: string[],
  depth: number,
  diagnostics: Diagnostic[],
): AtlanteDocumentOverlay | undefined {
  if (!overlay.extends) return overlay;

  if (depth >= MAX_PRESET_DEPTH) {
    diagnostics.push(
      error(
        "preset-depth-exceeded",
        `preset inheritance depth limit of ${MAX_PRESET_DEPTH} exceeded`,
      ),
    );
    return undefined;
  }

  const presetId = overlay.extends;

  if (chain.includes(presetId)) {
    const cycleChain = [...chain, presetId];
    diagnostics.push(
      error(
        "preset-cycle",
        `circular preset inheritance: ${cycleChain.join(" -> ")}`,
      ),
    );
    return undefined;
  }

  const loaded = presetLoader.load(presetId);
  diagnostics.push(...loaded.diagnostics);

  if (!loaded.document) {
    diagnostics.push(
      error("unknown-preset", `preset "${presetId}" could not be loaded`, {
        path: "/extends",
      }),
    );
    return undefined;
  }

  const expandedBase = expandDocumentChain(
    loaded.document,
    presetLoader,
    [...chain, overlay.extends],
    depth + 1,
    diagnostics,
  );
  if (!expandedBase) return undefined;

  // Merge values: key-by-key, with null removal handled by canonicalizeValues later.
  const mergedValues: ValuesMapOverlay = {
    ...(expandedBase.values ?? {}),
    ...(overlay.values ?? {}),
  };

  // Merge agents: key-by-key, null removes.
  const mergedAgents = deepMerge(
    asRecord(expandedBase.agents ?? {}),
    asRecord(overlay.agents ?? {}),
  );

  return {
    $schema: overlay.$schema,
    values: Object.keys(mergedValues).length > 0 ? mergedValues : undefined,
    agents: mergedAgents as AgentsOverlay,
  };
}

/**
 * Expands a preset document fully (including its root extends chain) and then
 * extracts the matching agent binding.
 */
function expandAndExtractAgent(
  agentId: string,
  presetId: string,
  presetDocument: AtlanteDocumentOverlay,
  presetLoader: PresetLoader,
  chain: string[],
  diagnostics: Diagnostic[],
): AgentBindingOverlay | undefined {
  // First, expand the preset document's own root extends chain.
  const expandedPreset = expandDocumentChain(
    presetDocument,
    presetLoader,
    chain,
    0,
    diagnostics,
  );
  if (!expandedPreset) return undefined;

  const presetAgents = Object.entries(expandedPreset.agents ?? {}).filter(
    ([, v]) => v !== null,
  ) as [string, AgentBindingOverlay][];

  if (presetAgents.length === 0) {
    diagnostics.push(
      error(
        "incompatible-preset",
        `agent "${agentId}": preset "${presetId}" has no agents`,
        {
          path: `/agents/${escapeJsonPointerSegment(agentId)}/extends`,
        },
      ),
    );
    return undefined;
  }

  if (presetAgents.length === 1) {
    return presetAgents[0]?.[1];
  }

  const match = presetAgents.find(([id]) => id === agentId);
  if (!match) {
    diagnostics.push(
      error(
        "incompatible-preset",
        `agent "${agentId}": preset "${presetId}" does not contain an agent "${agentId}" (available: ${presetAgents.map(([id]) => id).join(", ")})`,
        {
          path: `/agents/${escapeJsonPointerSegment(agentId)}/extends`,
        },
      ),
    );
    return undefined;
  }
  return match[1];
}

/**
 * Expands agent-level extends. Loads the referenced preset document, expands
 * its full inheritance tree, finds the matching agent binding, and merges.
 */
function expandAgentBinding(
  agentId: string,
  binding: AgentBindingOverlay,
  presetLoader: PresetLoader,
  defaultTemplateId: string,
  chain: string[],
  depth: number,
  diagnostics: Diagnostic[],
): AgentBinding | undefined {
  if (!binding.extends) {
    // No inheritance — just clean up and return.
    const result: Record<string, unknown> = safeObject();
    for (const [key, value] of Object.entries(binding)) {
      if (value !== null && key !== "extends") {
        own(result, key, value);
      }
    }
    return result as unknown as AgentBinding;
  }

  if (depth >= MAX_PRESET_DEPTH) {
    diagnostics.push(
      error(
        "preset-depth-exceeded",
        `agent "${agentId}": preset inheritance depth limit of ${MAX_PRESET_DEPTH} exceeded`,
        { path: `/agents/${escapeJsonPointerSegment(agentId)}/extends` },
      ),
    );
    return undefined;
  }

  const presetId = binding.extends;

  if (chain.includes(presetId)) {
    const cycleChain = [...chain, presetId];
    diagnostics.push(
      error(
        "preset-cycle",
        `circular preset inheritance: ${cycleChain.join(" -> ")}`,
        { path: `/agents/${escapeJsonPointerSegment(agentId)}/extends` },
      ),
    );
    return undefined;
  }

  const loaded = presetLoader.load(presetId);
  diagnostics.push(...loaded.diagnostics);

  if (!loaded.document) {
    diagnostics.push(
      error("unknown-preset", `preset "${presetId}" could not be loaded`, {
        path: `/agents/${escapeJsonPointerSegment(agentId)}/extends`,
      }),
    );
    return undefined;
  }

  const baseAgent = expandAndExtractAgent(
    agentId,
    presetId,
    loaded.document,
    presetLoader,
    [...chain, presetId],
    diagnostics,
  );
  if (!baseAgent) return undefined;

  // Recursively expand the base agent (it might have its own agent-level extends).
  let expandedBaseBinding = baseAgent;
  if (baseAgent.extends) {
    const expanded = expandAgentBinding(
      agentId,
      baseAgent,
      presetLoader,
      defaultTemplateId,
      [...chain, presetId],
      depth + 1,
      diagnostics,
    );
    if (!expanded) return undefined;
    expandedBaseBinding = expanded as unknown as AgentBindingOverlay;
  }

  // Validate template compatibility: local must not switch promptTemplate.
  const baseTemplate =
    expandedBaseBinding.promptTemplate === null
      ? null
      : (expandedBaseBinding.promptTemplate ?? defaultTemplateId);
  const localTemplate =
    binding.promptTemplate === null ? null : binding.promptTemplate;

  if (
    baseTemplate &&
    localTemplate !== undefined &&
    localTemplate !== null &&
    localTemplate !== baseTemplate
  ) {
    diagnostics.push(
      error(
        "agent-preset-template-mismatch",
        `agent "${agentId}": cannot switch promptTemplate from "${baseTemplate}" to "${localTemplate}" when extending a preset`,
        {
          path: `/agents/${escapeJsonPointerSegment(agentId)}/promptTemplate`,
        },
      ),
    );
    return undefined;
  }

  return mergeAgentBinding(expandedBaseBinding as AgentBindingOverlay, binding);
}

/**
 * Main entry point: expands an overlay document into a canonical
 * `AtlanteDocument` and validates the result against the canonical schema.
 */
export function expandDocument(
  overlay: AtlanteDocumentOverlay,
  presetLoader: PresetLoader,
  defaultTemplateId: string,
): {
  document: AtlanteDocument | undefined;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];

  // Step 1: Expand top-level extends chain.
  const expandedBase = expandDocumentChain(
    overlay,
    presetLoader,
    [],
    0,
    diagnostics,
  );
  if (!expandedBase) return { document: undefined, diagnostics };

  // Step 2: Expand agent-level extends.
  const expandedAgents: Record<string, AgentBinding> = Object.create(null);
  let agentErrors = false;

  for (const [agentId, binding] of Object.entries(expandedBase.agents ?? {})) {
    if (binding === null) continue; // tombstoned agent

    const expanded = expandAgentBinding(
      agentId,
      binding,
      presetLoader,
      defaultTemplateId,
      [],
      0,
      diagnostics,
    );
    if (expanded) {
      expandedAgents[agentId] = expanded;
    } else {
      agentErrors = true;
    }
  }

  if (agentErrors) return { document: undefined, diagnostics };

  // Step 3: Build canonical document.
  const canonical: AtlanteDocument = {
    $schema: overlay.$schema as AtlanteDocument["$schema"],
    values: canonicalizeValues(expandedBase.values),
    agents: expandedAgents,
  };

  // Step 4: Validate against the canonical schema.
  const result = atlanteDocumentSchema.safeParse(canonical);
  if (!result.success) {
    for (const issue of result.error.issues) {
      diagnostics.push(
        error("invalid-document", `expanded configuration: ${issue.message}`, {
          path: `/${issue.path.map(String).map(escapeJsonPointerSegment).join("/")}`,
        }),
      );
    }
    return { document: undefined, diagnostics };
  }

  return { document: result.data, diagnostics };
}
