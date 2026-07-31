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

function bundledPresetPath(id: string): string | undefined {
  if (!id.startsWith(`${PRESET_NAMESPACE}/`)) return undefined;
  const name = id.slice(PRESET_NAMESPACE.length + 1);
  if (!PRESET_NAME_PATTERN.test(name)) return undefined;
  const directory = join(PRESETS_DIR, name);
  for (const filename of CONFIG_FILENAMES) {
    const candidate = join(directory, filename);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function walkExtendsChain(
  overlay: { extends?: string },
  visited: Set<string>,
  paths: string[],
): void {
  const presetId = overlay.extends;
  if (typeof presetId !== "string" || presetId.length === 0) return;
  if (visited.has(presetId)) return;
  visited.add(presetId);

  const presetPath = bundledPresetPath(presetId);
  if (!presetPath) return;

  paths.push(presetPath);
  const presetOverlay = readPresetOverlay(presetPath);
  if (presetOverlay) walkExtendsChain(presetOverlay, visited, paths);
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
  walkExtendsChain(parsed.overlay, new Set(), paths);
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
