/** Reads JSON-shaped values while preserving string array-index semantics. */
export function jsonValueAtPath<T>(
  value: unknown,
  path: readonly string[],
  lookup: (object: Record<string, unknown>, segment: string) => unknown = (
    object,
    segment,
  ) => (Object.hasOwn(object, segment) ? object[segment] : undefined),
): T | undefined {
  let current: unknown = value;
  for (const segment of path) {
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined;
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== "object" || current === null) return undefined;
    current = lookup(current as Record<string, unknown>, segment);
    if (current === undefined) return undefined;
  }
  return current as T;
}
