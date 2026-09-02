import { relative, resolve } from "node:path";
import type { BuildResult } from "@atlante/builder";
import type { Diagnostic } from "@atlante/validator";
import { formatDiagnostic, hasErrors } from "@atlante/validator";

export { formatDiagnostic } from "@atlante/validator";

export function diagnosticPath(path: string): string {
  return relative(process.cwd(), resolve(path)) || ".";
}

export function printDiagnostic(diagnostic: Diagnostic): void {
  console.error(formatDiagnostic(diagnostic));
}

export function printDiagnostics(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) printDiagnostic(diagnostic);
}

/**
 * Reports a build result: its diagnostics and — only when the build
 * succeeded — the per-host materialized paths and the legacy artifact-tree
 * migration. Returns whether the build succeeded, so each command can keep
 * its own failure and success handling.
 */
export function reportBuildResult(
  built: Pick<
    BuildResult,
    "diagnostics" | "materializations" | "migratedLegacyArtifacts"
  >,
): boolean {
  printDiagnostics(built.diagnostics);
  if (hasErrors(built.diagnostics)) return false;
  for (const { host, writtenPaths, removedPaths } of built.materializations) {
    for (const path of writtenPaths) console.log(`wrote ${host}: ${path}`);
    for (const path of removedPaths) console.log(`removed ${host}: ${path}`);
  }
  if (built.migratedLegacyArtifacts)
    console.log(`removed ${built.migratedLegacyArtifacts.removedPath}`);
  return true;
}
