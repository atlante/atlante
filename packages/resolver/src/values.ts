import type { ValuesMap } from "@atlante/schema";

/**
 * Key-by-key merge: a local value replaces the global value with the same key
 * for that agent only (SPECIFICATION.md §4.2).
 */
export function mergeValues(
  global: ValuesMap | undefined,
  local: ValuesMap | undefined,
): ValuesMap {
  return { ...(global ?? {}), ...(local ?? {}) };
}
