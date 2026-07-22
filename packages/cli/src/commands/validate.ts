import { DEFAULT_TEMPLATE_ID } from "@atlante/resolver";
import { loadBundledTemplates } from "@atlante/templates";
import {
  hasErrors,
  loadDocument,
  templateLoadDiagnostics,
  validateTemplates,
} from "@atlante/validator";
import { printDiagnostics } from "../report.ts";

/**
 * Validation deliberately stops short of rendering. Going through `resolve`
 * would render every prompt only to discard it, and — worse — a failure inside
 * a `template.md` would escape as an uncaught exception rather than a
 * diagnostic, reporting "your configuration is broken" when the truth is "our
 * template is broken".
 */
export async function runValidate(target: string): Promise<number> {
  const loaded = loadDocument(target);
  if (!loaded.document) {
    printDiagnostics(loaded.diagnostics);
    return 1;
  }

  const { registry, errors } = loadBundledTemplates();
  if (errors.length > 0) {
    printDiagnostics(templateLoadDiagnostics(errors));
    return 1;
  }

  const diagnostics = validateTemplates(
    loaded.document,
    registry,
    DEFAULT_TEMPLATE_ID,
  );
  printDiagnostics(diagnostics);
  if (hasErrors(diagnostics)) return 1;

  console.log(`ok: ${loaded.path}`);
  return 0;
}
