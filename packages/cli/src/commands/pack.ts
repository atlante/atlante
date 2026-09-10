import { join } from "node:path";
import {
  createPackageResourcePack,
  isPackageDeclared,
  type ParsedResourceLocator,
  parseJsoncWithLocations,
  parseResourceLocator,
} from "@atlante/resources";
import { FIRST_PARTY_PACKAGE } from "../first-party-pack.js";
import { formatInitError } from "./init-error.js";
import {
  abortWithRestore,
  type DependencyMutationState,
  defaultPackFileSystem,
  ensurePackInstalled,
  locateInstalledPack,
  nodeModulesEntry,
  type PackFileSystem,
  packageManagerHint,
  projectManifestEntry,
  snapshotDependencyFiles,
} from "./pack-dependencies.js";
import { parsePackLocator } from "./pack-locator.js";
import {
  detectPackageManager,
  type PackageManagerRunner,
  packageManagerCommand,
  packageManagerInstallArgs,
  packageManagerRemoveArgs,
  resolveDependencyRoot,
  runPackageManagerDefault,
} from "./package-manager.js";

const INSTALL_OPERATION = {
  files: "pack dependency",
  command: "atlante pack install",
} as const;

const UNINSTALL_OPERATION = {
  files: "pack dependency",
  command: "atlante pack uninstall",
} as const;

const SOURCE_GROUPS = ["agents", "skills"] as const;
const SOURCE_SELECTOR_KEYS = ["$template", "$instance"] as const;

export type PackCommandDependencies = Partial<PackFileSystem> & {
  runPackageManager?: PackageManagerRunner;
};

type ResolvedDependencies = Readonly<{
  fileSystem: PackFileSystem;
  runPackageManager: PackageManagerRunner;
}>;

function resolveDependencies(
  dependencies: PackCommandDependencies,
): ResolvedDependencies {
  const { runPackageManager, ...fileSystem } = dependencies;
  return {
    fileSystem: { ...defaultPackFileSystem, ...fileSystem },
    runPackageManager: runPackageManager ?? runPackageManagerDefault,
  };
}

