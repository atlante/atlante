import { basename, isAbsolute } from "node:path";
import type { Diagnostic } from "./diagnostic.js";
import { error } from "./diagnostic.js";

type LoaderFailure = {
  message: string;
  directory?: string;
  source?: string;
  code?: string;
};

function stableSource(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return isAbsolute(value) ? basename(value) : value;
}

/** Transitional mapping for callers that still report generic loader errors. */
export function templateLoadDiagnostics(
  errors: readonly LoaderFailure[],
): Diagnostic[] {
  return errors.map((loaderError) =>
    error(
      loaderError.code ?? "template-load-failed",
      loaderError.message,
      stableSource(loaderError.source ?? loaderError.directory)
        ? { source: stableSource(loaderError.source ?? loaderError.directory) }
        : {},
    ),
  );
}
