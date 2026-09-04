import {
  existsSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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
  createPackageResourcePack,
  isPackageDeclared,
} from "@atlante/resources";
import { SCHEMA_URI } from "@atlante/schema";
import { hasErrors, validateDocumentText } from "@atlante/validator";
import {
  applyEdits,
  modify,
  type ParseError,
  parse,
  printParseErrorCode,
} from "jsonc-parser";
import {
  FIRST_PARTY_PACKAGE,
  resolveFirstPartyPack,
} from "../first-party-pack.js";
import {
  printDiagnostic,
  printDiagnostics,
  reportBuildResult,
} from "../report.js";
import { createStyler } from "../style.js";
import { formatInitError } from "./init-error.js";
import { parsePackLocator, type SelectedPack } from "./pack-locator.js";
import {
  discoverPackPresets,
  type PackPresetSelection,
  selectPackPreset,
} from "./pack-presets.js";
import {
  detectPackageManager,
  type PackageManager,
  type PackageManagerRunner,
  packageManagerAddArgs,
  packageManagerCommand,
  packageManagerInstallArgs,
  packageManagerLockfiles,
  resolveDependencyRoot,
  runPackageManagerDefault,
} from "./package-manager.js";

export type InitOptions = { pack?: string; force?: boolean };

type InitFileSystem = {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
  writeFileSync: (path: string, contents: string) => void;
  unlinkSync: (path: string) => void;
  realpathSync: (path: string) => string;
};

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
};

const defaultFileSystem: InitFileSystem = {
  existsSync,
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync: (path, contents) => writeFileSync(path, contents),
  unlinkSync,
  realpathSync,
};

const defaultIsInteractive = (): boolean => Boolean(process.stdin.isTTY);

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

type Snapshot = { exists: boolean; contents?: string };

const ATLANTE_PLUGIN_ID = "@atlante/opencode";

/** The ignore policy init enforces for generated native outputs and state. */
const GITIGNORE_ENTRIES: readonly string[] = [
  ".opencode/agents/",
  ".opencode/skills/",
  ".atlante/",
];

type PluginOptions = Record<string, unknown>;
type PluginEntry = string | [string, PluginOptions];
type PluginPlan = {
  previous: Snapshot;
  contents: string;
  /** An existing Atlante plugin entry was removed from the configuration. */
  removed: boolean;
  /** The configuration file must be written: it is created or edited. */
  write: boolean;
};

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPluginEntry(value: unknown): value is PluginEntry {
  if (typeof value === "string") return true;
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    isObject(value[1])
  );
}

function pluginId(entry: PluginEntry): string {
  return typeof entry === "string" ? entry : entry[0];
}

function parseErrorSummary(text: string, errors: ParseError[]): string {
  return errors
    .map((parseError) => {
      const line = text.slice(0, parseError.offset).split("\n").length;
      return `${printParseErrorCode(parseError.error)} at line ${line}`;
    })
    .join(", ");
}

function snapshot(path: string, fileSystem: InitFileSystem): Snapshot {
  if (!fileSystem.existsSync(path)) return { exists: false };
  return { exists: true, contents: fileSystem.readFileSync(path, "utf8") };
}

function parsePluginEntries(
  path: string,
  text: string,
): PluginEntry[] | { error: string } {
  const parseErrors: ParseError[] = [];
  const parsed = parse(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false,
  });

  if (parseErrors.length > 0 || !isObject(parsed)) {
    return {
      error: formatInitError(
        "invalid-opencode-configuration",
        "could not update the OpenCode configuration",
        {
          source: path,
          expected:
            '"plugin" must be an array of strings or [name, options-object] tuples',
          next: "fix the configuration and run `atlante init` again",
          cause: parseErrors.length
            ? `malformed JSONC: ${parseErrorSummary(text, parseErrors)}`
            : "the document is not a JSON object",
        },
      ),
    };
  }

  const plugin = parsed.plugin;
  if (
    plugin !== undefined &&
    (!Array.isArray(plugin) || !plugin.every(isPluginEntry))
  ) {
    return {
      error: formatInitError(
        "invalid-opencode-configuration",
        "could not update the OpenCode configuration",
        {
          source: path,
          expected:
            '"plugin" must be an array of strings or [name, options-object] tuples',
          next: "fix the configuration and run `atlante init` again",
          cause: 'the "plugin" field has an invalid value',
        },
      ),
    };
  }

  return Array.isArray(plugin) ? plugin : [];
}

