import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  assertRealProjectRoot,
  type BuildResult,
  buildProject as buildProjectDefault,
  type ProjectContext,
} from "@atlante/builder";
import { openCodeMaterializer } from "@atlante/opencode";
import {
  detectOpenCode,
  type OpenCodeDialect,
  OpenCodeVersionError,
  type OpenCodeVersionProbe,
  parseOpenCodeVersion,
  resolveOpenCodeDialect,
} from "@atlante/opencode/dialect";
import { SCHEMA_URI } from "@atlante/schema";
import { hasErrors, validateDocumentText } from "@atlante/validator";
import {
  FIRST_PARTY_PACKAGE,
  resolveFirstPartyPack,
} from "../first-party-pack.js";
import { printDiagnostics, reportBuildResult } from "../report.js";
import { createStyler } from "../style.js";
import { formatInitError } from "./init-error.js";
import { type OpenCodeMcpPlan, prepareOpenCodeMcp } from "./opencode-mcp.js";
import {
  abortWithRestore,
  type DependencyMutationState,
  defaultPackFileSystem,
  ensurePackInstalled as ensurePackDependencyInstalled,
  locateInstalledPack as locateInstalledPackDependency,
  type PackFileSystem,
  reconcileDependencies,
  reportRollbackFailures,
  rollback,
  type Snapshot,
  snapshot,
} from "./pack-dependencies.js";
import { parsePackLocator, type SelectedPack } from "./pack-locator.js";
import {
  discoverPackPresets,
  type PackPresetSelection,
  selectPackPreset,
} from "./pack-presets.js";
import {
  type PackageManagerRunner,
  runPackageManagerDefault,
} from "./package-manager.js";

export type InitOptions = {
  pack?: string;
  force?: boolean;
  noMcp?: boolean;
  opencodeVersion?: string;
};

type InitFileSystem = PackFileSystem;

type BuildFunction = (target: string, context: ProjectContext) => BuildResult;

const defaultBuildProject: BuildFunction = (target, context) =>
  buildProjectDefault(target, context, {
    materializers: [openCodeMaterializer],
  });

export type InitDependencies = Partial<InitFileSystem> & {
  buildProject?: BuildFunction;
  context?: ProjectContext;
  runPackageManager?: PackageManagerRunner;
  isInteractive?: () => boolean;
  prompt?: (query: string) => Promise<string>;
  opencodeBinary?: string;
  opencodeVersionProbe?: OpenCodeVersionProbe;
};

const defaultFileSystem: InitFileSystem = defaultPackFileSystem;

const defaultIsInteractive = (): boolean => Boolean(process.stdin.isTTY);
const OPENCODE_BINARY = "opencode";
const SUPPORTED_OPENCODE_VERSIONS = "V1 >=1.18.29 <2.0.0 or V2 >=2.0.0 <3.0.0";

function selectOpenCodeDialect(
  options: InitOptions,
  dependencies: Pick<
    InitDependencies,
    "opencodeBinary" | "opencodeVersionProbe"
  >,
): OpenCodeDialect | { error: string } {
  try {
    if (options.opencodeVersion !== undefined)
      return resolveOpenCodeDialect(
        parseOpenCodeVersion(options.opencodeVersion),
      );
    return detectOpenCode(
      dependencies.opencodeBinary ?? OPENCODE_BINARY,
      dependencies.opencodeVersionProbe,
    ).dialect;
  } catch (cause) {
    if (
      options.opencodeVersion === undefined &&
      cause instanceof OpenCodeVersionError &&
      cause.code === "binary-unavailable"
    )
      return "v2";

    const versionError =
      cause instanceof OpenCodeVersionError ? cause : undefined;
    return {
      error: formatInitError(
        versionError?.code === "unsupported-version"
          ? "unsupported-opencode-version"
          : "invalid-opencode-version",
        "could not select an OpenCode configuration dialect",
        {
          expected: SUPPORTED_OPENCODE_VERSIONS,
          next:
            options.opencodeVersion === undefined
              ? "install a supported OpenCode version or pass --opencode-version <version>"
              : "pass a supported semantic version to --opencode-version",
          cause:
            versionError?.message ??
            (cause instanceof Error ? cause.message : String(cause)),
        },
      ),
    };
  }
}

async function defaultPrompt(query: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await readline.question(query);
  } finally {
    readline.close();
  }
}

/** The ignore policy init enforces for generated native outputs and state. */
const GITIGNORE_ENTRIES: readonly string[] = [
  ".opencode/agents/",
  ".opencode/skills/",
  ".atlante/",
];

type GitignorePlan = {
  previous: Snapshot;
  contents: string;
  write: boolean;
};

