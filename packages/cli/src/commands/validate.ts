import type { ProjectContext } from "@atlante/builder";
import { validateProject } from "@atlante/builder";
import { hasErrors } from "@atlante/validator";
import { firstPartyProjectContext } from "../first-party-pack.js";
import { printDiagnostics } from "../report.js";

/**
 * Validation deliberately stops short of rendering. Going through the build
 * would render every prompt only to discard it, and — worse — a failure inside
 * a `template.md` would escape as an uncaught exception rather than a
 * diagnostic, reporting "your configuration is broken" when the truth is "our
 * template is broken".
 */
export async function runValidate(
  target: string,
  context: ProjectContext = firstPartyProjectContext(),
): Promise<number> {
  const validated = validateProject(target, context);
  printDiagnostics(validated.diagnostics);
  if (hasErrors(validated.diagnostics)) return 1;

  console.log(`validated ${validated.configPath}`);
  return 0;
}