/**
 * Resolves the OpenCode config file that owns the Atlante plugin registration.
 * Prefers an existing `opencode.jsonc`, falls back to an existing
 * `opencode.json` (OpenCode discovers both, and JSON is valid JSONC), and only
 * defaults to creating `opencode.jsonc` when neither exists.
 */
function opencodeConfigPath(
  directory: string,
  fileSystem: InitFileSystem,
): string {
  const jsonc = join(directory, "opencode.jsonc");
  if (fileSystem.existsSync(jsonc)) return jsonc;
  const json = join(directory, "opencode.json");
  if (fileSystem.existsSync(json)) return json;
  return jsonc;
}

/**
 * Prepares the plugin-removal edit: on init, a leftover Atlante-written
 * `@atlante/opencode` registration (string or tuple form) is removed while
 * every other plugin entry and all other configuration content stays
 * byte-faithful. A missing configuration file is still created with the
 * template shape, minus any plugin registration.
 */
function preparePlugin(
  directory: string,
  fileSystem: InitFileSystem,
): PluginPlan | { error: string } {
  const path = opencodeConfigPath(directory, fileSystem);
  const previous = snapshot(path, fileSystem);

  const text = previous.exists
    ? (previous.contents ?? "")
    : `{
  "$schema": "https://opencode.ai/config.json"
}
`;
  const entries = parsePluginEntries(path, text);
  if ("error" in entries) return entries;
  const remaining = entries.filter(
    (entry) => pluginId(entry) !== ATLANTE_PLUGIN_ID,
  );

  if (!previous.exists)
    return { previous, contents: text, removed: false, write: true };
  if (remaining.length === entries.length)
    return { previous, contents: text, removed: false, write: false };

  const edits = modify(text, ["plugin"], remaining, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  });
  return {
    previous,
    contents: applyEdits(text, edits),
    removed: true,
    write: true,
  };
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

function restore(
  path: string,
  before: Snapshot,
  fileSystem: InitFileSystem,
): string | undefined {
  try {
    if (before.exists) {
      fileSystem.writeFileSync(path, before.contents ?? "");
    } else if (fileSystem.existsSync(path)) {
      fileSystem.unlinkSync(path);
    }
  } catch (cause) {
    return `${path}: ${String(cause)}`;
  }
  return undefined;
}

type Change = { path: string; before: Snapshot };

function rollback(
  changes: readonly Change[],
  fileSystem: InitFileSystem,
): string[] {
  const errors: string[] = [];
  for (const change of changes) {
    const error = restore(change.path, change.before, fileSystem);
    if (error) errors.push(error);
  }
  return errors;
}

function mutationErrorMessage(message: string, cause: unknown): string {
  return formatInitError("initialization-failed", message, {
    next: "fix the reported error and run `atlante init` again",
    cause: String(cause),
  });
}

/**
 * The plain package manager install that reconciles node_modules with the
 * restored package.json and lockfile after a rollback. Defined only when a
 * dependency mutation ran.
 */
type DependencyReconciler = Readonly<{
  manager: PackageManager;
  command: string;
  directory: string;
}>;

/**
 * Dependency-mutation state shared across the init flow: every file the
 * package manager may have touched is snapshotted here alongside the
 * configuration files, so one rollback restores the whole pre-init state.
 */
type DependencyMutationState = {
  changes: Change[];
  reconciler?: DependencyReconciler;
};

function reconcileDependencies(
  state: DependencyMutationState,
  runPackageManager: PackageManagerRunner,
): string[] {
  const reconciler = state.reconciler;
  if (!reconciler) return [];
  const run = runPackageManager(
    reconciler.manager,
    packageManagerInstallArgs(reconciler.manager),
    reconciler.directory,
  );
  if (run.ok) return [];
  return [
    `\`${reconciler.command}\` failed; node_modules may not match the restored package.json and lockfile`,
  ];
}