function bareConfig(preset: string, firstParty = true): string {
  const comment = firstParty
    ? `// Extend the first-party package preset. You can override any value or agent
  // below; your local configuration takes precedence over the inherited one.`
    : `// Extend the selected pack preset. You can override any value or agent below;
  // your local configuration takes precedence over the inherited one.`;
  return `{
  "$schema": "${SCHEMA_URI}",

  ${comment}
  "extends": ${JSON.stringify(preset)},
}
`;
}

/**
 * Prepares the ignore-policy edit: `.gitignore` at the project root ends up
 * with exactly the generated-output entries. Existing content is never
 * reordered or duplicated; missing entries are appended after a single blank
 * line, and a missing or empty file is created with exactly the entries.
 */
function prepareGitignore(
  directory: string,
  fileSystem: InitFileSystem,
): GitignorePlan {
  const path = join(directory, ".gitignore");
  const previous = snapshot(path, fileSystem);
  const contents = previous.exists ? (previous.contents ?? "") : "";
  const present = new Set(contents.split(/\r?\n/).map((line) => line.trim()));
  const missing = GITIGNORE_ENTRIES.filter((entry) => !present.has(entry));
  if (missing.length === 0) return { previous, contents, write: false };

  const base =
    contents.length === 0
      ? ""
      : `${contents.endsWith("\n") ? contents : `${contents}\n`}\n`;
  return { previous, contents: `${base}${missing.join("\n")}\n`, write: true };
}

function mutationErrorMessage(message: string, cause: unknown): string {
  return formatInitError("initialization-failed", message, {
    next: "fix the reported error and run `atlante init` again",
    cause: String(cause),
  });
}

function commitInitFiles(
  flow: InitFlow,
  contents: string,
  before: { target: Snapshot; alternate: Snapshot },
  mcp: OpenCodeMcpPlan | undefined,
  gitignore: GitignorePlan,
): { error?: string } {
  const { changes } = flow.state;
  try {
    changes.push({ path: flow.target, before: before.target });
    flow.fileSystem.writeFileSync(flow.target, contents);

    if (mcp?.write) {
      changes.push({ path: mcp.path, before: mcp.previous });
      flow.fileSystem.writeFileSync(mcp.path, mcp.contents);
    }

    if (gitignore.write) {
      changes.push({ path: flow.gitignore, before: gitignore.previous });
      flow.fileSystem.writeFileSync(flow.gitignore, gitignore.contents);
    }

    if (before.alternate.exists) {
      changes.push({ path: flow.alternate, before: before.alternate });
      flow.fileSystem.unlinkSync(flow.alternate);
    }
  } catch (cause) {
    return {
      error: mutationErrorMessage("could not complete initialization", cause),
    };
  }
  return {};
}

function initPreflightError(
  target: string,
  alternate: string,
  options: InitOptions,
  fileSystem: InitFileSystem,
): string | undefined {
  const existing = [target, alternate].filter(fileSystem.existsSync);
  if (existing.length > 0 && !options.force) {
    return formatInitError(
      "configuration-exists",
      "configuration already exists",
      {
        source: existing.join(" and "),
        expected: "no existing configuration unless --force is provided",
        next: "pass --force to overwrite the existing configuration",
      },
    );
  }
  return undefined;
}

function preflightPreset(
  target: string,
  contents: string,
  context: ProjectContext,
): boolean {
  const validated = validateDocumentText(contents, target, {
    resourceContext: context,
  });
  if (!hasErrors(validated.diagnostics)) return true;
  printDiagnostics(validated.diagnostics);
  return false;
}

function buildAndReport(
  directory: string,
  target: string,
  state: DependencyMutationState,
  fileSystem: InitFileSystem,
  runPackageManager: PackageManagerRunner,
  buildProject: BuildFunction,
  context: ProjectContext,
): number {
  let built: BuildResult;
  try {
    built = buildProject(directory, context);
  } catch (cause) {
    const rollbackErrors = rollback(state.changes, fileSystem);
    const reconcileErrors = reconcileDependencies(state, runPackageManager);
    console.error(
      mutationErrorMessage("could not complete initialization", cause),
    );
    reportRollbackFailures(rollbackErrors, reconcileErrors, state);
    return 1;
  }

  // Rollback runs before any diagnostic is printed: even if the diagnostic
  // reporter itself throws, the filesystem is already restored.
  if (hasErrors(built.diagnostics)) {
    const rollbackErrors = rollback(state.changes, fileSystem);
    const reconcileErrors = reconcileDependencies(state, runPackageManager);
    printDiagnostics(built.diagnostics);
    reportRollbackFailures(rollbackErrors, reconcileErrors, state);
    return 1;
  }
  reportBuildResult(built);
  const styler = createStyler();
  console.log(`${styler.success("created")} ${styler.dim(target)}`);
  console.log(`${styler.success("built")} ${styler.dim(built.projectRoot)}`);
  return 0;
}

