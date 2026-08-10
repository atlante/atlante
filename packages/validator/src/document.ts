import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  BUNDLED_RESOURCE_PACK,
  createProjectResourcePack,
  type JsonObject,
  type ResourcePack,
  ResourceResolutionError,
  resolveResourceDocument,
} from "@atlante/resources";
import type { AtlanteDocument, AtlanteDocumentOverlay } from "@atlante/schema";
import {
  atlanteDocumentOverlaySchema,
  atlanteDocumentSchema,
  SCHEMA_URI,
} from "@atlante/schema";
import {
  findNodeAtLocation,
  getNodeValue,
  type ParseError,
  parseTree,
} from "jsonc-parser";
import type { Diagnostic, DiagnosticChainEntry } from "./diagnostic.js";
import {
  error,
  escapeJsonPointerSegment,
  sortDiagnostics,
} from "./diagnostic.js";
import { discoverConfigPath } from "./discover.js";
import {
  resourceOriginForDocument,
  validateResolvedDocument,
} from "./templates.js";

export type DocumentLoadOptions = {
  bundledPack?: ResourcePack;
  statSync?: (
    path: string,
    options: { throwIfNoEntry: false },
  ) => { isDirectory(): boolean } | undefined;
};

/** Files and parents needed to retry the same resource resolution. */
export type ResourceWatchContext = Readonly<{
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
}>;

function resourceWatchContext(value: {
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
}): ResourceWatchContext {
  return Object.freeze({
    dependencies: Object.freeze([...value.dependencies]),
    unresolvedParents: Object.freeze([...value.unresolvedParents]),
  });
}

