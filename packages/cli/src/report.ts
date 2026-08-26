import { relative, resolve } from "node:path";
import type { Diagnostic } from "@atlante/validator";
import { formatDiagnostic } from "@atlante/validator";

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
