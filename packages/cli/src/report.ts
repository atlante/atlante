import { relative, resolve } from "node:path";
import type { BuildResult } from "@atlante/builder";
import type { Diagnostic } from "@atlante/validator";
import { formatDiagnostic, hasErrors } from "@atlante/validator";
import { createStyler, type Styler } from "./style.js";

export { formatDiagnostic } from "@atlante/validator";

export function diagnosticPath(path: string): string {
  return relative(process.cwd(), resolve(path)) || ".";
}

/** Colors only the leading severity word; the diagnostic body stays plain. */
function styledDiagnostic(diagnostic: Diagnostic, styler: Styler): string {
  const text = formatDiagnostic(diagnostic);
  const severity = diagnostic.severity;
  if (!text.startsWith(severity)) return text;
  return styler[severity](severity) + text.slice(severity.length);
}

export function printDiagnostic(diagnostic: Diagnostic): void {
  console.error(styledDiagnostic(diagnostic, createStyler(process.stderr)));
}

export function printDiagnostics(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) printDiagnostic(diagnostic);
}

/**
 * Reports a build result: its diagnostics and — only when the build
 * succeeded — the per-host materialized paths. Returns whether the build
 * succeeded, so each command can keep its own failure and success handling.
 */
export function reportBuildResult(
  built: Pick<BuildResult, "diagnostics" | "materializations">,
): boolean {
  const styler = createStyler();
  printDiagnostics(built.diagnostics);
  if (hasErrors(built.diagnostics)) return false;
  for (const { host, writtenPaths, removedPaths } of built.materializations) {
    for (const path of writtenPaths)
      console.log(`${styler.success("wrote")} ${host}: ${styler.dim(path)}`);
    for (const path of removedPaths)
      console.log(`${styler.success("removed")} ${host}: ${styler.dim(path)}`);
  }
  return true;
}
