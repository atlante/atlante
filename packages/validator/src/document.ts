import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import {
  createProjectResourcePack,
  type JsonObject,
  type ResourceBindingCollectionSpec,
  type ResourcePack,
  type ResourceResolutionContext,
  ResourceResolutionError,
  type ResourceWatchRoot,
  resolveResourceDocument,
} from "@atlante/resources";
import type {
  AnyAtlanteDocument,
  AnyAtlanteDocumentOverlay,
} from "@atlante/schema";
import {
  atlanteDocumentOverlaySchema,
  atlanteDocumentOverlayV02Schema,
  atlanteDocumentSchema,
  atlanteDocumentV02Schema,
  SCHEMA_URI,
  SCHEMA_URI_V02,
} from "@atlante/schema";
import type { Diagnostic, DiagnosticChainEntry } from "./diagnostic.js";
import {
  error,
  escapeJsonPointerSegment,
  sortDiagnostics,
} from "./diagnostic.js";
import { discoverConfigPath } from "./discover.js";
import { locationAtPointer, parseJsonc, positionOf } from "./jsonc.js";
import {
  resourceOriginForDocument,
  validateResolvedDocument,
} from "./templates.js";
import { zodDiagnostics } from "./zod-diagnostics.js";

export type DocumentLoadOptions = {
  cwd?: string;
  statSync?: (
    path: string,
    options: { throwIfNoEntry: false },
  ) => { isDirectory(): boolean } | undefined;
  resourceContext?: ResourceResolutionContext;
};

/**
 * Atlante binding collections and their first-party default templates
 * (SPECIFICATION §7 Bindings). The generic resolver only materializes
 * declared collections; the document layer owns this product semantics.
 */
const atlanteBindingCollections: readonly ResourceBindingCollectionSpec[] = [
  { key: "agents", subject: "agent", defaultTemplate: "@atlante/pack/agent" },
  { key: "skills", subject: "skill", defaultTemplate: "@atlante/pack/skill" },
];

/** Files and parents needed to retry the same resource resolution. */
export type ResourceWatchContext = Readonly<{
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
  /** Explicit resource roots authorized for external watch paths. */
  readonly trustedRoots?: readonly ResourceWatchRoot[];
}>;