function positionOf(text: string, offset: number) {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function sourceName(path: string): string {
  return basename(path);
}

function ownPropertyValue(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  return Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function pointerSegments(pointer: string | undefined): string[] {
  if (!pointer || pointer === "" || pointer === "/") return [];
  return pointer
    .split("/")
    .slice(1)
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function locationAtPointer(
  text: string,
  pointer: string | undefined,
): { line: number; column: number } | undefined {
  if (pointer === undefined) return undefined;
  const parseErrors: ParseError[] = [];
  const tree = parseTree(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  const node = tree
    ? findNodeAtLocation(tree, pointerSegments(pointer))
    : undefined;
  return node ? positionOf(text, node.offset) : undefined;
}

type OverlayIssue = {
  code?: string;
  message: string;
  path: PropertyKey[];
  keys?: string[];
};

function pointerForPath(path: readonly PropertyKey[]): string {
  return `/${path.map((segment) => escapeJsonPointerSegment(String(segment))).join("/")}`;
}

function overlayIssuePaths(issue: OverlayIssue): readonly PropertyKey[][] {
  if (issue.code === "unrecognized_keys" && issue.keys)
    return issue.keys.map((key) => [...issue.path, key]);
  return [issue.path];
}

function overlayDiagnostics(
  result: {
    success: false;
    error: { issues: OverlayIssue[] };
  },
  sourcePath: string,
  text: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const issue of result.error.issues) {
    for (const issuePath of overlayIssuePaths(issue)) {
      const path = pointerForPath(issuePath);
      const message =
        issue.code === "unrecognized_keys" && issuePath.at(-1) !== undefined
          ? `unrecognized property ${JSON.stringify(String(issuePath.at(-1)))}`
          : issue.message;
      const key = `${path}\u0000${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(
        error("invalid-document", `${sourceName(sourcePath)}: ${message}`, {
          path,
          pointer: path,
          source: sourceName(sourcePath),
          location: locationAtPointer(text, path),
        }),
      );
    }
  }
  return sortDiagnostics(diagnostics);
}

function stableSource(path: string, fallback: string): string {
  return isAbsolute(path) ? basename(path) || fallback : path;
}

function chainOf(
  chain: ResourceResolutionError["failure"]["chain"],
): readonly DiagnosticChainEntry[] | undefined {
  if (!chain) return undefined;
  return chain.map((node) => ({
    kind: node.kind,
    locator: String(node.locator),
    source: stableSource(String(node.origin.path), String(node.locator)),
  }));
}

function resourceDiagnosticCode(
  failure: ResourceResolutionError["failure"],
): string {
  if (failure.code !== "invalid-resolved-input") return failure.code;
  if (/^(?:binding|preset) value name /.test(failure.message))
    return "invalid-value-reference";
  if (/^(?:binding|preset) value "/.test(failure.message))
    return "non-string-value";
  return failure.code;
}

function resourceDiagnostic(
  failure: ResourceResolutionError,
  rootPath: string,
  rootText: string,
): Diagnostic {
  const pointer = failure.failure.pointer;
  const source = stableSource(
    String(failure.failure.source?.path ?? sourceName(rootPath)),
    sourceName(rootPath),
  );
  return error(
    resourceDiagnosticCode(failure.failure),
    failure.failure.message,
    {
      source,
      ...(pointer ? { path: pointer, pointer } : {}),
      location:
        failure.failure.location ??
        (source === sourceName(rootPath) && pointer
          ? locationAtPointer(rootText, pointer)
          : undefined),
      ...(failure.failure.chain
        ? { chain: chainOf(failure.failure.chain) }
        : {}),
    },
  );
}

function canonicalDiagnostics(
  parsed: ReturnType<typeof atlanteDocumentSchema.safeParse>,
  resources: ReturnType<typeof resolveResourceDocument>,
): Diagnostic[] {
  if (parsed.success) return [];
  const fallback = resourceOriginForDocument(resources);
  return parsed.error.issues.map((issue) => {
    const path = `/${issue.path.map(String).map(escapeJsonPointerSegment).join("/")}`;
    const source = resources.provenance[path] ?? fallback;
    return error(
      "invalid-document",
      `canonical configuration: ${issue.message}`,
      {
        path,
        pointer: path,
        ...(source
          ? {
              source: stableSource(String(source.path), sourceName("document")),
            }
          : {}),
      },
    );
  });
}

/** Shared filename validation + JSON parse pipeline used by both public parsers. */
function parseConfigSource(
  text: string,
  sourcePath: string,
): { raw?: unknown; diagnostics: Diagnostic[] } {
  const filename = basename(sourcePath);
  const isJson = filename === "atlante.json";
  const isJsonc = filename === "atlante.jsonc";
  if (
    (filename.endsWith(".json") || filename.endsWith(".jsonc")) &&
    !isJson &&
    !isJsonc
  ) {
    return {
      diagnostics: [
        error(
          "invalid-config-filename",
          `${sourceName(sourcePath)}: configuration files must be named atlante.json or atlante.jsonc`,
          { source: sourceName(sourcePath) },
        ),
      ],
    };
  }

  const parseErrors: ParseError[] = [];
  const tree = parseTree(text, parseErrors, {
    allowTrailingComma: !isJson,
    disallowComments: isJson,
  });

  if (parseErrors.length > 0 || !tree) {
    const first = parseErrors[0];
    return {
      diagnostics: [
        error("invalid-json", `${sourceName(sourcePath)}: malformed JSON`, {
          source: sourceName(sourcePath),
          location: first ? positionOf(text, first.offset) : undefined,
        }),
      ],
    };
  }

  return { raw: getNodeValue(tree) as unknown, diagnostics: [] };
}

function unsupportedSchemaDiagnostic(
  sourcePath: string,
  text: string,
): Diagnostic {
  const path = "/$schema";
  return error(
    "unsupported-schema",
    `${sourceName(sourcePath)}: unsupported $schema; expected the Atlante document schema`,
    {
      path,
      pointer: path,
      source: sourceName(sourcePath),
      location: locationAtPointer(text, path),
    },
  );
}

function validationSourcePath(
  sourcePath: string,
  options: DocumentLoadOptions,
): string {
  if (sourcePath !== "atlante/starter/atlante.jsonc")
    return resolve(sourcePath);
  return join(
    (options.bundledPack ?? BUNDLED_RESOURCE_PACK).root,
    "atlante.jsonc",
  );
}

export function validateDocumentText(
  text: string,
  sourcePath: string,
  options: DocumentLoadOptions = {},
): { document?: AtlanteDocument; diagnostics: Diagnostic[] } {
  const { raw, diagnostics } = parseConfigSource(text, sourcePath);
  if (raw === undefined) return { diagnostics: sortDiagnostics(diagnostics) };
  const parsed = parseOverlay(raw, sourcePath, text);
  if (!parsed.overlay)
    return { diagnostics: sortDiagnostics(parsed.diagnostics) };

  const path = validationSourcePath(sourcePath, options);
  const result = resolveResourceBackedDocument(
    path,
    text,
    options,
    { path, projectRoot: dirname(path) },
    parsed.overlay as unknown as JsonObject,
  );
  return {
    ...(result.document ? { document: result.document } : {}),
    diagnostics: sortDiagnostics(result.diagnostics),
  };
}

/**
 * Parses a document as an overlay. Resource resolution is deliberately kept
 * out of this function so callers can inspect authoring syntax without
 * loading any referenced source.
 */
export function parseDocumentOverlay(
  text: string,
  sourcePath: string,
): {
  overlay: AtlanteDocumentOverlay | undefined;
  diagnostics: Diagnostic[];
} {
  const { raw, diagnostics } = parseConfigSource(text, sourcePath);
  if (raw === undefined) return { overlay: undefined, diagnostics };
  return parseOverlay(raw, sourcePath, text);
}

function parseOverlay(
  raw: unknown,
  sourcePath: string,
  text: string,
): {
  overlay: AtlanteDocumentOverlay | undefined;
  diagnostics: Diagnostic[];
} {
  const schemaUri = ownPropertyValue(raw, "$schema");
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    schemaUri !== SCHEMA_URI
  ) {
    return {
      overlay: undefined,
      diagnostics: [unsupportedSchemaDiagnostic(sourcePath, text)],
    };
  }

  const result = atlanteDocumentOverlaySchema.safeParse(raw);
  if (!result.success)
    return {
      overlay: undefined,
      diagnostics: overlayDiagnostics(result, sourcePath, text),
    };

  return { overlay: result.data, diagnostics: [] };
}

type DocumentLocation = { path: string; projectRoot: string };

function resolveResourceBackedDocument(
  path: string,
  text: string,
  options: DocumentLoadOptions,
  location: DocumentLocation,
  rootDocument?: JsonObject,
): {
  document?: AtlanteDocument;
  path: string;
  projectRoot: string;
  resources?: ReturnType<typeof resolveResourceDocument>;
  resourceWatch?: ResourceWatchContext;
  diagnostics: Diagnostic[];
} {
  let projectPack: ResourcePack;
  try {
    projectPack = createProjectResourcePack(dirname(path));
  } catch (cause) {
    if (cause instanceof ResourceResolutionError)
      return {
        ...location,
        resourceWatch: resourceWatchContext(cause),
        diagnostics: [resourceDiagnostic(cause, path, text)],
      };
    return {
      ...location,
      diagnostics: [
        error("resource-load-failed", "resource root could not be loaded", {
          source: sourceName(path),
        }),
      ],
    };
  }

  let resources: ReturnType<typeof resolveResourceDocument>;
  try {
    resources = resolveResourceDocument({
      pack: projectPack,
      rootFile: path,
      ...(rootDocument ? { rootDocument } : {}),
      ...(options.bundledPack ? { bundledPack: options.bundledPack } : {}),
    });
  } catch (cause) {
    if (cause instanceof ResourceResolutionError)
      return {
        ...location,
        resourceWatch: resourceWatchContext(cause),
        diagnostics: [resourceDiagnostic(cause, path, text)],
      };
    return {
      ...location,
      diagnostics: [
        error("resource-load-failed", "resource resolution failed", {
          source: sourceName(path),
        }),
      ],
    };
  }

  const canonical = atlanteDocumentSchema.safeParse(resources.document);
  const diagnostics = [
    ...canonicalDiagnostics(canonical, resources),
    ...validateResolvedDocument(resources),
  ];
  const sorted = sortDiagnostics(diagnostics);
  const resourceWatch = resourceWatchContext(resources);
  if (!canonical.success || sorted.some(({ severity }) => severity === "error"))
    return { ...location, resourceWatch, diagnostics: sorted };

  return {
    ...location,
    document: canonical.data,
    resources,
    resourceWatch,
    diagnostics: sorted,
  };
}

/** Accepts either a config file path or a directory to discover one in. */
export function loadDocument(
  pathOrDirectory: string,
  options: DocumentLoadOptions = {},
): {
  document?: AtlanteDocument;
  path?: string;
  projectRoot?: string;
  resources?: ReturnType<typeof resolveResourceDocument>;
  resourceWatch?: ResourceWatchContext;
  diagnostics: Diagnostic[];
} {
  const target = resolve(pathOrDirectory);
  let path = target;
  let isDirectory = false;
  try {
    isDirectory =
      (options.statSync ?? statSync)(target, {
        throwIfNoEntry: false,
      })?.isDirectory() ?? false;
  } catch {
    return {
      diagnostics: [
        error(
          "config-unreadable",
          `cannot inspect ${sourceName(target)}: configuration target is unreadable`,
          { source: sourceName(target) },
        ),
      ],
    };
  }

  if (isDirectory) {
    const discovered = discoverConfigPath(target);
    if (!discovered.path)
      return { diagnostics: sortDiagnostics(discovered.diagnostics) };
    path = discovered.path;
  }

  const filename = basename(path);
  if (filename !== "atlante.json" && filename !== "atlante.jsonc") {
    return {
      diagnostics: [
        error(
          "invalid-config-filename",
          `${sourceName(path)}: configuration files must be named atlante.json or atlante.jsonc`,
          { source: sourceName(path) },
        ),
      ],
    };
  }

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return {
      diagnostics: [
        error(
          "config-unreadable",
          `cannot read ${sourceName(path)}: configuration file is unreadable`,
          { source: sourceName(path) },
        ),
      ],
    };
  }

  const parsed = parseDocumentOverlay(text, path);
  const location = { path, projectRoot: dirname(path) };
  if (!parsed.overlay)
    return { ...location, diagnostics: sortDiagnostics(parsed.diagnostics) };
  return resolveResourceBackedDocument(path, text, options, location);
}
