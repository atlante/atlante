export type DiagnosticChainEntry = {
  kind: "preset" | "instance" | "template";
  locator: string;
  source: string;
};

export type Diagnostic = {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** JSON pointer into the document, when the diagnostic has one. */
  path?: string;
  /** Stable resource identity, relative to the project or package root. */
  source?: string;
  /** Explicit JSON Pointer alias used by source/resource diagnostics. */
  pointer?: string;
  location?: { line: number; column: number };
  /** Complete resource traversal when the resolver supplied one. */
  chain?: readonly DiagnosticChainEntry[];
  /** Contract the authored input must satisfy, when useful for recovery. */
  expected?: string;
  /** One deterministic recovery action, when available. */
  next?: string;
  /** Normalized low-level cause, reported last. */
  cause?: string;
};

/** Escapes one JSON Pointer segment (RFC 6901). */
export function escapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function formatDiagnostic(diagnostic: Diagnostic): string {
  const lines = [
    `${diagnostic.severity} [${diagnostic.code}]: ${diagnostic.message}`,
  ];
  const path = diagnostic.path ?? diagnostic.pointer;
  const source = diagnostic.source ?? "";
  const where = diagnostic.location
    ? `${source ? `${source}:` : ""}${diagnostic.location.line}:${diagnostic.location.column}`
    : source;
  const location = [where, path].filter(Boolean).join(" ");
  if (location) lines.push(`at: ${location}`);
  if (diagnostic.expected) lines.push(`expected: ${diagnostic.expected}`);
  if (diagnostic.next) lines.push(`next: ${diagnostic.next}`);
  if (diagnostic.cause) lines.push(`cause: ${diagnostic.cause}`);
  return lines.join("\n");
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

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const leftCode = left.charCodeAt(index);
    const rightCode = right.charCodeAt(index);
    if (leftCode !== rightCode) return leftCode - rightCode;
  }
  return left.length - right.length;
}

function firstNonZero(values: readonly number[]): number {
  for (const value of values) {
    if (value !== 0) return value;
  }
  return 0;
}

function diagnosticSource(diagnostic: Diagnostic): string {
  return diagnostic.source ?? "";
}

function diagnosticPointer(diagnostic: Diagnostic): string {
  return diagnostic.path ?? diagnostic.pointer ?? "";
}

function diagnosticLine(diagnostic: Diagnostic): number {
  return diagnostic.location?.line ?? 0;
}

function diagnosticColumn(diagnostic: Diagnostic): number {
  return diagnostic.location?.column ?? 0;
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return firstNonZero([
    compareCodeUnits(diagnosticSource(left), diagnosticSource(right)),
    compareCodeUnits(diagnosticPointer(left), diagnosticPointer(right)),
    diagnosticLine(left) - diagnosticLine(right),
    diagnosticColumn(left) - diagnosticColumn(right),
    compareCodeUnits(left.code, right.code),
    compareCodeUnits(left.message, right.message),
  ]);
}

/** Sorts diagnostics by authored location, then stable source identity. */
export function sortDiagnostics<T extends Diagnostic>(
  diagnostics: readonly T[],
): T[] {
  return [...diagnostics].sort(compareDiagnostics);
}
