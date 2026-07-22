import type { Diagnostic } from "@atlante/validator";
import { formatDiagnostic } from "@atlante/validator";

export { formatDiagnostic } from "@atlante/validator";

export function printDiagnostics(diagnostics: Diagnostic[]): void {
  for (const diagnostic of diagnostics) {
    console.error(formatDiagnostic(diagnostic));
  }
}
