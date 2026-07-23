import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { AtlanteDocument, AtlanteDocumentOverlay } from "@atlante/schema";
import { atlanteDocumentSchema, SCHEMA_URI } from "@atlante/schema";
import { getNodeValue, type ParseError, parseTree } from "jsonc-parser";
import type { Diagnostic } from "./diagnostic.ts";
import { error, escapeJsonPointerSegment } from "./diagnostic.ts";
import { discoverConfigPath } from "./discover.ts";

function positionOf(text: string, offset: number) {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

export function validateDocumentText(
  text: string,
  sourcePath: string,
): { document?: AtlanteDocument; diagnostics: Diagnostic[] } {
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
          `${sourcePath}: configuration files must be named atlante.json or atlante.jsonc`,
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
        error("invalid-json", `${sourcePath}: malformed JSON`, {
          location: first ? positionOf(text, first.offset) : undefined,
        }),
      ],
    };
  }

  const raw = getNodeValue(tree) as unknown;
  return validateParsedDocument(raw, sourcePath);
}

function validateParsedDocument(
  raw: unknown,
  sourcePath: string,
): { document?: AtlanteDocument; diagnostics: Diagnostic[] } {
  const schemaUri = (raw as { $schema?: unknown })?.$schema;
  if (schemaUri !== SCHEMA_URI) {
    return {
      diagnostics: [
        error(
          "unsupported-schema",
          `${sourcePath}: unsupported $schema ${JSON.stringify(schemaUri)}; expected ${SCHEMA_URI}`,
          { path: "/$schema" },
        ),
      ],
    };
  }

  const result = atlanteDocumentSchema.safeParse(raw);
  if (!result.success) {
    return {
      diagnostics: result.error.issues.map((issue) =>
        error("invalid-document", `${sourcePath}: ${issue.message}`, {
          path: `/${issue.path.map(String).map(escapeJsonPointerSegment).join("/")}`,
        }),
      ),
    };
  }

  return { document: result.data, diagnostics: [] };
}

/**
 * Parses a document as an overlay — accepts `extends` and tombstone `null`
 * values that would be rejected by the canonical schema. The caller is
 * responsible for expansion and canonical validation afterwards.
 */
