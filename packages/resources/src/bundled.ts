import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createResourcePack, type ResourcePack } from "./content-root.js";
import { isSafeJsonObject } from "./jsonc.js";
import {
  loadTemplateMigrationRegistry,
  parseJsonc,
  type TemplateLoadError,
} from "./loader.js";
import type {
  JsonObject,
  RawBundledResourceOrigin,
  RawResourceLocator,
} from "./types.js";

function resolveBundledDir(): URL {
  const standalone = new URL("../bundled", import.meta.url);
  if (existsSync(fileURLToPath(standalone))) return standalone;
  return new URL("../../bundled/resources", import.meta.url);
}

export const BUNDLED_RESOURCES_DIR = fileURLToPath(resolveBundledDir());

/** The bundled root is canonicalized once, before any child is selected. */
export const BUNDLED_RESOURCE_PACK = createResourcePack(
  BUNDLED_RESOURCES_DIR,
  "bundled",
);

export function createBundledResourcePack(
  rootDirectory: string = BUNDLED_RESOURCES_DIR,
): ResourcePack {
  return createResourcePack(rootDirectory, "bundled");
}

/** Transitional T2 instance record produced by the eager bundled scan. */
export type BundledInstanceMigrationRecord = {
  readonly id: string;
  readonly directory: string;
  readonly locator: RawResourceLocator;
  readonly origin: RawBundledResourceOrigin;
  readonly kind: "instance";
  readonly input: JsonObject;
};

function bundledOrigin(path: string): RawBundledResourceOrigin {
  return { kind: "bundled", path };
}

/** Transitional T2 eager scan of all bundled template facets. */
export function loadBundledTemplateMigrationRegistry() {
  return loadTemplateMigrationRegistry(
    BUNDLED_RESOURCES_DIR,
    "atlante",
    {},
    "bundled",
  );
}

/** Transitional T2 eager scan of all bundled instance facets. */
export function loadBundledInstanceMigrationRecords(): {
  instances: BundledInstanceMigrationRecord[];
  errors: TemplateLoadError[];
} {
  const instances: BundledInstanceMigrationRecord[] = [];
  const errors: TemplateLoadError[] = [];
  let entries: string[];

  try {
    entries = readdirSync(BUNDLED_RESOURCES_DIR).sort();
  } catch (error) {
    return {
      instances,
      errors: [{ directory: BUNDLED_RESOURCES_DIR, message: String(error) }],
    };
  }

  for (const entry of entries) {
    const directory = join(BUNDLED_RESOURCES_DIR, entry);
    const sourcePath = join(directory, "instance.jsonc");
    if (!existsSync(sourcePath)) continue;

    let source: string;
    let input: unknown;
    try {
      source = readFileSync(sourcePath, "utf8");
      input = parseJsonc(source);
    } catch (error) {
      errors.push({
        directory,
        message: `malformed instance.jsonc: ${String(error)}`,
      });
      continue;
    }
    if (!isSafeJsonObject(input)) {
      errors.push({
        directory,
        message: "invalid instance.jsonc: expected object",
      });
      continue;
    }

    const id = `atlante/${entry}`;
    instances.push({
      id,
      directory,
      locator: id,
      origin: bundledOrigin(`${id}/instance.jsonc`),
      kind: "instance",
      input: input as JsonObject,
    });
  }

  return { instances, errors };
}

/** Transitional T2 eager read of the bundled starter document. */
export function loadBundledStarterMigrationRecord(): {
  preset?: BundledStarterMigrationRecord;
  errors: TemplateLoadError[];
} {
  const sourcePath = join(BUNDLED_RESOURCES_DIR, "atlante.jsonc");
  let document: unknown;
  try {
    document = parseJsonc(readFileSync(sourcePath, "utf8"));
  } catch (error) {
    return {
      errors: [
        {
          directory: BUNDLED_RESOURCES_DIR,
          message: `malformed atlante.jsonc: ${String(error)}`,
        },
      ],
    };
  }
  if (!isSafeJsonObject(document)) {
    return {
      errors: [
        {
          directory: BUNDLED_RESOURCES_DIR,
          message: "invalid atlante.jsonc: expected object",
        },
      ],
    };
  }

  return {
    preset: {
      locator: "atlante/starter",
      origin: bundledOrigin("atlante/starter/atlante.jsonc"),
      kind: "preset",
      document: document as JsonObject,
    },
    errors: [],
  };
}

export type BundledStarterMigrationRecord = {
  readonly locator: RawResourceLocator;
  readonly origin: RawBundledResourceOrigin;
  readonly kind: "preset";
  readonly document: JsonObject;
};
