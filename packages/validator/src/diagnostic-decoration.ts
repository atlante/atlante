import type {
  ResolvedResourceBinding,
  ResolvedTemplate,
  ResourceOrigin,
} from "@atlante/resources";
import type { Diagnostic } from "./diagnostic.js";
import { escapeJsonPointerSegment } from "./diagnostic.js";

function originPath(origin: ResourceOrigin | undefined): string | undefined {
  return origin?.path as string | undefined;
}

function sourceAt(
  binding: ResolvedResourceBinding,
  pointer: string,
  fallback: ResourceOrigin | undefined,
): string | undefined {
  return originPath(binding.provenance[pointer] ?? fallback);
}

/** Adds stable source metadata without changing the diagnostic identity. */
export function decorateResourceDiagnostic(
  diagnostic: Diagnostic,
  binding: ResolvedResourceBinding,
  template: ResolvedTemplate,
  root: "agents" | "skills",
): Diagnostic {
  const prefix = `/${root}/${escapeJsonPointerSegment(binding.id)}`;
  const relative = diagnostic.path?.startsWith(prefix)
    ? diagnostic.path.slice(prefix.length) || ""
    : "";
  const source =
    diagnostic.source ?? sourceAt(binding, relative, template.origin);
  return {
    ...diagnostic,
    ...(source ? { source } : {}),
    ...(diagnostic.path ? { pointer: diagnostic.path } : {}),
  };
}
