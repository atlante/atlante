import { basename } from "node:path";

/**
 * Map of `sys.<key>` resolvers. Each function is called when a
 * `{{sys.<key>}}` reference must be resolved at runtime.
 */
export const SYSTEM_RESOLVERS: Record<string, () => string> = {
  "cwd.basename": () => basename(process.cwd()),
};

/**
 * Thrown when a `{{sys.<key>}}` reference does not match any known resolver.
 */
export class UnknownSystemVariableError extends Error {
  constructor(key: string) {
    super(`unknown system variable "{{sys.${key}}}"`);
    this.name = "UnknownSystemVariableError";
  }
}

/**
 * Scans a string value and replaces every `{{sys.<key>}}` reference with
 * the corresponding runtime value. Non-matching `{{...}}` tokens (e.g.
 * `{{values.x}}`, template syntax, prose) are left unchanged — they are
 * handled later by `interpolateValues` or the Handlebars renderer.
 */
function resolveSystemString(source: string): string {
  return source.replace(
    /\{\{sys\.([a-zA-Z0-9_.-]+)\}\}/g,
    (_match, key: string) => {
      const resolver = SYSTEM_RESOLVERS[key];
      if (!resolver) throw new UnknownSystemVariableError(key);
      return resolver();
    },
  );
}

/**
 * Resolves `{{sys.*}}` references in a flat values map. Called after
 * document expansion (and per-agent value merge) but before
 * `interpolateValues` so that `{{values.*}}` lookups always see the
 * resolved runtime values.
 *
 * String values are substituted inline; non-string values pass through
 * unchanged. The returned map is a shallow copy.
 */
export function resolveSystemValues(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const resolvedValue =
      typeof value === "string" ? resolveSystemString(value) : value;
    // Use defineProperty to avoid the __proto__ setter on plain objects,
    // which would silently discard non-object values (SPECIFICATION.md §4.5).
    Object.defineProperty(resolved, key, {
      configurable: true,
      enumerable: true,
      value: resolvedValue,
      writable: true,
    });
  }
  return resolved;
}