function reportRollbackFailures(
  rollbackErrors: readonly string[],
  reconcileErrors: readonly string[],
  state: DependencyMutationState,
): void {
  if (rollbackErrors.length > 0) {
    printDiagnostic({
      severity: "error",
      code: "rollback-failed",
      message: "could not restore initialization files",
      next: "restore the listed files manually before retrying `atlante init`",
      cause: rollbackErrors.join(", "),
    });
  }
  for (const error of reconcileErrors) {
    printDiagnostic({
      severity: "error",
      code: "rollback-failed",
      message:
        "could not reconcile dependencies after rolling back initialization",
      ...(state.reconciler
        ? {
            next: `run \`${state.reconciler.command}\` in the project root, then fix the reported error and run \`atlante init\` again`,
          }
        : {}),
      cause: error,
    });
  }
}

/**
 * Restores every snapshotted file (configuration, host configuration,
 * package.json, lockfile) and re-runs the detected package manager install
 * when a dependency mutation happened. Failure diagnostics are printed after
 * the filesystem is restored.
 */
function abortWithRestore(
  state: DependencyMutationState,
  fileSystem: InitFileSystem,
  runPackageManager: PackageManagerRunner,
  mainError?: string,
): number {
  const rollbackErrors = rollback(state.changes, fileSystem);
  const reconcileErrors = reconcileDependencies(state, runPackageManager);
  if (mainError) console.error(mainError);
  reportRollbackFailures(rollbackErrors, reconcileErrors, state);
  return 1;
}

