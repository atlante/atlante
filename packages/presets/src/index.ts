// fallow-ignore-file code-duplication -- retained preset migration compatibility remains until Cleanup

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

function resolveBundledDir(): URL {
  // Standalone package (source or built dist): <pkg>/bundled.
  const standalone = new URL("../bundled", import.meta.url);
  if (existsSync(fileURLToPath(standalone))) return standalone;
  // Inlined into the CLI bundle at <cli>/dist/bin/atlante.js:
  // <cli>/bundled/presets (copied by scripts/build.ts).
  return new URL("../../bundled/presets", import.meta.url);
}

export const PRESETS_DIR = fileURLToPath(resolveBundledDir());
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
  } catch {
    return {
      presets,
      errors: [
        { directory: PRESET_NAMESPACE, message: "preset root is unreadable" },
      ],
    };
  }

  for (const entry of entries) {
    const directory = join(rootDirectory, entry);
    let isDirectory: boolean;
    try {
      isDirectory = (deps.statSync ?? statSync)(directory).isDirectory();
    } catch {
      errors.push({
        directory: `${PRESET_NAMESPACE}/${entry}`,
        message: "unreadable preset entry",
      });
      continue;
    }
    if (!isDirectory) continue;

    if (!PRESET_NAME_PATTERN.test(entry)) {
      errors.push({
        directory: `${PRESET_NAMESPACE}/${entry}`,
        message: `invalid preset name "${entry}"`,
      });
      continue;
    }

    const sources = presetSources(directory, deps.existsSync ?? existsSync);
    if (sources.length === 0) {
      errors.push({
        directory: `${PRESET_NAMESPACE}/${entry}`,
        message: "missing atlante.jsonc or atlante.json",
      });
      continue;
    }
    if (sources.length > 1) {
      errors.push({
        directory: `${PRESET_NAMESPACE}/${entry}`,
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
