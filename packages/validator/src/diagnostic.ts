export type Diagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** JSON pointer into the document, when the diagnostic has one. */
  path?: string;
  location?: { line: number; column: number };
};

/** Escapes one JSON Pointer segment (RFC 6901). */
export function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const where = diagnostic.location
    ? `:${diagnostic.location.line}:${diagnostic.location.column}`
    : "";
  const path = diagnostic.path ? ` at ${diagnostic.path}` : "";
  return `${diagnostic.severity}${where}: [${diagnostic.code}] ${diagnostic.message}${path}`;
}

export function error(
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic {
  return { severity: "error", code, message, ...extra };
}

export function warning(
  code: string,
  message: string,
  extra: Partial<Diagnostic> = {},
): Diagnostic {
  return { severity: "warning", code, message, ...extra };
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}