/**
 * Ensures the selected third-party pack is declared and installed. The
 * transaction is rooted where init runs: the project manifest is read and
 * snapshotted there and the package manager runs there, while the detected
 * manager comes from the nearest ancestor lockfile (`resolveDependencyRoot`)
 * — package managers scope workspaces from that lockfile, so run from a
 * workspace member they write the shared root lockfile while declaring the
 * dependency in the member manifest. The installed pack is verified where
 * @atlante/resources resolves a project dependency: the project root's own
 * node_modules. Packs that are not declared yet are installed with the
 * detected package manager, which places them in devDependencies; declared
 * packs missing from node_modules are reconciled with a plain install; packs
 * that are already declared and installed are left untouched, so existing
 * declarations are never moved between dependency groups or replaced. Every
 * file the package manager may touch is snapshotted before anything runs.
 */
function ensurePackInstalled(
  directory: string,
  pack: SelectedPack,
  state: DependencyMutationState,
  fileSystem: InitFileSystem,
  runPackageManager: PackageManagerRunner,
): { root: string; entry: string } | { error: string } {
  return ensurePackDependencyInstalled(
    directory,
    pack,
    state,
    fileSystem,
    runPackageManager,
  );
}

/**
 * Locates the installed pack inside node_modules and validates its manifest
 * before any preset is selected.
 */
function locateInstalledPack(
  entry: string,
  pack: SelectedPack,
  fileSystem: InitFileSystem,
): { root: string } | { error: string } {
  return locateInstalledPackDependency(entry, pack, fileSystem);
}

