import {
  existsSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  createPackageResourcePack,
  isPackageDeclared,
} from "@atlante/resources";
import { printDiagnostic } from "../report.js";
import { formatInitError } from "./init-error.js";
import type { SelectedPack } from "./pack-locator.js";
import {
  detectPackageManager,
  type PackageManager,
  type PackageManagerRunner,
  packageManagerAddArgs,
  packageManagerCommand,
  packageManagerInstallArgs,
  packageManagerLockfiles,
  resolveDependencyRoot,
} from "./package-manager.js";

export type PackFileSystem = {
  existsSync: (path: string) => boolean;
  readFileSync: (path: string, encoding: "utf8") => string;
  writeFileSync: (path: string, contents: string) => void;
  unlinkSync: (path: string) => void;
  realpathSync: (path: string) => string;
};

export const defaultPackFileSystem: PackFileSystem = {
  existsSync,
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync: (path, contents) => writeFileSync(path, contents),
  unlinkSync,
  realpathSync,
};

export type Snapshot = { exists: boolean; contents?: string };

export function snapshot(path: string, fileSystem: PackFileSystem): Snapshot {
  if (!fileSystem.existsSync(path)) return { exists: false };
  return { exists: true, contents: fileSystem.readFileSync(path, "utf8") };
}

function restore(
  path: string,
  before: Snapshot,
  fileSystem: PackFileSystem,
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

export type Change = { path: string; before: Snapshot };

export function rollback(
  changes: readonly Change[],
  fileSystem: PackFileSystem,
): string[] {
  const errors: string[] = [];
  for (const change of changes) {
    const error = restore(change.path, change.before, fileSystem);
    if (error) errors.push(error);
  }
  return errors;
}

type DependencyReconciler = Readonly<{
  manager: PackageManager;
  command: string;
  directory: string;
}>;

export type DependencyMutationState = {
  changes: Change[];
  reconciler?: DependencyReconciler;
};

export type PackOperation = Readonly<{
  files: string;
  command: string;
}>;

const INIT_OPERATION: PackOperation = {
  files: "initialization",
  command: "atlante init",
};

export function reconcileDependencies(
  state: DependencyMutationState,
  runPackageManager: PackageManagerRunner,
): string[] {
  const reconciler = state.reconciler;
  if (!reconciler) return [];
  let run: ReturnType<PackageManagerRunner>;
  try {
    run = runPackageManager(
      reconciler.manager,
      packageManagerInstallArgs(reconciler.manager),
      reconciler.directory,
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return [
      `\`${reconciler.command}\` failed: ${detail}; node_modules may not match the restored package.json and lockfile`,
    ];
  }
  if (run.ok) return [];
  return [
    `\`${reconciler.command}\` failed; node_modules may not match the restored package.json and lockfile`,
  ];
}

export function reportRollbackFailures(
  rollbackErrors: readonly string[],
  reconcileErrors: readonly string[],
  state: DependencyMutationState,
  operation: PackOperation = INIT_OPERATION,
): void {
  if (rollbackErrors.length > 0) {
    printDiagnostic({
      severity: "error",
      code: "rollback-failed",
      message: `could not restore ${operation.files} files`,
      next: `restore the listed files manually before retrying \`${operation.command}\``,
      cause: rollbackErrors.join(", "),
    });
  }
  for (const error of reconcileErrors) {
    printDiagnostic({
      severity: "error",
      code: "rollback-failed",
      message: `could not reconcile dependencies after rolling back ${operation.files}`,
      ...(state.reconciler
        ? {
            next: `run \`${state.reconciler.command}\` in the project root, then fix the reported error and run \`${operation.command}\` again`,
          }
        : {}),
      cause: error,
    });
  }
}

export function abortWithRestore(
  state: DependencyMutationState,
  fileSystem: PackFileSystem,
  runPackageManager: PackageManagerRunner,
  mainError?: string,
  operation: PackOperation = INIT_OPERATION,
): number {
  const rollbackErrors = rollback(state.changes, fileSystem);
  const reconcileErrors = reconcileDependencies(state, runPackageManager);
  if (mainError) console.error(mainError);
  reportRollbackFailures(rollbackErrors, reconcileErrors, state, operation);
  return 1;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type ProjectManifestEntry = Readonly<{
  path: string;
  manifest: Record<string, unknown>;
}>;

export function projectManifestEntry(
  directory: string,
  fileSystem: PackFileSystem,
  command = "atlante init",
): ProjectManifestEntry | { error: string } {
  const path = join(directory, "package.json");
  if (!fileSystem.existsSync(path)) {
    return {
      error: formatInitError(
        "pack-manifest-required",
        command === "atlante init"
          ? "selecting a pack requires a package.json manifest in the project"
          : "pack management requires a package.json manifest in the project",
        {
          source: path,
          expected: "a package.json manifest declaring project dependencies",
          next: `create a package.json with your package manager's init command and run \`${command}\` again`,
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
          next: `fix package.json and run \`${command}\` again`,
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
          next: `fix package.json and run \`${command}\` again`,
          cause: "the document is not a JSON object",
        },
      ),
    };
  }
  return { path, manifest };
}

export function nodeModulesEntry(
  directory: string,
  packageName: string,
): string {
  return join(directory, "node_modules", ...packageName.split("/"));
}

export function packageManagerHint(
  manifest: Record<string, unknown>,
): string | undefined {
  const value = manifest.packageManager;
  return typeof value === "string" ? value : undefined;
}

export function snapshotDependencyFiles(
  state: DependencyMutationState,
  manifestPath: string,
  manager: PackageManager,
  directory: string,
  dependencyRoot: string,
  fileSystem: PackFileSystem,
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

function exitStatus(status: number | null): string {
  return status === null ? "without a status" : `with exit code ${status}`;
}

function packInstallFailure(
  command: string,
  status: number | null,
  packageName: string,
  spawnError: string | undefined,
  retryCommand: string,
): { error: string } {
  return {
    error: formatInitError(
      "pack-installation-failed",
      `could not install ${packageName}`,
      {
        next: `fix the package manager error and run \`${retryCommand}\` again`,
        cause: spawnError
          ? `\`${command}\` failed: ${spawnError}`
          : `\`${command}\` failed ${exitStatus(status)}`,
      },
    ),
  };
}

function packMissingEntryFailure(
  entry: string,
  installCommand: string,
  command: string,
  packageName: string,
  hoistedRoot: string | undefined,
  retryCommand: string,
): { error: string } {
  return {
    error: formatInitError(
      "pack-not-installed",
      `${packageName} is not installed after \`${command}\``,
      {
        expected: `${entry} to exist after the package manager run`,
        ...(hoistedRoot === undefined
          ? {
              next: `run \`${installCommand}\` manually and run \`${retryCommand}\` again`,
            }
          : {
              cause: `the install resolved at the workspace root ${hoistedRoot} (hoisted above the project's own node_modules)`,
              next: `run \`${retryCommand}\` at the workspace root ${hoistedRoot}, or install ${packageName} into this project directly, then run \`${retryCommand}\` again`,
            }),
      },
    ),
  };
}

function runPackageManagerStep(
  manager: PackageManager,
  args: readonly string[],
  directory: string,
  pack: SelectedPack,
  entry: string,
  installCommand: string,
  hoistedRoot: string | undefined,
  runPackageManager: PackageManagerRunner,
  fileSystem: PackFileSystem,
  retryCommand = "atlante init",
): { error?: string } {
  const command = packageManagerCommand(manager, args);
  console.log(`installing ${pack.packageName} with ${manager}`);
  const run = runPackageManager(manager, [...args], directory);
  if (!run.ok) {
    return packInstallFailure(
      command,
      run.status,
      pack.packageName,
      run.error,
      retryCommand,
    );
  }
  if (!fileSystem.existsSync(entry)) {
    return {
      error: packMissingEntryFailure(
        entry,
        installCommand,
        command,
        pack.packageName,
        hoistedRoot,
        retryCommand,
      ).error,
    };
  }
  return {};
}

export type EnsurePackOptions = Readonly<{
  retryCommand?: string;
  trackReconciliation?: boolean;
}>;

export function ensurePackInstalled(
  directory: string,
  pack: SelectedPack,
  state: DependencyMutationState,
  fileSystem: PackFileSystem,
  runPackageManager: PackageManagerRunner,
  options: EnsurePackOptions = {},
): { root: string; entry: string } | { error: string } {
  const retryCommand = options.retryCommand ?? "atlante init";
  const dependencyRoot = resolveDependencyRoot(
    directory,
    fileSystem.existsSync,
  );
  const manifestEntry = projectManifestEntry(
    directory,
    fileSystem,
    retryCommand,
  );
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
  if (options.trackReconciliation) {
    state.reconciler = { manager, command: installCommand, directory };
  }
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
    retryCommand,
  );
  if (step.error) return { error: step.error };
  if (!declared) {
    state.reconciler = { manager, command: installCommand, directory };
  }
  return { root: dependencyRoot, entry };
}

export function locateInstalledPack(
  entry: string,
  pack: SelectedPack,
  fileSystem: PackFileSystem,
  retryCommand = "atlante init",
): { root: string } | { error: string } {
  if (!fileSystem.existsSync(entry)) {
    return {
      error: formatInitError(
        "pack-not-installed",
        `${pack.packageName} is declared but not installed`,
        {
          expected: `${entry} to exist`,
          next: `run your package manager's install command and run \`${retryCommand}\` again`,
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
          next: `run your package manager's install command and run \`${retryCommand}\` again`,
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
          next: `fix the installed pack and run \`${retryCommand}\` again`,
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    };
  }
  return { root };
}
