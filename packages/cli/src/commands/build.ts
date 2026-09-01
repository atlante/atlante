import type { ProjectContext } from "@atlante/builder";
import { buildProject } from "@atlante/builder";
import type { ResourceWatchContext } from "@atlante/validator";
import { firstPartyProjectContext } from "../first-party-pack.js";
import {
  diagnosticPath,
  printDiagnostic,
  reportBuildResult,
} from "../report.js";

export type BuildOutcome = Readonly<{
  readonly code: number;
  readonly resourceWatch?: ResourceWatchContext;
}>;

export function runBuildWithContext(
  target: string,
  context: ProjectContext = firstPartyProjectContext(),
): BuildOutcome {
  try {
    const built = buildProject(target, context);
    if (!reportBuildResult(built))
      return { code: 1, resourceWatch: built.resourceWatch };
    console.log(`built ${built.artifactsPath}`);
    return { code: 0, resourceWatch: built.resourceWatch };
  } catch (cause) {
    printDiagnostic({
      severity: "error",
      code: "build-failed",
      message: "could not build the project",
      source: diagnosticPath(target),
      next: "fix the reported error and run `atlante build` again",
      cause: cause instanceof Error ? cause.message : String(cause),
    });
    return { code: 1 };
  }
}

export function runBuild(target: string): number {
  return runBuildWithContext(target).code;
}
