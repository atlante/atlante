import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  JSON_SCHEMA_DRAFT_2020_12_URI,
  TEMPLATE_NAME_PATTERN,
} from "./schema.js";

export type Template = {
  id: string;
  inputSchema: Record<string, unknown>;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadOne(directory: string, id: string): Template | TemplateLoadError {
  let schemaText: string;
  let source: string;
  try {
    schemaText = readFileSync(join(directory, "template.json"), "utf8");
    source = readFileSync(join(directory, "template.md"), "utf8");
  } catch {
    return {
      directory: id,
      message: "unreadable template facets: template.json or template.md",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(schemaText);
  } catch {
    return { directory: id, message: "malformed template.json" };
  }

  if (
    !isObject(parsed) ||
    !Object.hasOwn(parsed, "$schema") ||
    parsed.$schema !== JSON_SCHEMA_DRAFT_2020_12_URI
  ) {
    return {
      directory: id,
      message: `invalid template.json at "$schema": expected JSON Schema Draft 2020-12 (${JSON_SCHEMA_DRAFT_2020_12_URI})`,
    };
  }

  return { id, inputSchema: parsed, source, directory };
}

export function loadTemplates(
  rootDirectory: string,
  namespace: string,
  deps: TemplateLoaderDeps = {},
): { registry: TemplateRegistry; errors: TemplateLoadError[] } {
  const templates = new Map<string, Template>();
  const errors: TemplateLoadError[] = [];

  if (!TEMPLATE_NAME_PATTERN.test(namespace)) {
    return {
      registry: { get: () => undefined, ids: () => [] },
      errors: [
        {
          directory: namespace,
          message: `invalid template namespace "${namespace}"`,
        },
      ],
    };
  }

  let entries: string[];
  try {
    entries = readdirSync(rootDirectory).sort();
  } catch {
    return {
      registry: { get: () => undefined, ids: () => [] },
      errors: [
        { directory: namespace, message: "template root is unreadable" },
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
        directory: `${namespace}/${entry}`,
        message: "unreadable template entry",
      });
      continue;
    }
    if (!isDirectory) continue;

    if (!TEMPLATE_NAME_PATTERN.test(entry)) {
      errors.push({
        directory: `${namespace}/${entry}`,
        message: `invalid template name "${entry}"`,
      });
      continue;
    }

    const id = `${namespace}/${entry}`;
    const loaded = loadOne(directory, id);
    if ("message" in loaded) {
      errors.push(loaded);
      continue;
    }
    templates.set(id, loaded);
  }

  return {
    registry: {
      get: (id) => templates.get(id),
      ids: () => [...templates.keys()].sort(),
    },
    errors,
  };
}
