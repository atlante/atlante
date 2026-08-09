// fallow-ignore-file code-duplication -- migration implementation mirrors the retained old package until Cleanup

import { basename } from "node:path";

/**
 * Map of `sys.<key>` resolvers. Each function is called when a
 * `{{sys.<key>}}` reference must be resolved at runtime.
 */
export const SYSTEM_RESOLVERS: Record<string, () => string> = {
  "cwd.basename": () => basename(process.cwd()),
};

/** Thrown when a system value has no registered resolver. */
export class UnknownSystemVariableError extends Error {
  constructor(key: string) {
    super(`unknown system variable "{{sys.${key}}}"`);
    this.name = "UnknownSystemVariableError";
  }
}

function resolveSystemString(source: string): string {
  return source.replace(
    /\{\{sys\.([a-zA-Z0-9_.-]+)\}\}/g,
    (_match, key: string) => {
      const resolver = Object.hasOwn(SYSTEM_RESOLVERS, key)
        ? SYSTEM_RESOLVERS[key]
        : undefined;
      if (!resolver) throw new UnknownSystemVariableError(key);
      return resolver();
    },
  );
}

/** Resolves system references in a values map without mutating the input. */
export function resolveSystemValues(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const resolvedValue =
      typeof value === "string" ? resolveSystemString(value) : value;
    Object.defineProperty(resolved, key, {
      configurable: true,
      enumerable: true,
      value: resolvedValue,
      writable: true,
    });
  }
  return resolved;
}
