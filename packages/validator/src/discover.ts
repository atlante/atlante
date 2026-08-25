import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Diagnostic } from "./diagnostic.js";
import { error } from "./diagnostic.js";

export const CONFIG_FILENAMES = ["atlante.jsonc", "atlante.json"] as const;

/**
 * SPECIFICATION.md §4: when both filenames exist the implementation must report
 * ambiguity and require an explicit path rather than choosing silently.
 */
export function discoverConfigPath(directory: string): {
  path?: string;
  diagnostics: Diagnostic[];
} {
  const root = resolve(directory);
  const found = CONFIG_FILENAMES.map((name) => join(root, name)).filter(
    (candidate) => existsSync(candidate),
  );

  if (found.length > 1) {
    return {
      diagnostics: [
        error(
          "ambiguous-config",
          `both ${CONFIG_FILENAMES.join(" and ")} exist in the project root; pass an explicit path`,
          { source: CONFIG_FILENAMES.join("/") },
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
          `no ${CONFIG_FILENAMES.join(" or ")} found in the project root`,
          { source: CONFIG_FILENAMES.join("/") },
        ),
      ],
    };
  }

  return { path, diagnostics: [] };
}

/**
 * Finds and reads a configuration file. Accepts either a direct file path or a
 * directory. Returns the resolved path and raw file contents, or null if
 * no configuration file could be found or read.
 */
export function findConfigFile(target: string): {
  path: string;
  text: string;
} | null {
  const resolvedTarget = resolve(target);
  // 1. If the target is a regular file with a valid basename, read it directly.
  try {
    const st = statSync(resolvedTarget, { throwIfNoEntry: false });
    if (st?.isFile()) {
      const name = basename(resolvedTarget);
      if ((CONFIG_FILENAMES as readonly string[]).includes(name)) {
        return {
          path: resolvedTarget,
          text: readFileSync(resolvedTarget, "utf8"),
        };
      }
    }
  } catch {
    // Fall through to directory discovery.
  }

  // 2. Otherwise, treat it as a directory and discover the configuration file.
  const discovered = discoverConfigPath(resolvedTarget);
  if (!discovered.path) return null;
  try {
    return {
      path: discovered.path,
      text: readFileSync(discovered.path, "utf8"),
    };
  } catch {
    return null;
  }
}
