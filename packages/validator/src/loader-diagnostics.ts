import type { TemplateLoadError } from "@atlante/templates";
import type { Diagnostic } from "./diagnostic.ts";
import { error } from "./diagnostic.ts";

/**
 * Maps loader-level failures (an unreadable, malformed, or duplicate
 * `template.json`) onto the same diagnostic vocabulary every other
 * validation failure uses.
 *
 * `TemplateLoadError` itself stays `{ directory, message }` — no code, no
 * severity — because `@atlante/templates` must not depend on the
 * `Diagnostic` type to remain a dependency-free leaf of the package graph.
 * That left every consumer inventing its own rendering; this is the single
 * place that turns a load error into a diagnostic instead.
 */
export function templateLoadDiagnostics(
  errors: TemplateLoadError[],
): Diagnostic[] {
  return errors.map((templateLoadError) =>
    error(
      "template-load-failed",
      `${templateLoadError.directory}: ${templateLoadError.message}`,
    ),
  );
}
