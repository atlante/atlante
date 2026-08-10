import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { loadProject } from "@atlante/builder";
import { BUNDLED_RESOURCE_PACK } from "@atlante/resources";
import type { ResourceWatchContext } from "@atlante/validator";
import { CONFIG_FILENAMES, findConfigFile } from "@atlante/validator";

export type WatchFiles = {
  projectDir: string;
  configPath?: string;
  configCandidates?: string[];
  /** Files actually selected by the shared resource resolver. */
  resourcePaths: string[];
  /** Existing directories to retry unresolved resource targets from. */
  unresolvedParents: string[];
  /** Whether the current config/resource graph resolved without errors. */
  resourceResolutionSucceeded: boolean;
};

function isConfigFilename(target: string): boolean {
  return (CONFIG_FILENAMES as readonly string[]).includes(basename(target));
}

function projectDirOf(target: string): string {
  const absoluteTarget = resolve(target);
  try {
    const stat = statSync(absoluteTarget, { throwIfNoEntry: false });
    if (stat?.isFile() && isConfigFilename(absoluteTarget))
      return dirname(absoluteTarget);
    if (stat?.isDirectory()) return absoluteTarget;
  } catch {
    // Fall through to the non-existent-target handling below.
  }
  // A non-existent target whose basename is a config filename is a would-be
  // config FILE: candidates resolve to its parent directory.
  if (isConfigFilename(absoluteTarget)) return dirname(absoluteTarget);
  return absoluteTarget;
}

function rootsFor(projectDir: string): readonly string[] {
  const roots = new Set([resolve(projectDir)]);
  try {
    roots.add(realpathSync(projectDir));
  } catch {
    // The project root may be created after the first failed build.
  }
  roots.add(BUNDLED_RESOURCE_PACK.root);
  roots.add(BUNDLED_RESOURCE_PACK.lexicalRoot);
  return [...roots];
}

function isWithinAnyRoot(path: string, roots: readonly string[]): boolean {
  const candidate = resolve(path);
  return roots.some((root) => {
    const result = relative(resolve(root), candidate);
    return (
      result === "" ||
      (result !== ".." &&
        !result.startsWith(`..${sep}`) &&
        !result.startsWith(sep))
    );
  });
}

function safePaths(
  paths: readonly string[] | undefined,
  roots: readonly string[],
  kind: "file" | "directory",
): string[] {
  return [
    ...new Set(
      (paths ?? []).filter(
        (path): path is string =>
          typeof path === "string" &&
          isWithinAnyRoot(path, roots) &&
          (() => {
            try {
              const stat = lstatSync(path, { throwIfNoEntry: false });
              if (kind === "file" && stat === undefined)
                return (CONFIG_FILENAMES as readonly string[]).includes(
                  basename(path),
                );
              return kind === "file"
                ? Boolean(stat?.isFile() || stat?.isSymbolicLink())
                : Boolean(stat?.isDirectory());
            } catch {
              return false;
            }
          })(),
      ),
    ),
  ].sort();
}

function resourceWatchOf(
  target: string,
  provided?: ResourceWatchContext,
): { context?: ResourceWatchContext; succeeded: boolean; configPath?: string } {
  const config = findConfigFile(target);
  if (!config) return { succeeded: false };
  if (provided)
    return { configPath: config.path, context: provided, succeeded: true };

  try {
    const loaded = loadProject(target);
    return {
      configPath: loaded.configPath ?? config.path,
      ...(loaded.resourceWatch ? { context: loaded.resourceWatch } : {}),
      succeeded:
        loaded.document !== undefined &&
        loaded.diagnostics.every(({ severity }) => severity !== "error"),
    };
  } catch {
    return { configPath: config.path, succeeded: false };
  }
}

export function resolveWatchFiles(
  target: string,
  providedResourceWatch?: ResourceWatchContext,
): WatchFiles {
  const projectDir = projectDirOf(target);
  const resolved = resourceWatchOf(target, providedResourceWatch);
  const configPath = resolved.configPath;
  const roots = rootsFor(projectDir);
  const configCandidates = [...CONFIG_FILENAMES].map((filename) =>
    resolve(projectDir, filename),
  );

  return {
    projectDir,
    ...(configPath ? { configPath } : {}),
    ...(configCandidates ? { configCandidates } : {}),
    resourcePaths: safePaths(resolved.context?.dependencies, roots, "file"),
    unresolvedParents: safePaths(
      resolved.context?.unresolvedParents,
      roots,
      "directory",
    ),
    resourceResolutionSucceeded: resolved.succeeded,
  };
}
