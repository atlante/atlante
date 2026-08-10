import { relative } from "node:path";
import type { ResourcePack } from "./content-root.js";
import {
  failResource,
  normalizeResourcePaths,
  ResourceResolutionError,
} from "./errors.js";
import {
  inspectResourceFile,
  type ResolvedResourceTarget,
  type ResourceFile,
  readResourceFile,
  resolveResourceLocator,
  resourceCandidateWatchPaths,
} from "./filesystem.js";
import {
  isSafeJsonObject,
  type JsoncLocation,
  JsoncParseError,
  parseJsoncWithLocations,
  parseJsonWithLocations,
} from "./jsonc.js";
import { JSON_SCHEMA_DRAFT_2020_12_URI } from "./schema.js";
import type {
  BundledResourceOrigin,
  InstanceFacet,
  JsonObject,
  Preset,
  ProjectResourceOrigin,
  RawResourceLocator,
  ResourceOrigin,
  TemplateFacet,
} from "./types.js";

export type ResourceLoadOptions = {
  /** Test/watch integration hook invoked after file preflight and before open. */
  readonly beforeRead?: () => void;
};

export type LoadedResource<T> = Readonly<{
  readonly facet: T;
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
  readonly locations?: Readonly<Record<string, JsoncLocation>>;
}>;

type LoadedFacet = TemplateFacet | InstanceFacet | Preset;

