import { InvalidArgumentError } from "commander";
import {
  type ImportDependencies,
  type ImportKind,
  type ImportOptions,
  runImportWithDependencies,
} from "./import-internal.js";

export type {
  ImportDependencies,
  ImportKind,
  ImportOptions,
} from "./import-internal.js";

export function parseImportKind(value: string): ImportKind {
  if (value === "agent" || value === "skill") return value;
  throw new InvalidArgumentError(
    `expected "agent" or "skill", received "${value}"`,
  );
}

/** Runs the deterministic Markdown-to-local-pack importer. */
export function runImport(
  input: string,
  outputDirectory: string,
  options: ImportOptions,
  dependencies: ImportDependencies = {},
): number {
  return runImportWithDependencies(
    input,
    outputDirectory,
    options,
    dependencies,
  );
}
