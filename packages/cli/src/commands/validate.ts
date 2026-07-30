import { validateProject } from "@atlante/builder";
import { hasErrors } from "@atlante/validator";
import { printDiagnostics } from "../report.js";

/**
 * Validation deliberately stops short of rendering. Going through the build
 * would render every prompt only to discard it, and — worse — a failure inside
 * a `template.md` would escape as an uncaught exception rather than a
 * diagnostic, reporting "your configuration is broken" when the truth is "our
 * template is broken".
 */
export async function runValidate(target: string): Promise<number> {
  const validated = validateProject(target);
  printDiagnostics(validated.diagnostics);
  if (hasErrors(validated.diagnostics)) return 1;

  console.log(`ok: ${validated.configPath}`);
  return 0;
}
