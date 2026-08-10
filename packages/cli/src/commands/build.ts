import { buildProject } from "@atlante/builder";
import { hasErrors, type ResourceWatchContext } from "@atlante/validator";
import { printDiagnostics } from "../report.js";

export type BuildOutcome = Readonly<{
  readonly code: number;
  readonly resourceWatch?: ResourceWatchContext;
}>;

export function runBuildWithContext(target: string): BuildOutcome {
  try {
    const built = buildProject(target);
    printDiagnostics(built.diagnostics);
    if (hasErrors(built.diagnostics))
      return { code: 1, resourceWatch: built.resourceWatch };

    console.log(`built ${built.artifactsPath}`);
    for (const warning of built.warnings)
      console.error(`warning: ${warning.message}`);
    return { code: 0, resourceWatch: built.resourceWatch };
  } catch (cause) {
    console.error(
      `error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    return { code: 1 };
  }
}

export function runBuild(target: string): number {
  return runBuildWithContext(target).code;
}