function commitInitFiles(
  flow: InitFlow,
  contents: string,
  before: { target: Snapshot; alternate: Snapshot },
  plugin: PluginPlan,
  gitignore: GitignorePlan,
): { error?: string } {
  const { changes } = flow.state;
  try {
    changes.push({ path: flow.target, before: before.target });
    flow.fileSystem.writeFileSync(flow.target, contents);

    if (plugin.write) {
      changes.push({ path: flow.opencode, before: plugin.previous });
      flow.fileSystem.writeFileSync(flow.opencode, plugin.contents);
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

type ProjectManifestEntry = Readonly<{
  path: string;
  manifest: Record<string, unknown>;
}>;

function projectManifestEntry(
  directory: string,
  fileSystem: InitFileSystem,
): ProjectManifestEntry | { error: string } {
  const path = join(directory, "package.json");
  if (!fileSystem.existsSync(path)) {
    return {
      error: formatInitError(
        "pack-manifest-required",
        "selecting a pack requires a package.json manifest in the project",
        {
          source: path,
          expected: "a package.json manifest declaring project dependencies",
          next: "create a package.json with your package manager's init command and run `atlante init` again",
        },
      ),
    };
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(fileSystem.readFileSync(path, "utf8"));
  } catch (cause) {
    return {
      error: formatInitError(
        "invalid-pack-manifest",
        "package.json is not valid JSON",
        {
          source: path,
          next: "fix package.json and run `atlante init` again",
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    };
  }
  if (!isObject(manifest)) {
    return {
      error: formatInitError(
        "invalid-pack-manifest",
        "package.json is not valid JSON",
        {
          source: path,
          next: "fix package.json and run `atlante init` again",
          cause: "the document is not a JSON object",
        },
      ),
    };
  }
  return { path, manifest };
}

function nodeModulesEntry(directory: string, packageName: string): string {
  return join(directory, "node_modules", ...packageName.split("/"));
}

function exitStatus(status: number | null): string {
  return status === null ? "without a status" : `with exit code ${status}`;
}

/**
 * Snapshots package.json and every lockfile the detected package manager may
 * read or create, before any package manager command runs. Run from a
 * workspace member, a package manager mutates the member manifest but writes
 * the shared lockfile at the dependency root, so both locations are covered.
 */
function snapshotDependencyFiles(
  state: DependencyMutationState,
  manifestPath: string,
  manager: PackageManager,
  directory: string,
  dependencyRoot: string,
  fileSystem: InitFileSystem,
): void {
  state.changes.push({
    path: manifestPath,
    before: snapshot(manifestPath, fileSystem),
  });
  const lockfileDirectories =
    dependencyRoot === directory ? [directory] : [directory, dependencyRoot];
  for (const lockfileDirectory of lockfileDirectories) {
    for (const lockfile of packageManagerLockfiles(
      manager,
      lockfileDirectory,
    )) {
      state.changes.push({
        path: lockfile,
        before: snapshot(lockfile, fileSystem),
      });
    }
  }
}

function packInstallFailure(
  command: string,
  status: number | null,
  packageName: string,
  spawnError?: string,
): { error: string } {
  return {
    error: formatInitError(
      "pack-installation-failed",
      `could not install ${packageName}`,
      {
        next: "fix the package manager error and run `atlante init` again",
        cause: spawnError
          ? `\`${command}\` failed: ${spawnError}`
          : `\`${command}\` failed ${exitStatus(status)}`,
      },
    ),
  };
}

/**
 * Builds the missing-entry diagnostic. Without a hoisting dependency root the
 * generic install hint applies; with one, the install already succeeded in the
 * workspace root's node_modules, so the manual install command cannot fix it
 * and the guidance points at the root instead.
 */
function packMissingEntryFailure(
  entry: string,
  installCommand: string,
  command: string,
  packageName: string,
  hoistedRoot: string | undefined,
): { error: string } {
  return {
    error: formatInitError(
      "pack-not-installed",
      `${packageName} is not installed after \`${command}\``,
      {
        expected: `${entry} to exist after the package manager run`,
        ...(hoistedRoot === undefined
          ? {
              next: `run \`${installCommand}\` manually and run \`atlante init\` again`,
            }
          : {
              cause: `the install resolved at the workspace root ${hoistedRoot} (hoisted above the project's own node_modules)`,
              next: `run \`atlante init\` at the workspace root ${hoistedRoot}, or install ${packageName} into this project directly, then run \`atlante init\` again`,
            }),
      },
    ),
  };
}

/**
 * Runs one package manager step (add or reconcile install) and verifies the
 * pack is present in the project's node_modules afterwards.
 */
function runPackageManagerStep(
  manager: PackageManager,
  args: readonly string[],
  directory: string,
  pack: SelectedPack,
  entry: string,
  installCommand: string,
  hoistedRoot: string | undefined,
  runPackageManager: PackageManagerRunner,
  fileSystem: InitFileSystem,
): { error?: string } {
  const command = packageManagerCommand(manager, args);
  console.log(`installing ${pack.packageName} with ${manager}`);
  const run = runPackageManager(manager, [...args], directory);
  if (!run.ok)
    return packInstallFailure(command, run.status, pack.packageName, run.error);
  if (!fileSystem.existsSync(entry)) {
    return packMissingEntryFailure(
      entry,
      installCommand,
      command,
      pack.packageName,
      hoistedRoot,
    );
  }
  return {};
}

/**
 * Reads corepack's `packageManager` field from the manifest, e.g.
 * `"pnpm@9.1.2"`, so explicit project configuration wins over lockfile
 * inference.
 */
function packageManagerHint(
  manifest: Record<string, unknown>,
): string | undefined {
  const value = manifest.packageManager;
  return typeof value === "string" ? value : undefined;
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
  const dependencyRoot = resolveDependencyRoot(
    directory,
    fileSystem.existsSync,
  );
  const manifestEntry = projectManifestEntry(directory, fileSystem);
  if ("error" in manifestEntry) return manifestEntry;

  const manager = detectPackageManager(
    dependencyRoot,
    fileSystem.existsSync,
    packageManagerHint(manifestEntry.manifest),
  );
  snapshotDependencyFiles(
    state,
    manifestEntry.path,
    manager,
    directory,
    dependencyRoot,
    fileSystem,
  );

  // The pack must resolve exactly like @atlante/resources resolves a project
  // dependency: from the project root's own node_modules. Installs hoisted
  // above it (npm/bun workspace roots) are not resolvable from here, so the
  // check rejects them.
  const entry = nodeModulesEntry(directory, pack.packageName);
  const declared = isPackageDeclared(manifestEntry.manifest, pack.packageName);
  if (declared && fileSystem.existsSync(entry))
    return { root: dependencyRoot, entry };

  const installCommand = packageManagerCommand(
    manager,
    packageManagerInstallArgs(manager),
  );
  const args = declared
    ? packageManagerInstallArgs(manager)
    : packageManagerAddArgs(manager, pack.packageName);

  // When the dependency root sits above the project, a workspace-scoped
  // install hoists the pack out of the project's own node_modules; the
  // missing-entry diagnostic then names the root instead of the install.
  const hoistedRoot = dependencyRoot === directory ? undefined : dependencyRoot;
  const step = runPackageManagerStep(
    manager,
    args,
    directory,
    pack,
    entry,
    installCommand,
    hoistedRoot,
    runPackageManager,
    fileSystem,
  );
  if (step.error) return { error: step.error };
  // Only the add path mutates a manifest and it succeeded, so only it records
  // the post-rollback reconciliation of node_modules.
  if (!declared) {
    state.reconciler = { manager, command: installCommand, directory };
  }
  return { root: dependencyRoot, entry };
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
  if (!fileSystem.existsSync(entry)) {
    return {
      error: formatInitError(
        "pack-not-installed",
        `${pack.packageName} is declared but not installed`,
        {
          expected: `${entry} to exist`,
          next: "run your package manager's install command and run `atlante init` again",
        },
      ),
    };
  }
  let root: string;
  try {
    root = fileSystem.realpathSync(entry);
  } catch (cause) {
    return {
      error: formatInitError(
        "pack-not-installed",
        `could not resolve the installed ${pack.packageName}`,
        {
          expected: `${entry} to be a readable package directory`,
          next: "run your package manager's install command and run `atlante init` again",
          cause: String(cause),
        },
      ),
    };
  }
  try {
    createPackageResourcePack(root, pack.packageName);
  } catch (cause) {
    return {
      error: formatInitError(
        "invalid-pack",
        `the installed ${pack.packageName} is not a valid Atlante pack`,
        {
          expected:
            "a pack manifest declaring its own name and numeric atlante.format 1",
          next: "fix the installed pack and run `atlante init` again",
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    };
  }
  return { root };
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
  opencode: string;
  gitignore: string;
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
 * Snapshots the configuration targets, prepares the host plugin-removal edit
 * and the ignore-policy edit, and commits the configuration files. Every
 * snapshotted file is recorded in the shared state, so a later failure
 * restores the whole pre-init state.
 */
function commitConfiguration(
  flow: InitFlow,
  contents: string,
  abort: Abort,
): number | { plugin: PluginPlan } {
  const before = {
    target: snapshot(flow.target, flow.fileSystem),
    alternate: snapshot(flow.alternate, flow.fileSystem),
  };
  const plugin = preparePlugin(flow.directory, flow.fileSystem);
  if ("error" in plugin) return abort(plugin.error);
  const gitignore = prepareGitignore(flow.directory, flow.fileSystem);

  const committed = commitInitFiles(flow, contents, before, plugin, gitignore);
  if (committed.error) return abort(committed.error);
  return { plugin };
}

export async function runInitWithDependencies(
  directory: string,
  options: InitOptions,
  dependencies: InitDependencies = {},
): Promise<number> {
  const fileSystem: InitFileSystem = {
    ...defaultFileSystem,
    ...dependencies,
  };
  const flow: InitFlow = {
    directory,
    target: join(directory, "atlante.jsonc"),
    alternate: join(directory, "atlante.json"),
    opencode: opencodeConfigPath(directory, fileSystem),
    gitignore: join(directory, ".gitignore"),
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

    const committed = commitConfiguration(flow, prepared.contents, abort);
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
    console.log(
      committed.plugin.removed
        ? `removed the @atlante/opencode plugin registration from ${flow.opencode}`
        : `no @atlante/opencode plugin registration found in ${flow.opencode}`,
    );
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