function isJsonObject(value: unknown): value is JsonObject {
  return isSafeJsonObject(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function dependencyPaths(files: readonly ResourceFile[]): string[] {
  return normalizeResourcePaths([
    ...files.map((file) => file.path),
    ...files.flatMap((file) => file.watchPaths),
  ]);
}

function projectOriginPath(
  target: ResolvedResourceTarget,
  file: ResourceFile,
): string {
  if (target.pack.kind === "bundled") {
    const locator = String(target.locator);
    if (locator === "atlante/starter") return `atlante/starter/${file.name}`;
    if (locator.startsWith("atlante/")) {
      return `atlante/${locator.slice("atlante/".length)}/${file.name}`;
    }
    const bundledPath = relative(target.pack.root, file.path).replaceAll(
      "\\",
      "/",
    );
    return `atlante/${bundledPath}`;
  }
  return relative(target.pack.root, file.path).replaceAll("\\", "/");
}

function originFor(
  target: ResolvedResourceTarget,
  file: ResourceFile,
): ResourceOrigin {
  const path = projectOriginPath(target, file);
  if (target.pack.kind === "bundled") {
    return {
      kind: "bundled",
      path: path as unknown as BundledResourceOrigin["path"],
    };
  }
  return {
    kind: "project",
    path: path as unknown as ProjectResourceOrigin["path"],
  };
}

function sourceFailure(
  code: Exclude<
    Parameters<typeof failResource>[0],
    | "resource-cycle"
    | "resource-depth-exceeded"
    | "missing-effective-template"
    | "incompatible-template"
  >,
  message: string,
  target: ResolvedResourceTarget,
  locator: RawResourceLocator,
  file?: ResourceFile,
  dependencies: readonly string[] = [],
  unresolvedParents: readonly string[] = [],
  details: Readonly<{ pointer?: string; location?: JsoncLocation }> = {},
): never {
  return failResource(
    code,
    message,
    {
      locator,
      ...(file ? { source: originFor(target, file) } : {}),
      ...details,
    },
    { dependencies, unresolvedParents },
  );
}

function parseLocation(cause: unknown): JsoncLocation | undefined {
  return cause instanceof JsoncParseError ? cause.location : undefined;
}

function selectedFile(
  target: ResolvedResourceTarget,
  name: ResourceFile["name"],
  locator: RawResourceLocator,
  dependencies: readonly string[] = [],
): ResourceFile {
  const candidateDependencies = resourceCandidateWatchPaths(target, name);
  let file: ResourceFile | undefined;
  try {
    file = inspectResourceFile(target, name, locator);
  } catch (error) {
    if (error instanceof ResourceResolutionError) {
      throw new ResourceResolutionError(error.failure, {
        dependencies: [
          ...dependencies,
          ...candidateDependencies,
          ...error.dependencies,
        ],
        unresolvedParents: [target.directory, ...error.unresolvedParents],
      });
    }
    throw error;
  }
  if (!file) {
    return sourceFailure(
      "missing-target",
      "resource facet file is unavailable",
      target,
      locator,
      undefined,
      [...dependencies, ...candidateDependencies],
      [target.directory],
    );
  }
  return file;
}

function readSelected(
  target: ResolvedResourceTarget,
  file: ResourceFile,
  locator: RawResourceLocator,
  dependencies: readonly string[],
  options: ResourceLoadOptions,
): string {
  const fileDependencies = dependencyPaths([file]);
  try {
    return readResourceFile(target, file, locator, options.beforeRead);
  } catch (error) {
    if (error instanceof ResourceResolutionError) {
      throw new ResourceResolutionError(error.failure, {
        dependencies: [
          ...dependencies,
          ...fileDependencies,
          ...error.dependencies,
        ],
        unresolvedParents: [target.directory, ...error.unresolvedParents],
      });
    }
    return sourceFailure(
      "wrong-target-type",
      "resource facet could not be read",
      target,
      locator,
      file,
      [...dependencies, ...fileDependencies],
      [target.directory],
    );
  }
}

function parseObjectFacet(
  target: ResolvedResourceTarget,
  locator: RawResourceLocator,
  file: ResourceFile,
  source: string,
  invalidMessage: string,
  parser: (source: string) => {
    value: unknown;
    locations: Readonly<Record<string, JsoncLocation>>;
  } = parseJsoncWithLocations,
  dependencies: readonly string[] = [],
): {
  value: JsonObject;
  locations: Readonly<Record<string, JsoncLocation>>;
} {
  let parsed: {
    value: unknown;
    locations: Readonly<Record<string, JsoncLocation>>;
  };
  try {
    parsed = parser(source);
  } catch (cause) {
    return sourceFailure(
      "malformed-jsonc",
      "selected resource JSONC is malformed",
      target,
      locator,
      file,
      normalizeResourcePaths([...dependencies, ...dependencyPaths([file])]),
      [target.directory],
      { location: parseLocation(cause) },
    );
  }
  if (!isJsonObject(parsed.value)) {
    return sourceFailure(
      "invalid-resolved-input",
      invalidMessage,
      target,
      locator,
      file,
      normalizeResourcePaths([...dependencies, ...dependencyPaths([file])]),
      [target.directory],
      { location: parsed.locations[""] },
    );
  }
  return { value: parsed.value, locations: parsed.locations };
}

function loadFresh<T extends LoadedFacet>(
  load: () => {
    readonly facet: T;
    readonly dependencies: readonly string[];
    readonly locations?: Readonly<Record<string, JsoncLocation>>;
  },
): LoadedResource<T> {
  const loaded = load();
  return {
    facet: deepFreeze(loaded.facet),
    dependencies: Object.freeze(normalizeResourcePaths(loaded.dependencies)),
    unresolvedParents: Object.freeze([]),
    ...(loaded.locations
      ? { locations: Object.freeze({ ...loaded.locations }) }
      : {}),
  };
}

function ensureResourceTarget(
  target: ResolvedResourceTarget,
  locator: RawResourceLocator,
): void {
  if (target.kind === "preset") {
    sourceFailure(
      "wrong-target-type",
      "resource target does not provide this facet",
      target,
      locator,
    );
  }
}

export function loadTemplateFacet(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  options: ResourceLoadOptions = {},
): LoadedResource<TemplateFacet> {
  const target = resolveResourceLocator(pack, locator, authoringFile);
  ensureResourceTarget(target, locator);
  return loadFresh(() => {
    const knownFacetCandidates = normalizeResourcePaths([
      ...resourceCandidateWatchPaths(target, "template.jsonc"),
      ...resourceCandidateWatchPaths(target, "template.md"),
    ]);
    const schemaFile = selectedFile(
      target,
      "template.jsonc",
      locator,
      knownFacetCandidates,
    );
    const markdownFile = selectedFile(target, "template.md", locator, [
      ...dependencyPaths([schemaFile]),
    ]);
    const dependencies = dependencyPaths([schemaFile, markdownFile]);
    const schemaText = readSelected(
      target,
      schemaFile,
      locator,
      dependencies,
      options,
    );
    const source = readSelected(
      target,
      markdownFile,
      locator,
      dependencies,
      options,
    );
    let parsed: {
      value: unknown;
      locations: Readonly<Record<string, JsoncLocation>>;
    };
    try {
      parsed = parseJsoncWithLocations(schemaText);
    } catch (cause) {
      return sourceFailure(
        "malformed-jsonc",
        "selected resource JSONC is malformed",
        target,
        locator,
        schemaFile,
        dependencies,
        [target.directory],
        { location: parseLocation(cause) },
      );
    }
    if (!isJsonObject(parsed.value)) {
      return sourceFailure(
        "invalid-template-schema",
        "template facet must be a JSON object",
        target,
        locator,
        schemaFile,
        dependencies,
        [target.directory],
        { location: parsed.locations[""] },
      );
    }
    if (
      !Object.hasOwn(parsed.value, "$schema") ||
      parsed.value.$schema !== JSON_SCHEMA_DRAFT_2020_12_URI
    ) {
      return sourceFailure(
        "invalid-template-schema",
        "template facet must declare JSON Schema Draft 2020-12",
        target,
        locator,
        schemaFile,
        dependencies,
        [target.directory],
        {
          location: parsed.locations["/$schema"] ?? parsed.locations[""],
        },
      );
    }
    return {
      facet: {
        locator: target.locator,
        origin: originFor(target, schemaFile),
        kind: "template",
        inputSchema: parsed.value,
        source,
      },
      dependencies,
      locations: parsed.locations,
    };
  });
}

export function loadInstanceFacet(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  options: ResourceLoadOptions = {},
): LoadedResource<InstanceFacet> {
  const target = resolveResourceLocator(pack, locator, authoringFile);
  ensureResourceTarget(target, locator);
  return loadFresh(() => {
    const file = selectedFile(target, "instance.jsonc", locator);
    const inputText = readSelected(target, file, locator, [], options);
    const parsed = parseObjectFacet(
      target,
      locator,
      file,
      inputText,
      "instance facet must be a JSON object",
    );
    return {
      facet: {
        locator: target.locator,
        origin: originFor(target, file),
        kind: "instance",
        input: parsed.value,
      },
      dependencies: dependencyPaths([file]),
      locations: parsed.locations,
    };
  });
}

type PresetSelection = Readonly<{
  readonly file: ResourceFile;
  readonly dependencies: readonly string[];
}>;

type PresetCandidates = Readonly<{
  readonly jsonc: ResourceFile | undefined;
  readonly json: ResourceFile | undefined;
  readonly knownCandidates: readonly string[];
}>;

function inspectPresetCandidates(
  target: ResolvedResourceTarget,
  locator: RawResourceLocator,
): PresetCandidates {
  const knownCandidates = normalizeResourcePaths([
    ...resourceCandidateWatchPaths(target, "atlante.jsonc"),
    ...resourceCandidateWatchPaths(target, "atlante.json"),
  ]);
  try {
    return {
      jsonc: inspectResourceFile(target, "atlante.jsonc", locator),
      json: inspectResourceFile(target, "atlante.json", locator),
      knownCandidates,
    };
  } catch (error) {
    if (error instanceof ResourceResolutionError) {
      throw new ResourceResolutionError(error.failure, {
        dependencies: [...knownCandidates, ...error.dependencies],
        unresolvedParents: [target.directory, ...error.unresolvedParents],
      });
    }
    throw error;
  }
}

function presetFile(
  target: ResolvedResourceTarget,
  locator: RawResourceLocator,
): PresetSelection {
  const { jsonc, json, knownCandidates } = inspectPresetCandidates(
    target,
    locator,
  );
  if (jsonc && json) {
    return sourceFailure(
      "ambiguous-facet",
      "preset target has multiple root files",
      target,
      locator,
      undefined,
      [...dependencyPaths([jsonc, json]), target.directory],
      [target.directory],
    );
  }
  if (!jsonc && !json) {
    return sourceFailure(
      "missing-target",
      "preset target has no root file",
      target,
      locator,
      undefined,
      knownCandidates,
      [target.directory],
    );
  }
  const file = jsonc ?? json;
  if (!file) {
    return sourceFailure(
      "missing-target",
      "preset target has no root file",
      target,
      locator,
      undefined,
      knownCandidates,
      [target.directory],
    );
  }
  const missingCandidate = jsonc
    ? resourceCandidateWatchPaths(target, "atlante.json")
    : resourceCandidateWatchPaths(target, "atlante.jsonc");
  return {
    file,
    dependencies: normalizeResourcePaths([
      ...dependencyPaths([file]),
      ...missingCandidate,
    ]),
  };
}

export function loadPresetFacet(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  options: ResourceLoadOptions = {},
): LoadedResource<Preset> {
  const target = resolveResourceLocator(pack, locator, authoringFile);
  return loadFresh(() => {
    const selection = presetFile(target, locator);
    const inputText = readSelected(
      target,
      selection.file,
      locator,
      selection.dependencies,
      options,
    );
    const parsed = parseObjectFacet(
      target,
      locator,
      selection.file,
      inputText,
      "preset root must be a JSON object",
      selection.file.name === "atlante.json"
        ? parseJsonWithLocations
        : parseJsoncWithLocations,
      selection.dependencies,
    );
    return {
      facet: {
        locator: target.locator,
        origin: originFor(target, selection.file),
        kind: "preset",
        document: parsed.value,
      },
      dependencies: selection.dependencies,
      locations: parsed.locations,
    };
  });
}
