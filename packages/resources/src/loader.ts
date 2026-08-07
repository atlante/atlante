import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type ParseError, parse } from "jsonc-parser";
import {
  JSON_SCHEMA_DRAFT_2020_12_URI,
  TEMPLATE_NAME_PATTERN,
} from "./schema.js";
import type {
  JsonObject,
  RawResourceLocator,
  RawResourceOrigin,
} from "./types.js";

/**
 * Transitional T2 record for the old composition engine. Its identities are
 * raw strings because this eager migration loader does not validate or
 * resolve resources; T3 factories will produce branded resource identities.
 */
export type TemplateMigrationRecord = {
  readonly id: string;
  readonly locator: RawResourceLocator;
  readonly origin: RawResourceOrigin;
  readonly kind: "template";
  readonly inputSchema: JsonObject;
  readonly source: string;
  readonly directory: string;
};

export type TemplateRegistry = {
  get(id: string): TemplateMigrationRecord | undefined;
  ids(): string[];
};

export type TemplateLoadError = { directory: string; message: string };

export type TemplateLoaderDeps = {
  statSync?: (path: string) => { isDirectory(): boolean };
};

export type FacetOriginKind = "project" | "bundled";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses only the selected JSONC facet; unrelated files are never inspected. */
export function parseJsonc(source: string): unknown {
  const errors: ParseError[] = [];
  const parsed = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (errors.length > 0) {
    throw new Error(`JSONC parse error at offset ${errors[0]?.offset ?? 0}`);
  }
  return parsed;
}

function originFor(
  namespace: string,
  name: string,
  kind: FacetOriginKind,
): RawResourceOrigin {
  const path =
    kind === "bundled"
      ? `atlante/${name}/template.jsonc`
      : `${namespace}/${name}/template.jsonc`;
  return kind === "bundled"
    ? { kind: "bundled", path }
    : { kind: "project", path };
}

function loadOne(
  directory: string,
  id: string,
  namespace: string,
  name: string,
  originKind: FacetOriginKind,
): TemplateMigrationRecord | TemplateLoadError {
  let schemaText: string;
  let source: string;
  try {
    schemaText = readFileSync(join(directory, "template.jsonc"), "utf8");
    source = readFileSync(join(directory, "template.md"), "utf8");
  } catch (error) {
    return {
      directory,
      message: `unreadable template facets: ${String(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = parseJsonc(schemaText);
  } catch (error) {
    return {
      directory,
      message: `malformed template.jsonc: ${String(error)}`,
    };
  }

  if (!isObject(parsed) || parsed.$schema !== JSON_SCHEMA_DRAFT_2020_12_URI) {
    return {
      directory,
      message: `invalid template.jsonc at "$schema": expected JSON Schema Draft 2020-12 (${JSON_SCHEMA_DRAFT_2020_12_URI})`,
    };
  }

  return {
    id,
    locator: id,
    origin: originFor(namespace, name, originKind),
    kind: "template",
    inputSchema: parsed as JsonObject,
    source,
    directory,
  };
}

/**
 * Eagerly scans one template directory for the T2 migration seam. This is
 * transitional and intentionally does not implement T3 selected-locator
 * loading or create validated resource identities.
 */
export function loadTemplateMigrationRegistry(
  rootDirectory: string,
  namespace: string,
  deps: TemplateLoaderDeps = {},
  originKind: FacetOriginKind = "project",
): { registry: TemplateRegistry; errors: TemplateLoadError[] } {
  const templates = new Map<string, TemplateMigrationRecord>();
  const errors: TemplateLoadError[] = [];

  if (!TEMPLATE_NAME_PATTERN.test(namespace)) {
    return {
      registry: { get: () => undefined, ids: () => [] },
      errors: [
        {
          directory: rootDirectory,
          message: `invalid template namespace "${namespace}"`,
        },
      ],
    };
  }

  let entries: string[];
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

    // The bundled root also contains instance facet directories. This
    // transitional migration scan selects only directories that advertise
    // the requested template facet.
    if (
      originKind === "bundled" &&
      !existsSync(join(directory, "template.jsonc"))
    )
      continue;

    if (!TEMPLATE_NAME_PATTERN.test(entry)) {
      errors.push({ directory, message: `invalid template name "${entry}"` });
      continue;
    }

    const id = `${namespace}/${entry}`;
    const loaded = loadOne(directory, id, namespace, entry, originKind);
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
