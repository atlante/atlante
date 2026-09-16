import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  assertRealProjectRoot,
  type BuildResult,
  buildProject as buildProjectDefault,
  type ProjectContext,
} from "@atlante/builder";
import { claudeCodeMaterializer } from "@atlante/claude-code";
import { openCodeMaterializer } from "@atlante/opencode";
import {
  detectOpenCode,
  type OpenCodeDialect,
  OpenCodeVersionError,
  type OpenCodeVersionProbe,
  parseOpenCodeVersion,
  resolveOpenCodeDialect,
} from "@atlante/opencode/dialect";
import {
  type AnyAtlanteDocument,
  type HostsV02,
  hostsV02Schema,
  SCHEMA_URI,
  SCHEMA_URI_V02,
} from "@atlante/schema";
import { hasErrors, validateDocumentText } from "@atlante/validator";
import {
  FIRST_PARTY_PACKAGE,
  resolveFirstPartyPack,
} from "../first-party-pack.js";
import { printDiagnostics, reportBuildResult } from "../report.js";
import { createStyler } from "../style.js";
import { type ClaudeMcpPlan, prepareClaudeMcp } from "./claude-mcp.js";
import { type GitignorePlan, prepareInitGitignore } from "./gitignore.js";
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
  /**
   * Comma-separated host selection to scaffold (subset of the v0.2 contract:
   * opencode, claude-code). Absent scaffolds the default OpenCode document.
   */
  hosts?: string;
};

type InitFileSystem = PackFileSystem;

type BuildFunction = (target: string, context: ProjectContext) => BuildResult;

