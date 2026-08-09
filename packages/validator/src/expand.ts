import type { AtlanteDocument, AtlanteDocumentOverlay } from "@atlante/schema";
import { atlanteDocumentSchema, VALUE_KEY_PATTERN } from "@atlante/schema";
import type { Diagnostic } from "./diagnostic.js";
import { error, escapeJsonPointerSegment } from "./diagnostic.js";

export const MAX_PRESET_DEPTH = 32;

/** Generic overlay expansion stays independent of any source-content package. */
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

/** Safely assigns a property that may be `__proto__`. */
function own(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/** Creates an object whose inherited properties cannot affect expansion. */
function safeObject(): Record<string, unknown> {
  return Object.create(null);
}

function copyNonNullEntries(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const output = safeObject();
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== null) own(output, key, entry);
  }
  return output;
}

/** Removes tombstones from the root values map without hiding malformed input. */
function canonicalizeValues(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return value;

  const output = safeObject();
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null && VALUE_KEY_PATTERN.test(key)) continue;
    own(output, key, entry);
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

/** Removes direct tombstones while preserving malformed runtime shapes. */
function stripBindingTombstones(value: unknown): unknown {
  if (value === null) return null;
  if (!isRecord(value)) return value;

  return copyNonNullEntries(value);
}

type MergeMode = "document" | "values" | "bindings" | "nested";

function childMergeMode(mode: MergeMode, key: string): MergeMode {
  if (key === "values") return "values";
  if (mode !== "document") return "nested";
  if (key === "agents" || key === "skills") return "bindings";
  return "nested";
}

function preservesNull(mode: MergeMode, key: string): boolean {
  if (mode === "document") return true;
  if (mode === "values") return !VALUE_KEY_PATTERN.test(key);
  if (mode === "bindings") return key.length === 0;
  return false;
}

/**
 * Applies JSON Merge Patch semantics to two object values.
 * Null deletes, objects recurse, and all other values replace.
 */
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
  mode: MergeMode = "nested",
): Record<string, unknown> {
  const result = safeObject();
  const allKeys = new Set([...Object.keys(base), ...Object.keys(override)]);

  for (const key of allKeys) {
    if (!Object.hasOwn(override, key)) {
      own(result, key, base[key]);
      continue;
    }

    const overrideValue = override[key];
    if (overrideValue === null) {
      if (preservesNull(mode, key)) own(result, key, overrideValue);
      continue;
    }

    const baseValue = base[key];
    if (isRecord(overrideValue)) {
      const mergedBase = isRecord(baseValue) ? baseValue : safeObject();
      own(
        result,
        key,
        deepMerge(mergedBase, overrideValue, childMergeMode(mode, key)),
      );
    } else {
      own(result, key, overrideValue);
    }
  }

  return result;
}

function canonicalizeBindings(value: unknown): unknown {
  if (!isRecord(value)) return value;

  const output = safeObject();
  for (const [key, entry] of Object.entries(value)) {
    if (entry === null) {
      if (key.length === 0) own(output, key, entry);
      continue;
    }
    own(output, key, stripBindingTombstones(entry));
  }
  return output;
}

/** Recursively expands a preset chain, retaining the complete overlay shape. */
function expandDocumentChain(
  overlay: AtlanteDocumentOverlay,
  presetLoader: PresetLoader,
  chain: string[],
  depth: number,
  diagnostics: Diagnostic[],
): AtlanteDocumentOverlay | undefined {
  const rawOverlay = overlay as unknown as Record<string, unknown>;
  if (!Object.hasOwn(rawOverlay, "extends")) return overlay;

  const presetId = rawOverlay.extends;
  if (typeof presetId !== "string" || presetId.length === 0) {
    diagnostics.push(
      error("invalid-document", '"extends" must be a non-empty string', {
        path: "/extends",
      }),
    );
    return undefined;
  }

  const nextChain = [...chain, presetId];
  if (depth >= MAX_PRESET_DEPTH) {
    diagnostics.push(
      error(
        "preset-depth-exceeded",
        `preset inheritance depth limit of ${MAX_PRESET_DEPTH} exceeded: ${nextChain.join(" -> ")}`,
        { path: "/extends" },
      ),
    );
    return undefined;
  }

  if (chain.includes(presetId)) {
    diagnostics.push(
      error(
        "preset-cycle",
        `circular preset inheritance: ${nextChain.join(" -> ")}`,
        { path: "/extends" },
      ),
    );
    return undefined;
  }

  const loaded = presetLoader.load(presetId);
  diagnostics.push(...loaded.diagnostics);
  if (!loaded.document) {
    diagnostics.push(
      error(
        "unknown-preset",
        `preset inheritance chain ${nextChain.join(" -> ")}: preset "${presetId}" could not be loaded`,
        { path: "/extends" },
      ),
    );
    return undefined;
  }

  const expandedBase = expandDocumentChain(
    loaded.document,
    presetLoader,
    nextChain,
    depth + 1,
    diagnostics,
  );
  if (!expandedBase) return undefined;

  return deepMerge(
    expandedBase as unknown as Record<string, unknown>,
    rawOverlay,
    "document",
  ) as AtlanteDocumentOverlay;
}

/**
 * Expands an overlay document into a canonical document and validates the
 * complete result against the canonical schema.
 */
export function expandDocument(
  overlay: AtlanteDocumentOverlay,
  presetLoader: PresetLoader,
): {
  document: AtlanteDocument | undefined;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const expandedBase = expandDocumentChain(
    overlay,
    presetLoader,
    [],
    0,
    diagnostics,
  );
  if (!expandedBase) return { document: undefined, diagnostics };

  // Apply tombstones even when there is no preset, then remove inheritance.
  const merged = deepMerge(
    safeObject(),
    expandedBase as unknown as Record<string, unknown>,
    "document",
  );
  delete merged.extends;

  const canonical: Record<string, unknown> = safeObject();
  for (const [key, value] of Object.entries(merged)) {
    own(canonical, key, value);
  }

  // The user's schema declaration always wins over inherited metadata.
  own(canonical, "$schema", overlay.$schema);

  if (Object.hasOwn(canonical, "values")) {
    const values = canonicalizeValues(canonical.values);
    if (values === undefined) delete canonical.values;
    else own(canonical, "values", values);
  }
  if (Object.hasOwn(canonical, "agents")) {
    own(canonical, "agents", canonicalizeBindings(canonical.agents));
  }
  if (Object.hasOwn(canonical, "skills")) {
    own(canonical, "skills", canonicalizeBindings(canonical.skills));
  }

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
