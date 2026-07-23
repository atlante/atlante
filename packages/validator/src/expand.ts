import type {
  AgentBinding,
  AgentsOverlay,
  AtlanteDocument,
  AtlanteDocumentOverlay,
  ValuesMapOverlay,
} from "@atlante/schema";
import { atlanteDocumentSchema } from "@atlante/schema";
import type { Diagnostic } from "./diagnostic.ts";
import { error, escapeJsonPointerSegment } from "./diagnostic.ts";

const MAX_PRESET_DEPTH = 32;

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
 * Main entry point: expands an overlay document into a canonical
 * `AtlanteDocument` and validates the result against the canonical schema.
 */
export function expandDocument(
  overlay: AtlanteDocumentOverlay,
  presetLoader: PresetLoader,
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

  // Step 2: Clean up agent bindings (strip null tombstones).
  const expandedAgents: Record<string, AgentBinding> = Object.create(null);

  for (const [agentId, binding] of Object.entries(expandedBase.agents ?? {})) {
    if (binding === null) continue; // tombstoned agent

    const cleaned: Record<string, unknown> = safeObject();
    for (const [key, value] of Object.entries(binding)) {
      if (value !== null) {
        own(cleaned, key, value);
      }
    }
    expandedAgents[agentId] = cleaned as unknown as AgentBinding;
  }

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