const defaultBuildProject: BuildFunction = (target, context) =>
  buildProjectDefault(target, context, {
    materializers: [openCodeMaterializer, claudeCodeMaterializer],
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

/**
 * Parses the `--hosts` scaffold selection against the v0.2 contract. Absent
 * scaffolds the default OpenCode document; the resolved document stays
 * authoritative for MCP and ignore decisions downstream.
 */
function parseScaffoldHosts(
  options: InitOptions,
): HostsV02 | { error: string } {
  if (options.hosts === undefined) return ["opencode"];
  const parsed = hostsV02Schema.safeParse(
    options.hosts
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
  if (parsed.success) return parsed.data;
  return {
    error: formatInitError(
      "invalid-hosts",
      `invalid --hosts selection: ${options.hosts}`,
      {
        expected: "a comma-separated subset of opencode,claude-code",
        next: "pass e.g. `--hosts claude-code` or `--hosts opencode,claude-code`",
        cause: parsed.error.issues[0]?.message,
      },
    ),
  };
}

function bareConfig(
  preset: string,
  firstParty = true,
  hosts?: HostsV02,
): string {
  const comment = firstParty
    ? `// Extend the first-party package preset. You can override any value or agent
  // below; your local configuration takes precedence over the inherited one.`
    : `// Extend the selected pack preset. You can override any value or agent below;
  // your local configuration takes precedence over the inherited one.`;
  const claudeSelected = hosts?.includes("claude-code") ?? false;
  const schemaLine = `"$schema": "${claudeSelected ? SCHEMA_URI_V02 : SCHEMA_URI}",`;
  const hostsLine = claudeSelected
    ? `\n  "hosts": ${JSON.stringify(hosts)},`
    : "";
  return `{
  ${schemaLine}
${hostsLine}
  ${comment}
  "extends": ${JSON.stringify(preset)},
}
`;
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
  mcps: readonly {
    path: string;
    previous: Snapshot;
    contents: string;
    write: boolean;
  }[],
  gitignore: GitignorePlan,
): { error?: string } {
  const { changes } = flow.state;
  try {
    changes.push({ path: flow.target, before: before.target });
    flow.fileSystem.writeFileSync(flow.target, contents);

    for (const mcp of mcps) {
      if (!mcp.write) continue;
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
): AnyAtlanteDocument | undefined {
  const validated = validateDocumentText(contents, target, {
    resourceContext: context,
  });
  if (!hasErrors(validated.diagnostics) && validated.document)
    return validated.document;
  printDiagnostics(validated.diagnostics);
  return undefined;
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
  /** OpenCode dialect for MCP registration; undefined when OpenCode is not scaffolded. */
  dialect: OpenCodeDialect | undefined;
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
  scaffoldHosts: HostsV02,
  abort: Abort,
): Promise<number | { contents: string; document: AnyAtlanteDocument }> {
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

  const contents = bareConfig(
    presetLocator,
    !pack,
    scaffoldHosts.includes("claude-code") ? scaffoldHosts : undefined,
  );
  const document = preflightPreset(flow.target, contents, flow.context);
  if (!document) return abort();
  return { contents, document };
}

/**
 * Snapshots the configuration targets, prepares the ignore-policy edit, and
 * commits the configuration files. Every snapshotted file is recorded in the
 * shared state, so a later failure restores the whole pre-init state. MCP
 * registration follows the resolved document's hosts: hosts that are not
 * selected get no configuration writes.
 */
function commitConfiguration(
  flow: InitFlow,
  contents: string,
  document: AnyAtlanteDocument,
  options: InitOptions,
  abort: Abort,
): number | { mcps: { host: string; path: string; registered: boolean }[] } {
  const before = {
    target: snapshot(flow.target, flow.fileSystem),
    alternate: snapshot(flow.alternate, flow.fileSystem),
  };
  const selectedHosts: readonly string[] = document.hosts ?? ["opencode"];
  const plans: {
    host: string;
    plan: OpenCodeMcpPlan | ClaudeMcpPlan;
  }[] = [];
  if (!options.noMcp) {
    if (selectedHosts.includes("opencode")) {
      const prepared = prepareOpenCodeMcp(
        flow.directory,
        flow.fileSystem,
        flow.dialect ?? "v2",
      );
      if ("error" in prepared) return abort(prepared.error);
      plans.push({ host: "OpenCode", plan: prepared });
    }
    if (selectedHosts.includes("claude-code")) {
      const prepared = prepareClaudeMcp(flow.directory, flow.fileSystem);
      if ("error" in prepared) return abort(prepared.error);
      plans.push({ host: "Claude Code", plan: prepared });
    }
  }
  const gitignore = prepareInitGitignore(
    flow.directory,
    document,
    flow.fileSystem,
  );

  const committed = commitInitFiles(
    flow,
    contents,
    before,
    plans.map(({ plan }) => plan),
    gitignore,
  );
  if (committed.error) return abort(committed.error);
  return {
    mcps: plans.map(({ host, plan }) => ({
      host,
      path: plan.path,
      registered: plan.registered,
    })),
  };
}

export async function runInitWithDependencies(
  directory: string,
  options: InitOptions,
  dependencies: InitDependencies = {},
): Promise<number> {
  const scaffoldHosts = parseScaffoldHosts(options);
  if (!Array.isArray(scaffoldHosts)) {
    console.error(scaffoldHosts.error);
    return 1;
  }

  let dialect: OpenCodeDialect | undefined;
  if (scaffoldHosts.includes("opencode")) {
    const selectedDialect = selectOpenCodeDialect(options, dependencies);
    if (typeof selectedDialect !== "string") {
      console.error(selectedDialect.error);
      return 1;
    }
    dialect = selectedDialect;
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
    dialect,
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
    const prepared = await prepareConfiguration(
      flow,
      options,
      scaffoldHosts,
      abort,
    );
    if (typeof prepared === "number") return prepared;

    const committed = commitConfiguration(
      flow,
      prepared.contents,
      prepared.document,
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
      const skippedHosts: readonly string[] = prepared.document.hosts ?? [
        "opencode",
      ];
      if (skippedHosts.includes("opencode")) {
        console.log("skipped OpenCode MCP registration (--no-mcp)");
      }
      if (skippedHosts.includes("claude-code")) {
        console.log("skipped Claude Code MCP registration (--no-mcp)");
      }
    } else {
      for (const mcp of committed.mcps) {
        if (mcp.registered) {
          console.log(`registered Atlante MCP server in ${mcp.path}`);
        } else {
          console.log(
            `Atlante MCP server is already registered in ${mcp.path}`,
          );
        }
      }
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
