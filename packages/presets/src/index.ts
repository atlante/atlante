import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PRESETS_DIR = fileURLToPath(
  new URL("../bundled", import.meta.url),
);
export const PRESET_NAMESPACE = "atlante";
export const PRESET_NAME_PATTERN = /^[a-z0-9-]+$/;

export type PresetLoadError = { directory: string; message: string };

type PresetLoaderDeps = {
  existsSync?: (path: string) => boolean;
  readdirSync?: (path: string) => string[];
  readFileSync?: (path: string, encoding: "utf8") => string;
  statSync?: (path: string) => { isDirectory(): boolean };
};

function presetSources(
  directory: string,
  exists: (path: string) => boolean,
): string[] {
  return ["atlante.jsonc", "atlante.json"]
    .map((filename) => join(directory, filename))
    .filter(exists);
}

export function listPresets(
  rootDirectory: string = PRESETS_DIR,
  deps: PresetLoaderDeps = {},
): { presets: string[]; errors: PresetLoadError[] } {
  const presets: string[] = [];
  const errors: PresetLoadError[] = [];
  let entries: string[];

  try {
    entries = (deps.readdirSync ?? readdirSync)(rootDirectory).sort();
  } catch (error) {
    return {
      presets,
      errors: [{ directory: rootDirectory, message: String(error) }],
    };
  }

  for (const entry of entries) {
    const directory = join(rootDirectory, entry);
    let isDirectory: boolean;
    try {
      isDirectory = (deps.statSync ?? statSync)(directory).isDirectory();
    } catch (error) {
      errors.push({
        directory,
        message: `unreadable preset entry: ${String(error)}`,
      });
      continue;
    }
    if (!isDirectory) continue;

    if (!PRESET_NAME_PATTERN.test(entry)) {
      errors.push({ directory, message: `invalid preset name "${entry}"` });
      continue;
    }

    const sources = presetSources(directory, deps.existsSync ?? existsSync);
    if (sources.length === 0) {
      errors.push({
        directory,
        message: "missing atlante.jsonc or atlante.json",
      });
      continue;
    }
    if (sources.length > 1) {
      errors.push({
        directory,
        message: "both atlante.jsonc and atlante.json exist",
      });
      continue;
    }

    presets.push(`${PRESET_NAMESPACE}/${entry}`);
  }

  return { presets, errors };
}

export function readPreset(
  id: string,
  rootDirectory: string = PRESETS_DIR,
  deps: PresetLoaderDeps = {},
): string | undefined {
  if (!listPresets(rootDirectory, deps).presets.includes(id)) return undefined;

  const name = id.slice(`${PRESET_NAMESPACE}/`.length);
  const source = presetSources(
    join(rootDirectory, name),
    deps.existsSync ?? existsSync,
  )[0];
  if (!source) return undefined;

  try {
    return (deps.readFileSync ?? readFileSync)(source, "utf8");
  } catch {
    return undefined;
  }
}
