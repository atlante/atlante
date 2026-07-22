import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const PRESETS_DIR = fileURLToPath(
  new URL("../bundled", import.meta.url),
);

export const PRESET_MANIFEST_URI =
  "https://atlante.sh/schema/preset/v0.1/schema.json";

/** `namespace/name`, both segments lowercase alphanumeric with dashes. */
export const PRESET_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9-]+$/;

export const presetManifestSchema = z.strictObject({
  $schema: z.literal(PRESET_MANIFEST_URI),
  id: z.string().regex(PRESET_ID_PATTERN),
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.string().optional(),
});

export type PresetManifest = {
  $schema: string;
  id: string;
  name?: string;
  description?: string;
  version?: string;
};

export type PresetLoadError = { directory: string; message: string };

type PresetLoaderDeps = {
  readdirSync?: (path: string) => string[];
  statSync?: (path: string) => { isDirectory(): boolean };
  readFileSync?: (path: string, encoding: "utf8") => string;
};

/** A preset's short name is the second segment of its `namespace/name` id. */
export function presetName(manifest: PresetManifest): string {
  return manifest.id.split("/")[1] ?? manifest.id;
}

function loadOne(
  directory: string,
  readFile: (path: string, encoding: "utf8") => string,
): PresetManifest | PresetLoadError {
  let manifestText: string;
  try {
    manifestText = readFile(join(directory, "preset.json"), "utf8");
  } catch (error) {
    return { directory, message: `unreadable preset.json: ${String(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (error) {
    return { directory, message: `malformed preset.json: ${String(error)}` };
  }

  const result = presetManifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".") ?? "<root>";
    return {
      directory,
      message: `invalid preset.json at "${path}": ${issue?.message ?? "unknown error"}`,
    };
  }

  return result.data;
}

/**
 * Loads every bundled preset's manifest from `rootDirectory` (one immediate
 * subdirectory per preset). Load failures are collected rather than thrown,
 * mirroring `@atlante/templates`' `loadTemplates`, so a malformed or
 * non-conforming `preset.json` is reported instead of throwing a raw
 * `SyntaxError` (or an unchecked cast) out of a consumer like `atlante init`.
 *
 * This package MUST NOT validate *presets* — a preset is an Atlante document,
 * and validating it belongs to the validator (SPECIFICATION.md §10).
 * Validating the manifest that merely describes a preset (its required `id`
 * and optional metadata) is a different act, the same one
 * `@atlante/templates` already performs on `template.json`.
 */
export function listPresets(
  rootDirectory: string = PRESETS_DIR,
  deps: PresetLoaderDeps = {},
): {
  presets: PresetManifest[];
  errors: PresetLoadError[];
} {
  const presets: PresetManifest[] = [];
  const errors: PresetLoadError[] = [];

  let entries: string[] = [];
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

    if (!existsSync(join(directory, "preset.json"))) {
      errors.push({ directory, message: "missing preset.json" });
      continue;
    }

    const readFile =
      deps.readFileSync ??
      ((path: string, encoding: "utf8") => readFileSync(path, encoding));
    const loaded = loadOne(directory, readFile);
    if ("message" in loaded) {
      errors.push(loaded);
      continue;
    }

    const name = presetName(loaded);
    if (name !== entry) {
      errors.push({
        directory,
        message: `preset directory "${entry}" does not match manifest id short name "${name}"`,
      });
      continue;
    }

    presets.push(loaded);
  }

  return { presets, errors };
}

/**
 * Reads a preset's document source by its short name. `name` is resolved
 * against the set of known bundled preset names before it ever reaches the
 * filesystem, so a caller passing an unsanitized `--preset` value (e.g.
 * `../../../somewhere`) cannot make this read a path outside the selected
 * presets root. The default `atlante.jsonc` is preferred by convention, but
 * `atlante.json` is also supported; both forms together are ambiguous.
 */
export function readPreset(
  name: string,
  rootDirectory: string = PRESETS_DIR,
): string | undefined {
  const known = listPresets(rootDirectory).presets.some(
    (manifest) => presetName(manifest) === name,
  );
  if (!known) return undefined;

  const sources = ["atlante.jsonc", "atlante.json"]
    .map((filename) => join(rootDirectory, name, filename))
    .filter(existsSync);
  if (sources.length !== 1) return undefined;
  const source = sources[0];
  if (!source) return undefined;

  try {
    return readFileSync(source, "utf8");
  } catch {
    return undefined;
  }
}
