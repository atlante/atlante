import type { ValuesMap } from "@atlante/schema";

/**
 * Key-by-key merge: a local value replaces the global value with the same key
 * for that binding only (SPECIFICATION.md, Configuration Document).
 */
export function mergeValues(
  global: ValuesMap | undefined,
  local: ValuesMap | undefined,
  tombstones: readonly string[] = [],
): ValuesMap {
  const values = { ...(global ?? {}), ...(local ?? {}) };
  for (const pointer of tombstones) {
    if (!pointer.startsWith("/") || pointer.slice(1).includes("/")) continue;
    delete values[pointer.slice(1)];
  }
  return values;
}