/** Resolves the bundled first-party pack root used for preset discovery. */
function firstPartyPackRoot(): { root: string } | { error: string } {
  try {
    return { root: resolveFirstPartyPack().root };
  } catch (cause) {
    return {
      error: formatInitError(
        "invalid-pack",
        `could not resolve the bundled ${FIRST_PARTY_PACKAGE}`,
        {
          next: "reinstall the Atlante CLI and run `atlante init` again",
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    };
  }
}

/**
 * Ensures a third-party pack is installed and resolves its pack root.
 */
function thirdPartyPackRoot(
  directory: string,
  pack: SelectedPack,
  state: DependencyMutationState,
  fileSystem: InitFileSystem,
  runPackageManager: PackageManagerRunner,
): { root: string } | { error: string } {
  const ensured = ensurePackInstalled(
    directory,
    pack,
    state,
    fileSystem,
    runPackageManager,
  );
  if ("error" in ensured) return ensured;
  return locateInstalledPack(ensured.entry, pack, fileSystem);
}

/**
 * Prepares the pack-selected preset: installs the pack when needed,
 * discovers the presets it provides, and selects one. Dependency-mutation
 * state is snapshotted into `state` so any later failure can be rolled back.
 */
async function preparePack(
  directory: string,
  pack: SelectedPack,
  state: DependencyMutationState,
  fileSystem: InitFileSystem,
  runPackageManager: PackageManagerRunner,
  selection: PackPresetSelection,
): Promise<{ presetLocator: string } | { error: string }> {
  const located =
    pack.packageName === FIRST_PARTY_PACKAGE
      ? // The first-party pack ships with the CLI: no manifest, no install.
        firstPartyPackRoot()
      : thirdPartyPackRoot(
          directory,
          pack,
          state,
          fileSystem,
          runPackageManager,
        );
  if ("error" in located) return located;

  const presets = discoverPackPresets(pack.packageName, located.root);
  const selected = await selectPackPreset(
    pack.packageName,
    presets,
    pack.presetName,
    selection,
  );
  if ("error" in selected) return selected;
  return { presetLocator: selected.locator };
}

/** Everything one init run needs, resolved once up front. */
type InitFlow = Readonly<{
  directory: string;
  target: string;
  alternate: string;
  gitignore: string;
  dialect: OpenCodeDialect;
  fileSystem: InitFileSystem;
  context: ProjectContext;
  runPackageManager: PackageManagerRunner;
  buildProject: BuildFunction;
  selection: PackPresetSelection;
  state: DependencyMutationState;
}>;

type Abort = (mainError?: string) => number;

/**
 * Resolves the pack option, runs the preflight checks, ensures the selected
 * pack is installed, and selects its preset. Returns the generated
 * configuration contents, or a terminal exit code after reporting.
 */
async function prepareConfiguration(
  flow: InitFlow,
  options: InitOptions,
  abort: Abort,
): Promise<number | { contents: string }> {
  assertRealProjectRoot(flow.directory);

  let pack: SelectedPack | undefined;
  if (options.pack !== undefined) {
    const parsed = parsePackLocator(options.pack);
    if ("error" in parsed) {
      console.error(parsed.error);
      return 1;
    }
    pack = parsed;
  }

  const preflightError = initPreflightError(
    flow.target,
    flow.alternate,
    options,
    flow.fileSystem,
  );
  if (preflightError) {
    console.error(preflightError);
    return 1;
  }

  let presetLocator = FIRST_PARTY_PACKAGE;
  if (pack) {
    const prepared = await preparePack(
      flow.directory,
      pack,
      flow.state,
      flow.fileSystem,
      flow.runPackageManager,
      flow.selection,
    );
    if ("error" in prepared) return abort(prepared.error);
    presetLocator = prepared.presetLocator;
    console.log(`selected ${presetLocator}`);
  }

  const contents = bareConfig(presetLocator, !pack);
  if (!preflightPreset(flow.target, contents, flow.context)) return abort();
  return { contents };
}

/**
 * Snapshots the configuration targets, prepares the ignore-policy edit, and
 * commits the configuration files. Every snapshotted file is recorded in the
 * shared state, so a later failure restores the whole pre-init state.
 */
function commitConfiguration(
  flow: InitFlow,
  contents: string,
  options: InitOptions,
  abort: Abort,
): number | { mcp?: OpenCodeMcpPlan } {
  const before = {
    target: snapshot(flow.target, flow.fileSystem),
    alternate: snapshot(flow.alternate, flow.fileSystem),
  };
  let mcp: OpenCodeMcpPlan | undefined;
  if (!options.noMcp) {
    const prepared = prepareOpenCodeMcp(
      flow.directory,
      flow.fileSystem,
      flow.dialect,
    );
    if ("error" in prepared) return abort(prepared.error);
    mcp = prepared;
  }
  const gitignore = prepareGitignore(flow.directory, flow.fileSystem);

  const committed = commitInitFiles(flow, contents, before, mcp, gitignore);
  if (committed.error) return abort(committed.error);
  return { mcp };
}

export async function runInitWithDependencies(
  directory: string,
  options: InitOptions,
  dependencies: InitDependencies = {},
): Promise<number> {
  const selectedDialect = selectOpenCodeDialect(options, dependencies);
  if (typeof selectedDialect !== "string") {
    console.error(selectedDialect.error);
    return 1;
  }

  const fileSystem: InitFileSystem = {
    ...defaultFileSystem,
    ...dependencies,
  };
  const flow: InitFlow = {
    directory,
    target: join(directory, "atlante.jsonc"),
    alternate: join(directory, "atlante.json"),
    gitignore: join(directory, ".gitignore"),
    dialect: selectedDialect,
    fileSystem,
    context: dependencies.context ?? {},
    runPackageManager:
      dependencies.runPackageManager ?? runPackageManagerDefault,
    buildProject: dependencies.buildProject ?? defaultBuildProject,
    selection: {
      isInteractive: dependencies.isInteractive ?? defaultIsInteractive,
      prompt: dependencies.prompt ?? defaultPrompt,
    },
    state: { changes: [] },
  };
  const abort: Abort = (mainError?: string) =>
    abortWithRestore(flow.state, fileSystem, flow.runPackageManager, mainError);

  try {
    const prepared = await prepareConfiguration(flow, options, abort);
    if (typeof prepared === "number") return prepared;

    const committed = commitConfiguration(
      flow,
      prepared.contents,
      options,
      abort,
    );
    if (typeof committed === "number") return committed;

    const result = buildAndReport(
      flow.directory,
      flow.target,
      flow.state,
      fileSystem,
      flow.runPackageManager,
      flow.buildProject,
      flow.context,
    );
    if (result !== 0) return result;
    if (options.noMcp) {
      console.log("skipped OpenCode MCP registration (--no-mcp)");
    } else if (committed.mcp?.registered) {
      console.log(`registered Atlante MCP server in ${committed.mcp.path}`);
    } else if (committed.mcp) {
      console.log(
        `Atlante MCP server is already registered in ${committed.mcp.path}`,
      );
    }
    return 0;
  } catch (cause) {
    return abort(
      formatInitError(
        "initialization-failed",
        "could not initialize the project",
        {
          source: directory,
          next: "fix the reported error and run `atlante init` again",
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    );
  }
}
