import type { ProjectContext } from "@atlante/builder";
import { buildProject } from "@atlante/builder";
import { claudeCodeMaterializer } from "@atlante/claude-code";
import { openCodeMaterializer } from "@atlante/opencode";
import type { ResourceWatchContext } from "@atlante/validator";
import { firstPartyProjectContext } from "../first-party-pack.js";
import {
  diagnosticPath,
  printDiagnostic,
  reportBuildResult,
} from "../report.js";
import { createStyler } from "../style.js";
import {
  defaultGitignoreEntriesForBuild,
  missingGitignoreDiagnostics,
} from "./gitignore.js";

export type BuildOutcome = Readonly<{
  readonly code: number;
  readonly resourceWatch?: ResourceWatchContext;
}>;

export type BuildCommandOptions = Readonly<{
  /** When true, plan without publishing any files. */
  dryRun?: boolean;
}>;

export function runBuildWithContext(
  target: string,
  context: ProjectContext = firstPartyProjectContext(),
  options?: BuildCommandOptions,
): BuildOutcome {
  try {
    const dryRun = options?.dryRun === true;
    const built = buildProject(target, context, {
      materializers: [openCodeMaterializer, claudeCodeMaterializer],
      ...(dryRun ? { dryRun: true as const } : {}),
    });
    if (
      !reportBuildResult(built, dryRun ? { dryRun: true as const } : undefined)
    )
      return { code: 1, resourceWatch: built.resourceWatch };
    const writtenPaths = built.materializations.flatMap(
      ({ writtenPaths }) => writtenPaths,
    );
    for (const diagnostic of missingGitignoreDiagnostics(
      built.projectRoot,
      defaultGitignoreEntriesForBuild(built.projectRoot, writtenPaths),
    ))
      printDiagnostic(diagnostic);
    const styler = createStyler();
    console.log(
      `${styler.success(dryRun ? "would build" : "built")} ${styler.dim(built.projectRoot)}`,
    );
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

export function runBuild(
  target: string,
  options?: BuildCommandOptions,
): number {
  return runBuildWithContext(target, undefined, options).code;
}
