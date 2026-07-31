import { buildProject } from "@atlante/builder";
import { hasErrors } from "@atlante/validator";
import { printDiagnostics } from "../report.js";

export function runBuild(target: string): number {
  try {
    const built = buildProject(target);
    printDiagnostics(built.diagnostics);
    if (hasErrors(built.diagnostics)) return 1;

    console.log(`built ${built.artifactsPath}`);
    for (const warning of built.warnings)
      console.error(`warning: ${warning.message}`);
    return 0;
  } catch (cause) {
    console.error(
      `error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return 1;
  }
}
