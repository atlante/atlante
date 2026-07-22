import { readFileSync, statSync } from "node:fs";
import type { AtlanteDocument } from "@atlante/schema";
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
  const parseErrors: ParseError[] = [];
  const tree = parseTree(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
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

  return { document: result.data as AtlanteDocument, diagnostics: [] };
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