export function parseDocumentOverlay(
  text: string,
  sourcePath: string,
): {
  overlay: AtlanteDocumentOverlay | undefined;
  diagnostics: Diagnostic[];
} {
  const filename = basename(sourcePath);
  const isJson = filename === "atlante.json";
  const isJsonc = filename === "atlante.jsonc";
  if (
    (filename.endsWith(".json") || filename.endsWith(".jsonc")) &&
    !isJson &&
    !isJsonc
  ) {
    return {
      overlay: undefined,
      diagnostics: [
        error(
          "invalid-config-filename",
          `${sourcePath}: configuration files must be named atlante.json or atlante.jsonc`,
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
      overlay: undefined,
      diagnostics: [
        error("invalid-json", `${sourcePath}: malformed JSON`, {
          location: first ? positionOf(text, first.offset) : undefined,
        }),
      ],
    };
  }

  const raw = getNodeValue(tree) as unknown;
  return parseOverlay(raw, sourcePath);
}

function parseOverlay(
  raw: unknown,
  sourcePath: string,
): {
  overlay: AtlanteDocumentOverlay | undefined;
  diagnostics: Diagnostic[];
} {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      overlay: undefined,
      diagnostics: [
        error("invalid-json", `${sourcePath}: expected a JSON object`),
      ],
    };
  }

  const obj = raw as Record<string, unknown>;

  const schemaUri = obj.$schema;
  if (schemaUri !== SCHEMA_URI) {
    return {
      overlay: undefined,
      diagnostics: [
        error(
          "unsupported-schema",
          `${sourcePath}: unsupported $schema ${JSON.stringify(schemaUri)}; expected ${SCHEMA_URI}`,
          { path: "/$schema" },
        ),
      ],
    };
  }

  const extends_ =
    typeof obj.extends === "string" && obj.extends.length > 0
      ? obj.extends
      : undefined;

  const values: Record<string, string | null> = Object.create(null);
  if (obj.values !== undefined) {
    if (
      typeof obj.values !== "object" ||
      obj.values === null ||
      Array.isArray(obj.values)
    ) {
      // Diagnose but continue — expansion can handle missing values.
    } else {
      for (const [key, value] of Object.entries(
        obj.values as Record<string, unknown>,
      )) {
        if (value === null || typeof value === "string") {
          values[key] = value;
        }
        // Non-string, non-null values are ignored; canonical validation catches them.
      }
    }
  }

  const agents: Record<string, Record<string, unknown> | null> =
    Object.create(null);
  if (obj.agents !== undefined) {
    if (
      typeof obj.agents !== "object" ||
      obj.agents === null ||
      Array.isArray(obj.agents)
    ) {
      return {
        overlay: undefined,
        diagnostics: [
          error(
            "invalid-document",
            `${sourcePath}: "agents" must be an object`,
            { path: "/agents" },
          ),
        ],
      };
    }

    for (const [agentId, binding] of Object.entries(
      obj.agents as Record<string, unknown>,
    )) {
      if (binding === null) {
        agents[agentId] = null;
      } else if (typeof binding === "object" && !Array.isArray(binding)) {
        const agentBinding = binding as Record<string, unknown>;

        const agentValues: Record<string, string | null> = {};
        if (
          agentBinding.values !== undefined &&
          typeof agentBinding.values === "object" &&
          agentBinding.values !== null &&
          !Array.isArray(agentBinding.values)
        ) {
          for (const [key, value] of Object.entries(
            agentBinding.values as Record<string, unknown>,
          )) {
            if (value === null || typeof value === "string") {
              agentValues[key] = value;
            }
          }
        }

        const base: Record<string, unknown> = { ...agentBinding };

        // Only include `values` when the raw binding had one or we found values.
        if (Object.keys(agentValues).length > 0) {
          base.values = agentValues;
        } else if (!Object.hasOwn(agentBinding, "values")) {
          delete base.values;
        }

        agents[agentId] = base;
      }
      // Non-object, non-null values are ignored; canonical validation catches them.
    }
  }

  return {
    overlay: {
      $schema: schemaUri as string,
      extends: extends_,
      values: Object.keys(values).length > 0 ? values : undefined,
      agents: agents as AtlanteDocumentOverlay["agents"],
    },
    diagnostics: [],
  };
}

/** Accepts either a config file path or a directory to discover one in. */
type LoadDocumentDeps = {
  statSync?: (
    path: string,
    options: { throwIfNoEntry: false },
  ) => { isDirectory(): boolean } | undefined;
};

export function loadDocument(
  pathOrDirectory: string,
  deps: LoadDocumentDeps = {},
): {
  document?: AtlanteDocument;
  path?: string;
  diagnostics: Diagnostic[];
} {
  let path = pathOrDirectory;
  let isDirectory = false;
  try {
    isDirectory =
      (deps.statSync ?? statSync)(pathOrDirectory, {
        throwIfNoEntry: false,
      })?.isDirectory() ?? false;
  } catch (cause) {
    return {
      diagnostics: [
        error(
          "config-unreadable",
          `cannot inspect ${pathOrDirectory}: ${String(cause)}`,
        ),
      ],
    };
  }

  if (isDirectory) {
    const discovered = discoverConfigPath(pathOrDirectory);
    if (!discovered.path) return { diagnostics: discovered.diagnostics };
    path = discovered.path;
  }

  const filename = basename(path);
  if (filename !== "atlante.json" && filename !== "atlante.jsonc") {
    return {
      diagnostics: [
        error(
          "invalid-config-filename",
          `${path}: configuration files must be named atlante.json or atlante.jsonc`,
        ),
      ],
    };
  }

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    return {
      diagnostics: [
        error("config-unreadable", `cannot read ${path}: ${String(cause)}`),
      ],
    };
  }

  return { ...validateDocumentText(text, path), path };
}
