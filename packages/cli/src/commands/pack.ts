import { join } from "node:path";
import {
  createPackageResourcePack,
  isPackageDeclared,
  type ParsedResourceLocator,
  parseJsoncWithLocations,
  parseResourceLocator,
  resolveResourceDocument,
} from "@atlante/resources";
import {
  type AtlanteDocument,
  DEFAULT_AGENT_OUTPUT_DIR,
} from "@atlante/schema";
import { hasErrors, validateDocumentText } from "@atlante/validator";
import {
  FIRST_PARTY_PACKAGE,
  firstPartyProjectContext,
} from "../first-party-pack.js";
import {
  defaultAgentGitignorePath,
  defaultAgentGitignorePaths,
  ownedDefaultAgentGitignorePaths,
  prepareGitignore,
} from "./gitignore.js";
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
import { discoverPackPresets } from "./pack-presets.js";
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

function configurationExtendsPackage(
  document: unknown,
  packageName: string,
): boolean {
  if (!isObject(document)) return false;
  const inheritance = document.extends;
  return (
    packageLocatorMatches(inheritance, packageName) ||
    (Array.isArray(inheritance) &&
      inheritance.some((entry) => packageLocatorMatches(entry, packageName)))
  );
}

function configurationReferencesPackage(
  document: unknown,
  packageName: string,
): boolean {
  if (!isObject(document)) return false;
  if (configurationExtendsPackage(document, packageName)) return true;

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

function directConfigurationAgentIgnorePaths(
  document: unknown,
  packageName: string,
): string[] {
  if (!isObject(document) || !isObject(document.agents)) return [];
  return Object.entries(document.agents)
    .filter(([, source]) => sourceReferencesPackage(source, packageName))
    .map(([id]) => defaultAgentGitignorePath(id))
    .filter((path): path is string => path !== undefined);
}

type ConfigurationReference =
  | { referenced: boolean; path?: string; document?: unknown }
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
    document,
  };
}

function canonicalConfiguration(
  directory: string,
  fileSystem: PackFileSystem,
): AtlanteDocument | undefined {
  const candidates = [
    join(directory, "atlante.jsonc"),
    join(directory, "atlante.json"),
  ].filter(fileSystem.existsSync);
  if (candidates.length !== 1) return undefined;
  const path = candidates[0];
  if (!path) return undefined;
  try {
    const result = validateDocumentText(
      fileSystem.readFileSync(path, "utf8"),
      path,
      { resourceContext: firstPartyProjectContext() },
    );
    return result.document && !hasErrors(result.diagnostics)
      ? result.document
      : undefined;
  } catch {
    return undefined;
  }
}

function installedPackRoot(
  directory: string,
  packageName: string,
  fileSystem: PackFileSystem,
): string | undefined {
  const entry = nodeModulesEntry(directory, packageName);
  if (!fileSystem.existsSync(entry)) return undefined;
  try {
    return fileSystem.realpathSync(entry);
  } catch {
    return undefined;
  }
}

function presetUsesDefaultAgentDirectory(
  preset: Record<string, unknown>,
): boolean {
  const options = preset.options;
  if (!isObject(options) || !isObject(options.agents)) return true;
  const outDir = options.agents.outDir;
  return outDir === undefined || outDir === DEFAULT_AGENT_OUTPUT_DIR;
}

function presetAgentIds(
  pack: ReturnType<typeof createPackageResourcePack>,
  path: string,
  fileSystem: PackFileSystem,
  defaultDirectoryOnly = false,
): string[] {
  if (!fileSystem.existsSync(path)) return [];
  let preset: Record<string, unknown>;
  try {
    const resolved = resolveResourceDocument({ pack, rootFile: path });
    if (!isObject(resolved.effectiveRaw)) return [];
    preset = resolved.effectiveRaw;
  } catch {
    // Pack validation owns malformed preset diagnostics. Ignore scanning is
    // best effort and must not make an otherwise valid dependency unusable.
    return [];
  }
  if (defaultDirectoryOnly && !presetUsesDefaultAgentDirectory(preset))
    return [];
  return isObject(preset.agents) ? Object.keys(preset.agents) : [];
}

function packagePresetPath(
  value: unknown,
  packageName: string,
): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const parsed = parseResourceLocator(value);
    return parsed.kind === "package" && parsed.packageName === packageName
      ? (parsed.subpath ?? "")
      : undefined;
  } catch {
    // Configuration validation reports malformed locators. Ignore scanning
    // only needs the safe, already-parseable package references.
    return undefined;
  }
}

