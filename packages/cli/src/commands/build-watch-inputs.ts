import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  PRESET_NAME_PATTERN,
  PRESET_NAMESPACE,
  PRESETS_DIR,
} from "@atlante/presets";
import { BUNDLED_TEMPLATES_DIR } from "@atlante/templates";
import {
  CONFIG_FILENAMES,
  findConfigFile,
  MAX_PRESET_DEPTH,
  parseDocumentOverlay,
} from "@atlante/validator";

export type WatchFiles = {
  projectDir: string;
  configPath?: string;
  configCandidates?: string[];
  presetPaths: string[];
  templatePaths: string[];
};

function isConfigFilename(target: string): boolean {
  return (CONFIG_FILENAMES as readonly string[]).includes(basename(target));
}

function projectDirOf(target: string): string {
  let exists = false;
  try {
    const stat = statSync(target, { throwIfNoEntry: false });
    exists = stat !== undefined;
    if (stat?.isFile() && isConfigFilename(target)) {
      return dirname(target);
    }
  } catch {
    // Fall through to the non-existent-target handling below.
  }
  // A non-existent target whose basename is a config filename is a would-be
  // config FILE: the watch candidates must resolve to the target itself, so
  // its parent is the project directory.
  if (!exists && isConfigFilename(target)) {
    return dirname(target);
  }
  return target;
}

function bundledPresetPaths(id: string): string[] | undefined {
  if (!id.startsWith(`${PRESET_NAMESPACE}/`)) return undefined;
  const name = id.slice(PRESET_NAMESPACE.length + 1);
  if (!PRESET_NAME_PATTERN.test(name)) return undefined;
  const directory = join(PRESETS_DIR, name);
  const candidates = CONFIG_FILENAMES.map((filename) =>
    join(directory, filename),
  );
  const existing = candidates.find(existsSync);
  return existing ? [existing] : candidates;
}

function walkExtendsChain(
  overlay: { extends?: string },
  visited: Set<string>,
  paths: string[],
  depth: number,
): void {
  if (depth >= MAX_PRESET_DEPTH) return;
  const presetId = overlay.extends;
  if (typeof presetId !== "string" || presetId.length === 0) return;
  if (visited.has(presetId)) return;
  visited.add(presetId);

  const presetPaths = bundledPresetPaths(presetId);
  if (!presetPaths) return;

  paths.push(...presetPaths);
  const [presetPath] = presetPaths;
  const presetOverlay =
    presetPaths.length === 1 && presetPath
      ? readPresetOverlay(presetPath)
      : undefined;
  if (presetOverlay) walkExtendsChain(presetOverlay, visited, paths, depth + 1);
}

function readPresetOverlay(path: string): { extends?: string } | undefined {
  try {
    return parseDocumentOverlay(readFileSync(path, "utf8"), path).overlay;
  } catch {
    return undefined;
  }
}

function presetPathsOf(configText: string, configPath: string): string[] {
  const parsed = parseDocumentOverlay(configText, configPath);
  if (!parsed.overlay) return [];
  const paths: string[] = [];
  walkExtendsChain(parsed.overlay, new Set(), paths, 0);
  return paths;
}

function collectTemplateFiles(directory: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...collectTemplateFiles(path));
    else if (entry.name === "template.json" || entry.name === "template.md")
      paths.push(path);
  }
  return paths;
}

export function bundledTemplatePaths(
  directory: string = BUNDLED_TEMPLATES_DIR,
): string[] {
  if (!existsSync(directory)) return [];
  return collectTemplateFiles(directory).sort();
}

export function resolveWatchFiles(target: string): WatchFiles {
  const projectDir = projectDirOf(target);
  const config = findConfigFile(target);
  const configPath = config?.path;
  const configCandidates = configPath
    ? undefined
    : [...CONFIG_FILENAMES].map((filename) => join(projectDir, filename));
  const presetPaths = config ? presetPathsOf(config.text, config.path) : [];
  const templatePaths = bundledTemplatePaths();

  return {
    projectDir,
    ...(configPath ? { configPath } : {}),
    ...(configCandidates ? { configCandidates } : {}),
    presetPaths,
    templatePaths,
  };
}