function parsePackageName(raw: string):
  | { packageName: string }
  | {
      error: string;
    } {
  let parsed: ReturnType<typeof parsePackLocator>;
  try {
    parsed = parsePackLocator(raw);
  } catch (cause) {
    return {
      error: formatInitError(
        "invalid-pack-locator",
        "the package argument is not a valid pack locator",
        {
          expected: "a package name such as @scope/pack without a preset path",
          next: "pass the package name to `atlante pack install` or `atlante pack uninstall`",
          cause: String(cause),
        },
      ),
    };
  }
  if ("error" in parsed) return parsed;
  if (parsed.presetName !== undefined) {
    return {
      error: formatInitError(
        "invalid-pack-locator",
        "the package argument must not select a preset",
        {
          expected: "a package name such as @scope/pack without a preset path",
          next: "remove the preset path and run the pack command again",
        },
      ),
    };
  }
  return { packageName: parsed.packageName };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function packageLocatorMatches(value: unknown, packageName: string): boolean {
  if (typeof value !== "string") return false;
  let parsed: ParsedResourceLocator;
  try {
    parsed = parseResourceLocator(value);
  } catch {
    return false;
  }
  return parsed.kind === "package" && parsed.packageName === packageName;
}

function sourceReferencesPackage(
  source: unknown,
  packageName: string,
): boolean {
  if (packageLocatorMatches(source, packageName)) return true;
  if (!isObject(source)) return false;
  return SOURCE_SELECTOR_KEYS.some((key) =>
    packageLocatorMatches(source[key], packageName),
  );
}

function configurationReferencesPackage(
  document: unknown,
  packageName: string,
): boolean {
  if (!isObject(document)) return false;
  const inheritance = document.extends;
  if (packageLocatorMatches(inheritance, packageName)) return true;
  if (
    Array.isArray(inheritance) &&
    inheritance.some((entry) => packageLocatorMatches(entry, packageName))
  )
    return true;

  return SOURCE_GROUPS.some((group) => {
    const bindings = document[group];
    return (
      isObject(bindings) &&
      Object.values(bindings).some((source) =>
        sourceReferencesPackage(source, packageName),
      )
    );
  });
}

type ConfigurationReference =
  | { referenced: boolean; path?: string }
  | { error: string };

function configurationReference(
  directory: string,
  packageName: string,
  fileSystem: PackFileSystem,
): ConfigurationReference {
  const jsonc = join(directory, "atlante.jsonc");
  const json = join(directory, "atlante.json");
  const found = [jsonc, json].filter(fileSystem.existsSync);
  if (found.length > 1) {
    return {
      error: formatInitError(
        "ambiguous-config",
        "both atlante.jsonc and atlante.json exist in the project root",
        {
          source: "atlante.jsonc/atlante.json",
          next: "remove one configuration file before managing pack dependencies",
        },
      ),
    };
  }
  const path = found[0];
  if (!path) return { referenced: false };

  let document: unknown;
  try {
    document = path.endsWith(".jsonc")
      ? parseJsoncWithLocations(fileSystem.readFileSync(path, "utf8")).value
      : JSON.parse(fileSystem.readFileSync(path, "utf8"));
  } catch (cause) {
    return {
      error: formatInitError(
        "invalid-json",
        "the Atlante configuration is not valid JSON or JSONC",
        {
          source: path,
          next: "fix the configuration before managing pack dependencies",
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    };
  }
  return {
    referenced: configurationReferencesPackage(document, packageName),
    path,
  };
}

function printError(error: string): number {
  console.error(error);
  return 1;
}

function exitStatus(status: number | null): string {
  return status === null ? "without a status" : `with exit code ${status}`;
}

function packageManagerFailure(
  operation: "install" | "uninstall",
  packageName: string,
  command: string,
  status: number | null,
  error: string | undefined,
): string {
  return formatInitError(
    operation === "install"
      ? "pack-installation-failed"
      : "pack-uninstallation-failed",
    `could not ${operation} ${packageName}`,
    {
      next: `fix the package manager error and run \`atlante pack ${operation}\` again`,
      cause: error
        ? `\`${command}\` failed: ${error}`
        : `\`${command}\` failed ${exitStatus(status)}`,
    },
  );
}

export async function runPackInstall(
  directory: string,
  rawPackageName: string,
  dependencies: PackCommandDependencies = {},
): Promise<number> {
  const parsed = parsePackageName(rawPackageName);
  if ("error" in parsed) return printError(parsed.error);
  if (parsed.packageName === FIRST_PARTY_PACKAGE) {
    return printError(
      formatInitError(
        "bundled-pack",
        `${FIRST_PARTY_PACKAGE} is bundled with the Atlante CLI`,
        {
          next: "omit it from `atlante pack install`; it is available without a project dependency",
        },
      ),
    );
  }

  const resolved = resolveDependencies(dependencies);
  const state: DependencyMutationState = { changes: [] };
  const pack = { packageName: parsed.packageName };
  try {
    const ensured = ensurePackInstalled(
      directory,
      pack,
      state,
      resolved.fileSystem,
      resolved.runPackageManager,
      { retryCommand: INSTALL_OPERATION.command, trackReconciliation: true },
    );
    if ("error" in ensured)
      return abortWithRestore(
        state,
        resolved.fileSystem,
        resolved.runPackageManager,
        ensured.error,
        INSTALL_OPERATION,
      );
    const located = locateInstalledPack(
      ensured.entry,
      pack,
      resolved.fileSystem,
      INSTALL_OPERATION.command,
    );
    if ("error" in located)
      return abortWithRestore(
        state,
        resolved.fileSystem,
        resolved.runPackageManager,
        located.error,
        INSTALL_OPERATION,
      );
    console.log(`installed ${parsed.packageName}`);
    return 0;
  } catch (cause) {
    return abortWithRestore(
      state,
      resolved.fileSystem,
      resolved.runPackageManager,
      formatInitError(
        "pack-installation-failed",
        `could not install ${parsed.packageName}`,
        {
          next: "fix the reported error and run `atlante pack install` again",
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      ),
      INSTALL_OPERATION,
    );
  }
}

export async function runPackUninstall(
  directory: string,
  rawPackageName: string,
  dependencies: PackCommandDependencies = {},
): Promise<number> {
  const parsed = parsePackageName(rawPackageName);
  if ("error" in parsed) return printError(parsed.error);
  const resolved = resolveDependencies(dependencies);
  const manifestEntry = projectManifestEntry(
    directory,
    resolved.fileSystem,
    UNINSTALL_OPERATION.command,
  );
  if ("error" in manifestEntry) return printError(manifestEntry.error);
  if (!isPackageDeclared(manifestEntry.manifest, parsed.packageName)) {
    return printError(
      formatInitError(
        "pack-not-declared",
        `${parsed.packageName} is not a direct project dependency`,
        {
          source: manifestEntry.path,
          expected:
            "the package to be declared in dependencies, optionalDependencies, or devDependencies",
          next: `declare ${parsed.packageName} before running \`atlante pack uninstall\``,
        },
      ),
    );
  }

  const reference = configurationReference(
    directory,
    parsed.packageName,
    resolved.fileSystem,
  );
  if ("error" in reference) return printError(reference.error);
  if (reference.referenced) {
    return printError(
      formatInitError(
        "pack-in-use",
        `${parsed.packageName} is still referenced by the project configuration`,
        {
          source: reference.path,
          next: "remove the pack references from the configuration before uninstalling it",
        },
      ),
    );
  }

  const dependencyRoot = resolveDependencyRoot(
    directory,
    resolved.fileSystem.existsSync,
  );
  const manager = detectPackageManager(
    dependencyRoot,
    resolved.fileSystem.existsSync,
    packageManagerHint(manifestEntry.manifest),
  );
  const state: DependencyMutationState = { changes: [] };
  snapshotDependencyFiles(
    state,
    manifestEntry.path,
    manager,
    directory,
    dependencyRoot,
    resolved.fileSystem,
  );
  const args = packageManagerRemoveArgs(manager, parsed.packageName);
  const command = packageManagerCommand(manager, args);
  state.reconciler = {
    manager,
    command: packageManagerCommand(manager, packageManagerInstallArgs(manager)),
    directory,
  };
  console.log(`uninstalling ${parsed.packageName} with ${manager}`);
  try {
    const run = resolved.runPackageManager(manager, args, directory);
    if (!run.ok) {
      return abortWithRestore(
        state,
        resolved.fileSystem,
        resolved.runPackageManager,
        packageManagerFailure(
          "uninstall",
          parsed.packageName,
          command,
          run.status,
          run.error,
        ),
        UNINSTALL_OPERATION,
      );
    }
  } catch (cause) {
    return abortWithRestore(
      state,
      resolved.fileSystem,
      resolved.runPackageManager,
      packageManagerFailure(
        "uninstall",
        parsed.packageName,
        command,
        null,
        cause instanceof Error ? cause.message : String(cause),
      ),
      UNINSTALL_OPERATION,
    );
  }
  console.log(`uninstalled ${parsed.packageName}`);
  return 0;
}

type DependencyGroup =
  | "dependencies"
  | "optionalDependencies"
  | "devDependencies";

type DeclaredPack = Readonly<{
  name: string;
  declarations: readonly string[];
  installedVersion: string;
  valid: boolean;
  referenced: boolean;
}>;

function dependencyEntries(
  manifest: Record<string, unknown>,
): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  const groups: readonly DependencyGroup[] = [
    "dependencies",
    "optionalDependencies",
    "devDependencies",
  ];
  for (const group of groups) {
    const values = manifest[group];
    if (typeof values !== "object" || values === null || Array.isArray(values))
      continue;
    for (const [name, version] of Object.entries(values)) {
      if (typeof version !== "string") continue;
      const existing = entries.get(name) ?? [];
      existing.push(`${group}:${version}`);
      entries.set(name, existing);
    }
  }
  return entries;
}

function installedPack(
  directory: string,
  name: string,
  referenced: boolean,
  fileSystem: PackFileSystem,
): DeclaredPack | undefined {
  const entry = nodeModulesEntry(directory, name);
  if (!fileSystem.existsSync(entry)) {
    return referenced
      ? {
          name,
          declarations: [],
          installedVersion: "missing",
          valid: false,
          referenced,
        }
      : undefined;
  }
  let root: string;
  let manifest: Record<string, unknown>;
  try {
    root = fileSystem.realpathSync(entry);
    const raw = JSON.parse(
      fileSystem.readFileSync(join(root, "package.json"), "utf8"),
    );
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return referenced
        ? {
            name,
            declarations: [],
            installedVersion: "invalid",
            valid: false,
            referenced,
          }
        : undefined;
    manifest = raw as Record<string, unknown>;
  } catch {
    return referenced
      ? {
          name,
          declarations: [],
          installedVersion: "invalid",
          valid: false,
          referenced,
        }
      : undefined;
  }
  if (!Object.hasOwn(manifest, "atlante") && !referenced) return undefined;
  let valid = false;
  try {
    createPackageResourcePack(root, name);
    valid = true;
  } catch {
    valid = false;
  }
  return {
    name,
    declarations: [],
    installedVersion:
      typeof manifest.version === "string" ? manifest.version : "invalid",
    valid,
    referenced,
  };
}

export async function runPackList(
  directory: string,
  dependencies: PackCommandDependencies = {},
): Promise<number> {
  const resolved = resolveDependencies(dependencies);
  const manifestEntry = projectManifestEntry(
    directory,
    resolved.fileSystem,
    "atlante pack list",
  );
  if ("error" in manifestEntry) return printError(manifestEntry.error);

  const names = dependencyEntries(manifestEntry.manifest);
  const references = new Map<string, ConfigurationReference>();
  for (const name of names.keys()) {
    const reference = configurationReference(
      directory,
      name,
      resolved.fileSystem,
    );
    if ("error" in reference) return printError(reference.error);
    references.set(name, reference);
  }

  const packs: DeclaredPack[] = [];
  for (const name of [...names.keys()].sort()) {
    const reference = references.get(name);
    const candidate = installedPack(
      directory,
      name,
      reference !== undefined && "referenced" in reference
        ? reference.referenced
        : false,
      resolved.fileSystem,
    );
    if (!candidate) continue;
    packs.push({
      ...candidate,
      declarations: names.get(name) ?? [],
    });
  }

  if (packs.length === 0) {
    console.log("no direct Atlante packs found");
    return 0;
  }
  for (const pack of packs) {
    console.log(
      `${pack.name} declared=${pack.declarations.join(",")} installed=${pack.installedVersion} valid=${pack.valid ? "yes" : "no"} referenced=${pack.referenced ? "yes" : "no"}`,
    );
  }
  return 0;
}