function extendedPackPresetPaths(
  document: unknown,
  packageName: string,
): string[] {
  if (!isObject(document)) return [];
  const inheritance = document.extends;
  const entries = Array.isArray(inheritance) ? inheritance : [inheritance];
  return [
    ...new Set(
      entries
        .map((entry) => packagePresetPath(entry, packageName))
        .filter((path): path is string => path !== undefined),
    ),
  ];
}

function directPackAgentIgnorePaths(
  packageName: string,
  root: string | undefined,
  fileSystem: PackFileSystem,
  presetPaths?: readonly string[],
  defaultDirectoryOnly = false,
): string[] {
  if (!root) return [];
  const selected = presetPaths ? new Set(presetPaths) : undefined;
  let pack: ReturnType<typeof createPackageResourcePack>;
  try {
    pack = createPackageResourcePack(root, packageName);
  } catch {
    return [];
  }
  const ids = new Set<string>();
  for (const preset of discoverPackPresets(packageName, root)) {
    if (selected && !selected.has(preset.relpath)) continue;
    for (const filename of ["atlante.jsonc", "atlante.json"] as const) {
      const path = join(root, preset.relpath, filename);
      for (const id of presetAgentIds(
        pack,
        path,
        fileSystem,
        defaultDirectoryOnly,
      ))
        ids.add(id);
    }
  }
  return [...ids]
    .sort()
    .map(defaultAgentGitignorePath)
    .filter((path): path is string => path !== undefined);
}

function applyGitignorePlan(
  state: DependencyMutationState,
  plan: ReturnType<typeof prepareGitignore>,
  fileSystem: PackFileSystem,
): void {
  if (!plan.write) return;
  state.changes.push({ path: plan.path, before: plan.previous });
  fileSystem.writeFileSync(plan.path, plan.contents);
}

function reconcileInstallGitignore(
  directory: string,
  packageName: string,
  packRoot: string,
  fileSystem: PackFileSystem,
  state: DependencyMutationState,
): void {
  const reference = configurationReference(directory, packageName, fileSystem);
  if ("error" in reference || !reference.referenced) return;
  const document = canonicalConfiguration(directory, fileSystem);
  if (!document) return;
  const desired = new Set(defaultAgentGitignorePaths(document));
  const packAgentPaths = new Set(
    directConfigurationAgentIgnorePaths(reference.document, packageName),
  );
  if (configurationExtendsPackage(reference.document, packageName))
    for (const path of directPackAgentIgnorePaths(
      packageName,
      packRoot,
      fileSystem,
      extendedPackPresetPaths(reference.document, packageName),
    ))
      packAgentPaths.add(path);
  applyGitignorePlan(
    state,
    prepareGitignore(directory, fileSystem, {
      required: [...packAgentPaths].filter((path) => desired.has(path)),
    }),
    fileSystem,
  );
}

function reconcileUninstallGitignore(
  directory: string,
  packAgentPaths: readonly string[],
  fileSystem: PackFileSystem,
  state: DependencyMutationState,
): void {
  const document = canonicalConfiguration(directory, fileSystem);
  const desired = new Set(document ? defaultAgentGitignorePaths(document) : []);
  const candidates = new Set(
    ownedDefaultAgentGitignorePaths(directory, fileSystem),
  );
  if (document?.options?.agents?.outDir === DEFAULT_AGENT_OUTPUT_DIR)
    for (const path of packAgentPaths) candidates.add(path);
  const stale = [...candidates].filter((path) => !desired.has(path));
  applyGitignorePlan(
    state,
    prepareGitignore(directory, fileSystem, { removeAgentPaths: stale }),
    fileSystem,
  );
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
    reconcileInstallGitignore(
      directory,
      parsed.packageName,
      located.root,
      resolved.fileSystem,
      state,
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
  const packRoot = installedPackRoot(
    directory,
    parsed.packageName,
    resolved.fileSystem,
  );
  const packAgentPaths = directPackAgentIgnorePaths(
    parsed.packageName,
    packRoot,
    resolved.fileSystem,
    [""],
    true,
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
    reconcileUninstallGitignore(
      directory,
      packAgentPaths,
      resolved.fileSystem,
      state,
    );
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
