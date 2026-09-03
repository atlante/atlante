import type { Diagnostic } from "./diagnostic.js";
import {
  error,
  escapeJsonPointerSegment,
  sortDiagnostics,
} from "./diagnostic.js";

type ZodIssueLike = {
  code?: string;
  message: string;
  path: PropertyKey[];
  keys?: string[];
};

type ZodFailureLike = {
  success: false;
  error: { issues: ZodIssueLike[] };
};

function pointerForPath(path: readonly PropertyKey[]): string {
  return `/${path.map((segment) => escapeJsonPointerSegment(String(segment))).join("/")}`;
}

function issuePaths(issue: ZodIssueLike): readonly PropertyKey[][] {
  if (issue.code === "unrecognized_keys" && issue.keys)
    return issue.keys.map((key) => [...issue.path, key]);
  return [issue.path];
}

/**
 * Shared Zod-issue to standard-diagnostics translation used by every JSON
 * document parser: unknown properties fan out per key, pointers are RFC 6901,
 * and locations come from the JSONC parse tree.
 */
export function zodDiagnostics(
  failure: ZodFailureLike,
  text: string,
  options: { code: string; source: string; messagePrefix?: string },
  locationAtPointer: (
    text: string,
    pointer: string,
  ) => { line: number; column: number } | undefined,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const issue of failure.error.issues) {
    for (const issuePath of issuePaths(issue)) {
      const pointer = pointerForPath(issuePath);
      const message =
        issue.code === "unrecognized_keys" && issuePath.at(-1) !== undefined
          ? `unrecognized property ${JSON.stringify(String(issuePath.at(-1)))}`
          : issue.message;
      const key = `${pointer}\u0000${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnostics.push(
        error(options.code, `${options.messagePrefix ?? ""}${message}`, {
          path: pointer,
          pointer,
          source: options.source,
          location: locationAtPointer(text, pointer),
        }),
      );
    }
  }
  return sortDiagnostics(diagnostics);
}
