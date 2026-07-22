import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "./diagnostic.ts";
import { error } from "./diagnostic.ts";

export const CONFIG_FILENAMES = ["atlante.jsonc", "atlante.json"] as const;

/**
 * SPECIFICATION.md §4: when both filenames exist the implementation must report
 * ambiguity and require an explicit path rather than choosing silently.
 */
export function discoverConfigPath(directory: string): {
  path?: string;
  diagnostics: Diagnostic[];
} {
  const found = CONFIG_FILENAMES.map((name) => join(directory, name)).filter(
    (candidate) => existsSync(candidate),
  );

  if (found.length > 1) {
    return {
      diagnostics: [
        error(
          "ambiguous-config",
          `both ${CONFIG_FILENAMES.join(" and ")} exist in ${directory}; pass an explicit path`,
        ),
      ],
    };
  }

  const path = found[0];
  if (!path) {
    return {
      diagnostics: [
        error(
          "config-not-found",
          `no ${CONFIG_FILENAMES.join(" or ")} found in ${directory}`,
        ),
      ],
    };
  }

  return { path, diagnostics: [] };
}