function resourceWatchContext(value: {
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
  readonly trustedRoots?: readonly ResourceWatchRoot[];
}): ResourceWatchContext {
  const trustedRoots = (value.trustedRoots ?? []).map((root) =>
    Object.freeze({ ...root }),
  );
  return Object.freeze({
    dependencies: Object.freeze([...value.dependencies]),
    unresolvedParents: Object.freeze([...value.unresolvedParents]),
    ...(trustedRoots.length
      ? { trustedRoots: Object.freeze(trustedRoots) }
      : {}),
  });
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

type OverlayIssue = {
  code?: string;
  message: string;
  path: PropertyKey[];
  keys?: string[];
};

function overlayDiagnostics(
  result: {
    success: false;
    error: { issues: OverlayIssue[] };
  },
  sourcePath: string,
  text: string,
): Diagnostic[] {
  return zodDiagnostics(
    result,
    text,
    {
      code: "invalid-document",
      source: sourceName(sourcePath),
      messagePrefix: `${sourceName(sourcePath)}: `,
    },
    locationAtPointer,
  );
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

function resourceLoadFailure(
  cause: unknown,
  path: string,
  text: string,
  fallbackMessage: string,
): {
  resourceWatch?: ResourceWatchContext;
  diagnostics: Diagnostic[];
} {
  if (cause instanceof ResourceResolutionError)
    return {
      resourceWatch: resourceWatchContext(cause),
      diagnostics: [resourceDiagnostic(cause, path, text)],
    };
  return {
    diagnostics: [
      error("resource-load-failed", fallbackMessage, {
        source: sourceName(path),
      }),
    ],
  };
}

function canonicalDiagnostics(
  parsed:
    | ReturnType<typeof atlanteDocumentSchema.safeParse>
    | ReturnType<typeof atlanteDocumentV02Schema.safeParse>,
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

  const parsed = parseJsonc(text, {
    allowTrailingComma: !isJson,
    disallowComments: isJson,
  });

  if (parsed.errors.length > 0 || parsed.value === undefined) {
    const first = parsed.errors[0];
    return {
      diagnostics: [
        error("invalid-json", `${sourceName(sourcePath)}: malformed JSON`, {
          source: sourceName(sourcePath),
          location: first ? positionOf(text, first.offset) : undefined,
        }),
      ],
    };
  }

  return { raw: parsed.value, diagnostics: [] };
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

export function validateDocumentText(
  text: string,
  sourcePath: string,
  options: DocumentLoadOptions = {},
): {
  document?: AnyAtlanteDocument;
  diagnostics: Diagnostic[];
} {
  const { raw, diagnostics } = parseConfigSource(text, sourcePath);
  if (raw === undefined) return { diagnostics: sortDiagnostics(diagnostics) };
  const parsed = parseOverlay(raw, sourcePath, text);
  if (!parsed.overlay)
    return { diagnostics: sortDiagnostics(parsed.diagnostics) };

  const path = resolve(sourcePath);
  const result = resolveResourceBackedDocument(
    path,
    text,
    { path, projectRoot: dirname(path) },
    parsed.overlay.$schema,
    parsed.overlay as unknown as JsonObject,
    options.resourceContext,
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
  overlay: AnyAtlanteDocumentOverlay | undefined;
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
  overlay: AnyAtlanteDocumentOverlay | undefined;
  diagnostics: Diagnostic[];
} {
  const schemaUri = ownPropertyValue(raw, "$schema");
  const overlaySchema =
    schemaUri === SCHEMA_URI_V02
      ? atlanteDocumentOverlayV02Schema
      : schemaUri === SCHEMA_URI
        ? atlanteDocumentOverlaySchema
        : undefined;
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    overlaySchema === undefined
  ) {
    return {
      overlay: undefined,
      diagnostics: [unsupportedSchemaDiagnostic(sourcePath, text)],
    };
  }

  const result = (overlaySchema ?? atlanteDocumentOverlaySchema).safeParse(raw);
  if (!result.success)
    return {
      overlay: undefined,
      diagnostics: overlayDiagnostics(result, sourcePath, text),
    };

  return { overlay: result.data, diagnostics: [] };
}

type DocumentLocation = { path: string; projectRoot: string };

export type LoadResult = {
  document?: AnyAtlanteDocument;
  path?: string;
  projectRoot?: string;
  resources?: ReturnType<typeof resolveResourceDocument>;
  resourceWatch?: ResourceWatchContext;
  diagnostics: Diagnostic[];
};

function resolveResourceBackedDocument(
  path: string,
  text: string,
  location: DocumentLocation,
  schemaUri: string,
  rootDocument?: JsonObject,
  resourceContext?: ResourceResolutionContext,
): {
  document?: AnyAtlanteDocument;
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
    return {
      ...location,
      ...resourceLoadFailure(
        cause,
        path,
        text,
        "resource root could not be loaded",
      ),
    };
  }

  let resources: ReturnType<typeof resolveResourceDocument>;
  try {
    resources = resolveResourceDocument({
      pack: projectPack,
      rootFile: path,
      ...(rootDocument ? { rootDocument } : {}),
      ...(resourceContext ? { resourceContext } : {}),
      bindingCollections: atlanteBindingCollections,
    });
  } catch (cause) {
    return {
      ...location,
      ...resourceLoadFailure(cause, path, text, "resource resolution failed"),
    };
  }

  const canonicalSchema =
    schemaUri === SCHEMA_URI_V02
      ? atlanteDocumentV02Schema
      : atlanteDocumentSchema;
  const canonical = canonicalSchema.safeParse(resources.document);
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

/** Accepts either a configuration file path or a directory to discover one in. */
export function loadDocument(
  pathOrDirectory: string,
  options: DocumentLoadOptions = {},
): LoadResult {
  const target = resolve(options.cwd ?? process.cwd(), pathOrDirectory);
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
  return resolveResourceBackedDocument(
    path,
    text,
    location,
    parsed.overlay.$schema,
    undefined,
    options.resourceContext,
  );
}
