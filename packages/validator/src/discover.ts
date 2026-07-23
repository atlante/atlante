import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
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

/**
 * Finds and reads a config file. Accepts either a direct file path or a
 * directory. Returns the resolved path and raw file contents, or null if
 * no config file could be found or read.
 */
export function findConfigFile(target: string): {
  path: string;
  text: string;
} | null {
  // 1. If the target is a regular file with a valid basename, read it directly.
  try {
    const st = statSync(target, { throwIfNoEntry: false });
    if (st?.isFile()) {
      const name = basename(target);
      if ((CONFIG_FILENAMES as readonly string[]).includes(name)) {
        return { path: target, text: readFileSync(target, "utf8") };
      }
    }
  } catch {
    // Fall through to directory discovery.
  }

  // 2. Otherwise, treat it as a directory and discover the config file.
  const discovered = discoverConfigPath(target);
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
