import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TemplateManifest } from "./manifest.ts";
import { templateManifestSchema } from "./manifest.ts";

export type Template = {
  manifest: TemplateManifest;
  source: string;
  directory: string;
};

export type TemplateRegistry = {
  get(id: string): Template | undefined;
  ids(): string[];
};

export type TemplateLoadError = { directory: string; message: string };

type TemplateLoaderDeps = {
  statSync?: (path: string) => { isDirectory(): boolean };
};

function loadOne(directory: string): Template | TemplateLoadError {
  let manifestText: string;
  let source: string;
  try {
    manifestText = readFileSync(join(directory, "template.json"), "utf8");
    source = readFileSync(join(directory, "template.md"), "utf8");
  } catch (error) {
    return { directory, message: `unreadable template: ${String(error)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch (error) {
    return { directory, message: `malformed template.json: ${String(error)}` };
  }

  const result = templateManifestSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".") ?? "<root>";
    return {
      directory,
      message: `invalid template.json at "${path}": ${issue?.message ?? "unknown error"}`,
    };
  }

  return { manifest: result.data as TemplateManifest, source, directory };
}

/**
 * Loads every immediate subdirectory of `rootDirectory` as a template.
 * Load failures are collected rather than thrown so the validator can turn
 * them into diagnostics.
 */
export function loadTemplates(
  rootDirectory: string,
  deps: TemplateLoaderDeps = {},
): {
  registry: TemplateRegistry;
  errors: TemplateLoadError[];
} {
  const templates = new Map<string, Template>();
  const errors: TemplateLoadError[] = [];

  let entries: string[] = [];
  try {
    entries = readdirSync(rootDirectory).sort();
  } catch (error) {
    return {
      registry: { get: () => undefined, ids: () => [] },
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
        message: `unreadable template entry: ${String(error)}`,
      });
      continue;
    }
    if (!isDirectory) continue;

    const loaded = loadOne(directory);
    if ("message" in loaded) {
      errors.push(loaded);
      continue;
    }

    const existing = templates.get(loaded.manifest.id);
    if (existing) {
      errors.push({
        directory,
        message: `duplicate template id "${loaded.manifest.id}": "${directory}" collides with "${existing.directory}"`,
      });
      continue;
    }

    templates.set(loaded.manifest.id, loaded);
  }

  return {
    registry: {
      get: (id) => templates.get(id),
      ids: () => [...templates.keys()].sort(),
    },
    errors,
  };
}
