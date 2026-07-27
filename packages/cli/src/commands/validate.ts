import { DEFAULT_TEMPLATE_ID } from "@atlante/resolver";
import { hasErrors, validateTemplates } from "@atlante/validator";
import { printDiagnostics } from "../report.js";
import { loadCliResources } from "./load.js";

/**
 * Validation deliberately stops short of rendering. Going through `resolve`
 * would render every prompt only to discard it, and — worse — a failure inside
 * a `template.md` would escape as an uncaught exception rather than a
 * diagnostic, reporting "your configuration is broken" when the truth is "our
 * template is broken".
 */
export async function runValidate(target: string): Promise<number> {
  const loaded = loadCliResources(target);
  if (!loaded.document || !loaded.registry) {
    printDiagnostics(loaded.diagnostics);
    return 1;
  }

  const diagnostics = [...loaded.diagnostics];
  if (!hasErrors(diagnostics)) {
    diagnostics.push(
      ...validateTemplates(
        loaded.document,
        loaded.registry,
        DEFAULT_TEMPLATE_ID,
      ),
    );
  }
  printDiagnostics(diagnostics);
  if (hasErrors(diagnostics)) return 1;

  console.log(`ok: ${loaded.path}`);
  return 0;
}
