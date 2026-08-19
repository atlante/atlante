import { lstatSync, readFileSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  createResourcePack,
  isResourcePackLexicalPathSafe,
  isResourcePackLexicalRootStable,
  isResourcePackPathContained,
  type ResourcePack,
  type ResourceResolutionContext,
  resourcePackLexicalPathForCanonical,
  resourcePackLexicalRootSymlinkPaths,
  resourcePackMetadataPaths,
  resourcePackWatchRoot,
} from "./content-root.js";
import {
  failResource,
  normalizeResourcePaths,
  ResourceResolutionError,
} from "./errors.js";
import type { ParsedResourceLocator } from "./locator.js";
import type {
  RawResourceLocator,
  ResourcePackageIdentity,
  ResourceWatchRoot,
} from "./types.js";

const STRICT_SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![\s\S])/;

type PackageLocator = Extract<
  ParsedResourceLocator,
  { readonly kind: "package" }
>;

type ProjectManifest = Readonly<{
  readonly manifestPath: string;
  readonly lexicalManifestPath: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}>;

/** Request-local package resolution state. It must never be shared globally. */
export type PackageResolutionCache = {
  readonly projectManifests: Map<string, ProjectManifest>;
  readonly packageMetadata: Map<string, CanonicalPackageMetadata>;
  readonly firstPartyPacks: Map<string, ResourcePack>;
};

type CanonicalPackageMetadata = Readonly<{
  readonly name: string;
  readonly version: string;
  readonly manifestPath: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}>;

function packageTrustContext(pack: ResourcePack): {
  readonly trustedRoots?: readonly ResourceWatchRoot[];
} {
  return pack.kind === "package"
    ? { trustedRoots: [resourcePackWatchRoot(pack)] }
    : {};
}

export type PackageResolutionOptions = Readonly<{
  readonly cache?: PackageResolutionCache;
  /** Existing facet read seam, also used for selected package metadata. */
  readonly beforeRead?: (path: string) => void;
  /** Deterministic seam for testing package-root reconstruction races. */
  readonly beforePackageRootReconstruction?: (path: string) => void;
  readonly resourceContext?: ResourceResolutionContext;
}>;

export type ResolvedPackage = Readonly<{
  readonly pack: ResourcePack;
  readonly dependencies: readonly string[];
}>;

export function createPackageResolutionCache(): PackageResolutionCache {
  return {
    projectManifests: new Map(),
    packageMetadata: new Map(),
    firstPartyPacks: new Map(),
  };
}

/** Creates a validated package root without resolving or executing package code. */
function createPackageResourcePackWithLocator(
  rootDirectory: string,
  packageName: string,
  locator: RawResourceLocator,
): ResourcePack {
  const rootPack = createResourcePack(rootDirectory, "package");
  const identity = validatePackManifest(rootPack, locator, packageName, {});
  return createResourcePack(rootDirectory, "package", identity);
}

export function createPackageResourcePack(
  rootDirectory: string,
  packageName: string,
): ResourcePack {
  return createPackageResourcePackWithLocator(
    rootDirectory,
    packageName,
    packageName,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dependencyMap(
  manifest: Record<string, unknown>,
  key: "dependencies" | "optionalDependencies" | "devDependencies",
): Readonly<Record<string, string>> {
  const value = manifest[key];
  if (!isObject(value)) return {};
  const output: Record<string, string> = {};
  for (const [name, version] of Object.entries(value)) {
    if (typeof version === "string") output[name] = version;
  }
  return Object.freeze(output);
}

function metadataPaths(pack: ResourcePack, manifestPath: string): string[] {
  return normalizeResourcePaths([
    manifestPath,
    join(pack.lexicalRoot, "package.json"),
    ...resourcePackLexicalRootSymlinkPaths(pack),
  ]);
}

function metadataFailure(
  code:
    | "package-not-declared"
    | "package-metadata-unreadable"
    | "missing-pack-format"
    | "unsupported-pack-format",
  message: string,
  locator: RawResourceLocator,
  pack: ResourcePack,
  manifestPath: string,
): never {
  failResource(
    code,
    message,
    { locator },
    {
      dependencies: metadataPaths(pack, manifestPath),
      unresolvedParents: [pack.root],
      ...packageTrustContext(pack),
    },
  );
}

function packageFailureDependencies(
  authoringPack: ResourcePack,
  declarationDependencies: readonly string[],
  dependencies: readonly string[] = [],
): string[] {
  return normalizeResourcePaths([
    ...declarationDependencies,
    ...resourcePackMetadataPaths(authoringPack),
    ...dependencies,
  ]);
}

function enrichPackageFailure(
  error: unknown,
  authoringPack: ResourcePack,
  declarationDependencies: readonly string[],
  lookupTrustedRoots: readonly ResourceWatchRoot[] = [],
  lookupRetryParents: readonly string[] = [],
): never {
  if (!(error instanceof ResourceResolutionError)) throw error;
  throw new ResourceResolutionError(error.failure, {
    dependencies: packageFailureDependencies(
      authoringPack,
      declarationDependencies,
      error.dependencies,
    ),
    unresolvedParents: [
      ...lookupRetryParents,
      authoringPack.root,
      ...error.unresolvedParents,
    ],
    trustedRoots: [
      ...error.trustedRoots,
      ...lookupTrustedRoots,
      ...(authoringPack.kind === "package"
        ? [resourcePackWatchRoot(authoringPack)]
        : []),
    ],
  });
}

function withPackageFailureContext<T>(
  action: () => T,
  authoringPack: ResourcePack,
  declarationDependencies: readonly string[],
  lookupTrustedRoots: readonly ResourceWatchRoot[],
  lookupRetryParents: readonly string[],
): T {
  try {
    return action();
  } catch (error) {
    return enrichPackageFailure(
      error,
      authoringPack,
      declarationDependencies,
      lookupTrustedRoots,
      lookupRetryParents,
    );
  }
}

type ManifestFile = Readonly<{
  readonly manifestPath: string;
  readonly lexicalManifestPath: string;
}>;

function manifestPathDependencies(
  pack: ResourcePack,
  lexicalManifestPath: string,
): string[] {
  return metadataPaths(pack, lexicalManifestPath);
}

function assertManifestPathSafe(
  pack: ResourcePack,
  locator: RawResourceLocator,
  lexicalManifestPath: string,
): void {
  const dependencies = manifestPathDependencies(pack, lexicalManifestPath);
  if (!isResourcePackLexicalRootStable(pack)) {
    failResource(
      "unsafe-path",
      "package metadata root changed outside the resource root",
      { locator },
      {
        dependencies,
        unresolvedParents: [pack.root],
        ...packageTrustContext(pack),
      },
    );
  }
  if (isResourcePackLexicalPathSafe(pack, lexicalManifestPath)) return;
  failResource(
    "unsafe-path",
    "package metadata escapes the resource root",
    { locator },
    {
      dependencies,
      unresolvedParents: [pack.root],
      ...packageTrustContext(pack),
    },
  );
}

function manifestFile(
  pack: ResourcePack,
  locator: RawResourceLocator,
  missingCode: "package-not-declared" | "package-metadata-unreadable",
): ManifestFile {
  const lexicalManifestPath = join(pack.lexicalRoot, "package.json");
  assertManifestPathSafe(pack, locator, lexicalManifestPath);

  let manifestPath: string;
  try {
    manifestPath = realpathSync(lexicalManifestPath);
  } catch {
    return metadataFailure(
      missingCode,
      missingCode === "package-not-declared"
        ? "project package declaration is unavailable"
        : "package metadata is unavailable",
      locator,
      pack,
      lexicalManifestPath,
    );
  }
  if (!isResourcePackPathContained(pack, manifestPath))
    return failResource(
      "unsafe-path",
      "package metadata escapes the resource root",
      { locator },
      {
        dependencies: manifestPathDependencies(pack, lexicalManifestPath),
        unresolvedParents: [pack.root],
        ...packageTrustContext(pack),
      },
    );
  assertManifestPathSafe(pack, locator, lexicalManifestPath);
  try {
    if (lstatSync(manifestPath).isFile())
      return { manifestPath, lexicalManifestPath };
  } catch {
    // Fall through to the same typed metadata failure.
  }
  return metadataFailure(
    missingCode,
    "package metadata is not a regular file",
    locator,
    pack,
    manifestPath,
  );
}

function readManifestSource(
  pack: ResourcePack,
  locator: RawResourceLocator,
  manifest: ManifestFile,
  options: PackageResolutionOptions,
): string {
  try {
    assertManifestPathSafe(pack, locator, manifest.lexicalManifestPath);
    options.beforeRead?.(manifest.manifestPath);
    assertManifestPathSafe(pack, locator, manifest.lexicalManifestPath);
    return readFileSync(manifest.manifestPath, "utf8");
  } catch (error) {
    if (error instanceof ResourceResolutionError) throw error;
    return metadataFailure(
      "package-metadata-unreadable",
      "package metadata could not be read",
      locator,
      pack,
      manifest.manifestPath,
    );
  }
}

function assertManifestStable(
  pack: ResourcePack,
  locator: RawResourceLocator,
  manifest: ManifestFile,
): void {
  try {
    if (
      realpathSync(manifest.lexicalManifestPath) === manifest.manifestPath &&
      isResourcePackLexicalPathSafe(pack, manifest.lexicalManifestPath) &&
      isResourcePackLexicalRootStable(pack)
    )
      return;
  } catch {
    // Fall through to one deterministic safety failure.
  }
  failResource(
    "unsafe-path",
    "package metadata changed outside the resource root",
    { locator },
    {
      dependencies: metadataPaths(pack, manifest.manifestPath),
      unresolvedParents: [pack.root],
      ...packageTrustContext(pack),
    },
  );
}

function readManifest(
  pack: ResourcePack,
  locator: RawResourceLocator,
  missingCode: "package-not-declared" | "package-metadata-unreadable",
  options: PackageResolutionOptions,
): {
  readonly manifest: Record<string, unknown>;
  readonly manifestPath: string;
  readonly lexicalManifestPath: string;
} {
  const manifestFileValue = manifestFile(pack, locator, missingCode);
  const source = readManifestSource(pack, locator, manifestFileValue, options);
  assertManifestStable(pack, locator, manifestFileValue);
  let manifest: unknown;
  try {
    manifest = JSON.parse(source);
  } catch {
    return metadataFailure(
      "package-metadata-unreadable",
      "package metadata is not valid JSON",
      locator,
      pack,
      manifestFileValue.manifestPath,
    );
  }
  if (!isObject(manifest))
    return metadataFailure(
      "package-metadata-unreadable",
      "package metadata must be a JSON object",
      locator,
      pack,
      manifestFileValue.manifestPath,
    );
  return { manifest, ...manifestFileValue };
}

function projectManifest(
  pack: ResourcePack,
  locator: RawResourceLocator,
  options: PackageResolutionOptions,
): ProjectManifest {
  const lexicalManifestPath = join(pack.lexicalRoot, "package.json");
  assertManifestPathSafe(pack, locator, lexicalManifestPath);
  const cached = options.cache?.projectManifests.get(pack.root);
  if (cached) {
    const current = manifestFile(pack, locator, "package-not-declared");
    if (current.manifestPath === cached.manifestPath) return cached;
  }

  const loaded = readManifest(pack, locator, "package-not-declared", options);
  const manifest = loaded.manifest;
  const value = {
    manifestPath: loaded.manifestPath,
    lexicalManifestPath: loaded.lexicalManifestPath,
    dependencies: dependencyMap(manifest, "dependencies"),
    optionalDependencies: dependencyMap(manifest, "optionalDependencies"),
    devDependencies: dependencyMap(manifest, "devDependencies"),
  } satisfies ProjectManifest;
  const result = Object.freeze(value);
  options.cache?.projectManifests.set(pack.root, result);
  return result;
}

function isDeclared(name: string, manifest: ProjectManifest): boolean {
  return (
    Object.hasOwn(manifest.dependencies, name) ||
    Object.hasOwn(manifest.optionalDependencies, name) ||
    Object.hasOwn(manifest.devDependencies, name)
  );
}

function isRuntimeDependency(name: string, pack: ResourcePack): boolean {
  return Boolean(
    pack.package &&
      (Object.hasOwn(pack.package.dependencies, name) ||
        Object.hasOwn(pack.package.optionalDependencies, name)),
  );
}

function packageEntry(nodeModules: string, packageName: string): string {
  return join(nodeModules, ...packageName.split("/"));
}

function pathWithin(root: string, candidate: string): boolean {
  const pathToRoot = relative(root, candidate);
  return (
    pathToRoot === "" ||
    (pathToRoot !== ".." &&
      !pathToRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathToRoot))
  );
}

type AuthoringFileContext = Readonly<{
  readonly lexical: string;
  readonly canonical: string;
}>;

function unsafeAuthoringFile(locator: RawResourceLocator): never {
  return failResource(
    "unsafe-path",
    "authoring file is outside the resource root",
    { locator },
  );
}

function authoringFileContext(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
): AuthoringFileContext {
  const lexical = authoringLexicalPath(pack, locator, authoringFile);
  const canonical = canonicalAuthoringPath(
    pack,
    locator,
    authoringFile,
    lexical,
  );
  return authoringFileKind(pack, locator, authoringFile, lexical, canonical);
}

function canonicalAuthoringPath(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  lexical: string,
): string {
  try {
    const canonical = realpathSync(authoringFile);
    if (!pathWithin(pack.root, canonical)) return unsafeAuthoringFile(locator);
    return canonical;
  } catch {
    try {
      const parent = realpathSync(dirname(lexical));
      const canonical = join(parent, basename(lexical));
      if (!pathWithin(pack.root, canonical))
        return unsafeAuthoringFile(locator);
      return canonical;
    } catch {
      return failResource("missing-target", "authoring file is unavailable", {
        locator,
      });
    }
  }
}

function authoringFileKind(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  lexical: string,
  canonical: string,
): AuthoringFileContext {
  if (
    !isResourcePackLexicalRootStable(pack) ||
    !isResourcePackLexicalPathSafe(pack, lexical)
  )
    return unsafeAuthoringFile(locator);
  try {
    if (lstatSync(authoringFile).isFile()) return { lexical, canonical };
    if (!lstatSync(canonical).isFile())
      return failResource(
        "wrong-target-type",
        "authoring path is not a regular file",
        { locator },
      );
  } catch {
    if (pathWithin(pack.lexicalRoot, lexical) || pathWithin(pack.root, lexical))
      return { lexical, canonical };
    return failResource("missing-target", "authoring file is unavailable", {
      locator,
    });
  }
  return { lexical, canonical };
}

function authoringLexicalPath(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
): string {
  if (!isAbsolute(authoringFile))
    return failResource(
      "invalid-locator",
      "authoring file must be an absolute path",
      { locator },
    );
  const lexical = resolve(authoringFile);
  const lexicalTrusted =
    pathWithin(pack.lexicalRoot, lexical) || pathWithin(pack.root, lexical);
  if (
    !isResourcePackLexicalRootStable(pack) ||
    !lexicalTrusted ||
    !isResourcePackLexicalPathSafe(pack, lexical)
  )
    return unsafeAuthoringFile(locator);
  return lexical;
}

type PackageLookupScope = Readonly<{
  readonly root: string;
  readonly lexicalRoot: string;
  readonly external: boolean;
}>;

type PackageLookup = PackageLookupScope & {
  readonly searchCanonicalAncestors: boolean;
};

function packageLookupRoot(
  pack: ResourcePack,
  authoringFile: AuthoringFileContext,
): PackageLookup {
  const normalized =
    pack.kind === "package" ? authoringFile.canonical : authoringFile.lexical;
  const root = pathWithin(pack.lexicalRoot, normalized)
    ? pack.lexicalRoot
    : pack.root;
  if (pack.kind !== "package")
    return {
      root,
      lexicalRoot: root,
      external: false,
      searchCanonicalAncestors: false,
    };

  const packageParent = dirname(pack.root);
  if (basename(packageParent) === "node_modules")
    return {
      root: packageParent,
      lexicalRoot: packageParent,
      external: false,
      searchCanonicalAncestors: false,
    };
  const scopedPackageParent = dirname(packageParent);
  if (basename(scopedPackageParent) === "node_modules")
    return {
      root: scopedPackageParent,
      lexicalRoot: scopedPackageParent,
      external: false,
      searchCanonicalAncestors: false,
    };
  return {
    root: pack.root,
    lexicalRoot: pack.root,
    external: false,
    searchCanonicalAncestors: true,
  };
}

type SafeNodeModulesDirectory = Readonly<{
  readonly canonical: string;
  readonly lexical: string;
  readonly retrySafe: boolean;
  readonly trustedRoot?: ResourceWatchRoot;
}>;

type NodeModulesProbe =
  | SafeNodeModulesDirectory
  | { readonly unsafe: true }
  | undefined;

function nodeModulesLexicalPath(
  candidate: string,
  scope: PackageLookupScope,
): string {
  return scope.external
    ? resolve(scope.lexicalRoot, relative(scope.root, resolve(candidate)))
    : resolve(candidate);
}

function isSafeNodeModulesCandidate(
  pack: ResourcePack,
  candidate: string,
  scope: PackageLookupScope,
): boolean {
  return (
    isResourcePackLexicalRootStable(pack) &&
    (scope.external ||
      resolve(candidate) === resolve(scope.root) ||
      isResourcePackLexicalPathSafe(pack, candidate))
  );
}

function inspectNodeModulesDirectory(
  lexical: string,
  scope: PackageLookupScope,
  pack: ResourcePack,
): NodeModulesProbe {
  const lexicalStat = lstatSync(lexical);
  if (lexicalStat.isSymbolicLink()) return { unsafe: true };
  if (!lexicalStat.isDirectory()) return undefined;
  const canonical = realpathSync(lexical);
  const canonicalLookupRoot = realpathSync(scope.root);
  if (!pathWithin(canonicalLookupRoot, canonical)) return { unsafe: true };
  if (!lstatSync(canonical).isDirectory()) return undefined;
  return {
    canonical,
    lexical,
    retrySafe: scope.external || isResourcePackPathContained(pack, canonical),
    ...(scope.external
      ? {
          trustedRoot: Object.freeze({ canonical, lexical }),
        }
      : {}),
  };
}

function safeNodeModulesDirectory(
  pack: ResourcePack,
  candidate: string,
  scope: PackageLookupScope,
): NodeModulesProbe {
  if (!isSafeNodeModulesCandidate(pack, candidate, scope))
    return { unsafe: true };
  try {
    return inspectNodeModulesDirectory(
      nodeModulesLexicalPath(candidate, scope),
      scope,
      pack,
    );
  } catch {
    return undefined;
  }
}

type PackageParentSafety = "safe" | "missing" | "unsafe";

function packageParentStatSafety(parent: string): PackageParentSafety {
  try {
    const stat = lstatSync(parent);
    return stat.isDirectory() && !stat.isSymbolicLink() ? "safe" : "unsafe";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      ((error as { readonly code?: unknown }).code === "ENOENT" ||
        (error as { readonly code?: unknown }).code === "ENOTDIR")
    )
      return "missing";
    return "unsafe";
  }
}

function packageParentSafety(
  pack: ResourcePack,
  candidate: string,
  packageName: string,
  nodeModules: string,
): PackageParentSafety {
  if (!packageName.startsWith("@")) return "safe";
  const parent = dirname(candidate);
  if (isResourcePackLexicalPathSafe(pack, parent)) return "safe";
  if (resolve(dirname(parent)) !== resolve(nodeModules)) return "unsafe";
  return packageParentStatSafety(parent);
}

function probePackageEntry(
  pack: ResourcePack,
  nodeModules: string,
  packageName: string,
  canonicalNodeModules: string,
): {
  readonly candidate?: string;
  readonly retryParent?: string;
  readonly unsafe: boolean;
} {
  const candidate = packageEntry(nodeModules, packageName);
  const parentSafety = packageParentSafety(
    pack,
    candidate,
    packageName,
    nodeModules,
  );
  if (parentSafety === "unsafe") return { unsafe: true };
  if (parentSafety === "missing") return { unsafe: false };
  const retryParent = scopedPackageRetryParent(
    candidate,
    packageName,
    canonicalNodeModules,
  );
  try {
    const stat = lstatSync(candidate);
    if (stat.isDirectory() || stat.isSymbolicLink())
      return {
        candidate,
        unsafe: false,
        ...(retryParent ? { retryParent } : {}),
      };
  } catch {
    // Continue through normal node_modules parent lookup locations.
  }
  return { unsafe: false, ...(retryParent ? { retryParent } : {}) };
}

function scopedPackageRetryParent(
  candidate: string,
  packageName: string,
  canonicalNodeModules: string,
): string | undefined {
  if (!packageName.startsWith("@")) return undefined;
  const parent = dirname(candidate);
  try {
    const stat = lstatSync(parent);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return undefined;
    const canonical = realpathSync(parent);
    return pathWithin(canonicalNodeModules, canonical) ? canonical : undefined;
  } catch {
    return undefined;
  }
}

type PackageDirectory = Readonly<{
  readonly candidate?: string;
  readonly retryParents: readonly string[];
  readonly trustedRoots: readonly ResourceWatchRoot[];
  readonly unsafe: boolean;
}>;

type PackageDirectoryState = Omit<PackageDirectory, "candidate">;

type PackageDeclaration = Readonly<{
  readonly dependencies: readonly string[];
  readonly self: boolean;
}>;

function packageDeclaration(
  authoringPack: ResourcePack,
  locator: RawResourceLocator,
  packageName: string,
  options: PackageResolutionOptions,
): PackageDeclaration {
  if (authoringPack.kind === "package") {
    assertPackageAuthoringManifest(authoringPack, locator);
    if (authoringPack.package?.name === packageName)
      return { dependencies: [], self: true };
    if (!isRuntimeDependency(packageName, authoringPack))
      return failResource(
        "package-not-declared",
        "pack package references require a declared runtime dependency",
        { locator },
        {
          dependencies: resourcePackMetadataPaths(authoringPack),
          unresolvedParents: [authoringPack.root],
          ...packageTrustContext(authoringPack),
        },
      );
    return { dependencies: [], self: false };
  }
  const manifest = projectManifest(authoringPack, locator, options);
  if (!isDeclared(packageName, manifest))
    return failResource(
      "package-not-declared",
      "package locator is not declared by the project",
      { locator },
      {
        dependencies: metadataPaths(authoringPack, manifest.manifestPath),
        unresolvedParents: [authoringPack.root],
        ...packageTrustContext(authoringPack),
      },
    );
  return {
    dependencies: metadataPaths(authoringPack, manifest.manifestPath),
    self: false,
  };
}

function assertPackageAuthoringManifest(
  authoringPack: ResourcePack,
  locator: RawResourceLocator,
): void {
  const identity = authoringPack.package;
  if (!identity) return;

  let current: ManifestFile;
  try {
    current = manifestFile(
      authoringPack,
      locator,
      "package-metadata-unreadable",
    );
  } catch (error) {
    enrichPackageFailure(error, authoringPack, []);
  }
  if (current.manifestPath === identity.manifestPath) return;

  failResource(
    "unsafe-path",
    "package metadata identity changed",
    { locator },
    {
      dependencies: resourcePackMetadataPaths(authoringPack),
      unresolvedParents: [authoringPack.root],
      ...packageTrustContext(authoringPack),
    },
  );
}

function packageDirectory(
  pack: ResourcePack,
  authoringFile: AuthoringFileContext,
  packageName: string,
): PackageDirectory {
  const lookup = packageLookupRoot(pack, authoringFile);
  const local = searchPackageDirectory(
    pack,
    lookup,
    dirname(
      pack.kind === "package" ? authoringFile.canonical : authoringFile.lexical,
    ),
    packageName,
    { retryParents: [pack.root], trustedRoots: [], unsafe: false },
  );
  if (local.candidate || !lookup.searchCanonicalAncestors) return local;
  return searchCanonicalAncestors(pack, packageName, local);
}

function searchPackageDirectory(
  pack: ResourcePack,
  scope: PackageLookupScope,
  startingDirectory: string,
  packageName: string,
  initialState: PackageDirectoryState,
): PackageDirectory {
  let current = startingDirectory;
  let state = initialState;

  while (pathWithin(scope.root, current)) {
    const step = packageDirectoryStep(pack, scope, current, packageName, state);
    if (step.candidate) return step;
    state = packageDirectoryState(step);
    if (!step.next) break;
    current = step.next;
  }
  return state;
}

function searchCanonicalAncestors(
  pack: ResourcePack,
  packageName: string,
  initialState: PackageDirectoryState,
): PackageDirectory {
  let current = dirname(pack.root);
  let state = initialState;

  while (true) {
    const scope: PackageLookupScope = {
      root: current,
      lexicalRoot:
        resourcePackLexicalPathForCanonical(pack, current) ?? current,
      external: true,
    };
    const step = packageDirectoryStep(pack, scope, current, packageName, state);
    if (step.candidate) return step;
    state = packageDirectoryState(step);
    if (current === dirname(current)) break;
    current = dirname(current);
  }
  return state;
}

function packageDirectoryState(
  step: PackageDirectoryStep,
): PackageDirectoryState {
  return {
    retryParents: step.retryParents,
    trustedRoots: step.trustedRoots,
    unsafe: step.unsafe,
  };
}

function verifiedRetryParents(
  pack: ResourcePack,
  retryParents: readonly string[],
  canonical: string,
): readonly string[] {
  if (retryParents.includes(canonical)) return retryParents;
  if (retryParents.length === 1 && retryParents[0] === pack.root)
    return [canonical];
  return [...retryParents, canonical];
}

function packageDirectoryStep(
  pack: ResourcePack,
  scope: PackageLookupScope,
  current: string,
  packageName: string,
  state: PackageDirectoryState,
): PackageDirectoryStep {
  const nodeModules =
    basename(current) === "node_modules"
      ? current
      : join(current, "node_modules");
  const safeNodeModules = safeNodeModulesDirectory(pack, nodeModules, scope);
  if (safeNodeModules && "unsafe" in safeNodeModules)
    return nextPackageDirectory(
      scope.root,
      current,
      state.retryParents,
      true,
      state.trustedRoots,
    );
  if (!safeNodeModules)
    return nextPackageDirectory(
      scope.root,
      current,
      state.retryParents,
      state.unsafe,
      state.trustedRoots,
    );
  return packageDirectoryStepForSafeNodeModules(
    pack,
    scope,
    current,
    packageName,
    state,
    safeNodeModules,
  );
}

type PackageDirectoryStep = PackageDirectory & {
  readonly next?: string;
};

function replaceRetryParent(
  retryParents: readonly string[],
  current: string,
  replacement: string | undefined,
): readonly string[] {
  if (!replacement) return retryParents;
  return retryParents.map((parent) =>
    parent === current ? replacement : parent,
  );
}

function packageDirectoryStepForSafeNodeModules(
  pack: ResourcePack,
  scope: PackageLookupScope,
  current: string,
  packageName: string,
  state: PackageDirectoryState,
  safeNodeModules: SafeNodeModulesDirectory,
): PackageDirectoryStep {
  const retryParents = safeNodeModules.retrySafe
    ? verifiedRetryParents(pack, state.retryParents, safeNodeModules.canonical)
    : state.retryParents;
  const trustedRoots = safeNodeModules.trustedRoot
    ? [...state.trustedRoots, safeNodeModules.trustedRoot]
    : state.trustedRoots;
  const probe = probePackageEntry(
    pack,
    safeNodeModules.lexical,
    packageName,
    safeNodeModules.canonical,
  );
  const retryParentsForProbe = replaceRetryParent(
    retryParents,
    safeNodeModules.canonical,
    probe.retryParent,
  );
  if (probe.unsafe)
    return nextPackageDirectory(
      scope.root,
      current,
      retryParentsForProbe,
      true,
      trustedRoots,
    );
  if (probe.candidate)
    return {
      candidate: probe.candidate,
      retryParents: retryParentsForProbe,
      trustedRoots,
      unsafe: state.unsafe,
    };
  return nextPackageDirectory(
    scope.root,
    current,
    retryParentsForProbe,
    state.unsafe,
    trustedRoots,
  );
}

function nextPackageDirectory(
  root: string,
  current: string,
  retryParents: readonly string[],
  unsafe: boolean,
  trustedRoots: readonly ResourceWatchRoot[],
): PackageDirectoryStep {
  return {
    retryParents,
    trustedRoots,
    unsafe,
    ...(current === root ? {} : { next: dirname(current) }),
  };
}

function packageNotInstalled(
  authoringPack: ResourcePack,
  locator: RawResourceLocator,
  declarationDependencies: readonly string[],
  lookup: PackageDirectory,
): never {
  if (lookup.unsafe)
    return failResource(
      "unsafe-path",
      "package lookup leaves the resource root",
      { locator },
      {
        dependencies: packageFailureDependencies(
          authoringPack,
          declarationDependencies,
        ),
        unresolvedParents: lookup.retryParents,
        trustedRoots: [
          ...lookup.trustedRoots,
          ...(authoringPack.kind === "package"
            ? [resourcePackWatchRoot(authoringPack)]
            : []),
        ],
      },
    );
  return failResource(
    "package-not-installed",
    "declared package is not installed",
    { locator },
    {
      dependencies: packageFailureDependencies(
        authoringPack,
        declarationDependencies,
      ),
      unresolvedParents: lookup.retryParents,
      trustedRoots: [
        ...lookup.trustedRoots,
        ...(authoringPack.kind === "package"
          ? [resourcePackWatchRoot(authoringPack)]
          : []),
      ],
    },
  );
}

function candidatePackage(
  authoringPack: ResourcePack,
  locator: RawResourceLocator,
  declarationDependencies: readonly string[],
  lookup: PackageDirectory,
): ResourcePack {
  if (lookup.unsafe)
    return packageNotInstalled(
      authoringPack,
      locator,
      declarationDependencies,
      lookup,
    );
  if (!lookup.candidate)
    return packageNotInstalled(
      authoringPack,
      locator,
      declarationDependencies,
      lookup,
    );
  try {
    return createResourcePack(lookup.candidate, "package");
  } catch (error) {
    if (
      error instanceof ResourceResolutionError &&
      error.failure.code === "unsafe-path"
    )
      return enrichPackageFailure(
        error,
        authoringPack,
        declarationDependencies,
        lookup.trustedRoots,
        lookup.retryParents,
      );
    return failResource(
      "package-not-installed",
      "declared package is not installed as a directory",
      { locator },
      {
        dependencies: packageFailureDependencies(
          authoringPack,
          declarationDependencies,
        ),
        unresolvedParents: lookup.retryParents,
        trustedRoots: [
          ...lookup.trustedRoots,
          ...(authoringPack.kind === "package"
            ? [resourcePackWatchRoot(authoringPack)]
            : []),
        ],
      },
    );
  }
}

function sameDependencyMap(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function samePackageIdentity(
  left: ResourcePackageIdentity,
  right: ResourcePackageIdentity,
): boolean {
  return (
    left.name === right.name &&
    left.version === right.version &&
    left.manifestPath === right.manifestPath &&
    left.lexicalManifestPath === right.lexicalManifestPath &&
    sameDependencyMap(left.dependencies, right.dependencies) &&
    sameDependencyMap(left.optionalDependencies, right.optionalDependencies) &&
    sameDependencyMap(left.devDependencies, right.devDependencies)
  );
}

function packageRootReconstructionStable(
  candidatePack: ResourcePack,
  candidatePath: string,
  manifestPath: string,
): boolean {
  const lexicalManifestPath = join(candidatePack.lexicalRoot, "package.json");
  try {
    return (
      realpathSync(candidatePath) === candidatePack.root &&
      isResourcePackLexicalRootStable(candidatePack) &&
      isResourcePackLexicalPathSafe(candidatePack, lexicalManifestPath) &&
      realpathSync(lexicalManifestPath) === manifestPath
    );
  } catch {
    return false;
  }
}

function packageRootReconstructionFailure(
  candidatePack: ResourcePack,
  locator: RawResourceLocator,
  manifestPath: string,
  message: string,
): never {
  return failResource(
    "unsafe-path",
    message,
    { locator },
    {
      dependencies: metadataPaths(candidatePack, manifestPath),
      unresolvedParents: [candidatePack.root],
      ...packageTrustContext(candidatePack),
    },
  );
}

function reconstructSelectedPackage(
  candidatePack: ResourcePack,
  candidatePath: string,
  locator: RawResourceLocator,
  identity: ResourcePackageIdentity,
  options: PackageResolutionOptions,
): ResourcePack {
  if (
    !packageRootReconstructionStable(
      candidatePack,
      candidatePath,
      identity.manifestPath,
    )
  )
    return packageRootReconstructionFailure(
      candidatePack,
      locator,
      identity.manifestPath,
      "package root changed during resolution",
    );

  const currentIdentity = validatePackManifest(
    candidatePack,
    locator,
    identity.name,
    {
      ...options,
      beforeRead: undefined,
    },
  );
  if (!samePackageIdentity(currentIdentity, identity))
    return packageRootReconstructionFailure(
      candidatePack,
      locator,
      identity.manifestPath,
      "package metadata identity changed during resolution",
    );

  const pack = createResourcePack(candidatePath, "package", identity);
  if (
    pack.root === candidatePack.root &&
    packageRootReconstructionStable(
      candidatePack,
      candidatePath,
      identity.manifestPath,
    )
  )
    return pack;
  return packageRootReconstructionFailure(
    candidatePack,
    locator,
    identity.manifestPath,
    "package root changed during resolution",
  );
}

function selectedPackageManifest(
  authoringPack: ResourcePack,
  candidatePack: ResourcePack,
  locator: RawResourceLocator,
  packageName: string,
  declaration: PackageDeclaration,
  candidatePath: string,
  lookupTrustedRoots: readonly ResourceWatchRoot[],
  lookupRetryParents: readonly string[],
  options: PackageResolutionOptions,
): ResolvedPackage {
  const manifest = withPackageFailureContext(
    () => manifestFile(candidatePack, locator, "package-metadata-unreadable"),
    authoringPack,
    declaration.dependencies,
    lookupTrustedRoots,
    lookupRetryParents,
  );
  withPackageFailureContext(
    () => assertManifestStable(candidatePack, locator, manifest),
    authoringPack,
    declaration.dependencies,
    lookupTrustedRoots,
    lookupRetryParents,
  );
  const cached = options.cache?.packageMetadata.get(candidatePack.root);
  if (
    cached &&
    cached.manifestPath === manifest.manifestPath &&
    cached.name === packageName
  ) {
    options.beforePackageRootReconstruction?.(candidatePath);
    return cachedSelectedPackage(
      authoringPack,
      candidatePack,
      candidatePath,
      locator,
      declaration,
      manifest,
      cached,
      lookupTrustedRoots,
      lookupRetryParents,
      options,
    );
  }

  const identity = withPackageFailureContext(
    () => validatePackManifest(candidatePack, locator, packageName, options),
    authoringPack,
    declaration.dependencies,
    lookupTrustedRoots,
    lookupRetryParents,
  );
  const pack = withPackageFailureContext(
    () => {
      options.beforePackageRootReconstruction?.(candidatePath);
      return reconstructSelectedPackage(
        candidatePack,
        candidatePath,
        locator,
        identity,
        options,
      );
    },
    authoringPack,
    declaration.dependencies,
    lookupTrustedRoots,
    lookupRetryParents,
  );
  options.cache?.packageMetadata.set(
    pack.root,
    canonicalPackageMetadata(identity),
  );
  return { pack, dependencies: declaration.dependencies };
}

function cachedSelectedPackage(
  authoringPack: ResourcePack,
  candidatePack: ResourcePack,
  candidatePath: string,
  locator: RawResourceLocator,
  declaration: PackageDeclaration,
  manifest: ManifestFile,
  cached: CanonicalPackageMetadata,
  lookupTrustedRoots: readonly ResourceWatchRoot[],
  lookupRetryParents: readonly string[],
  options: PackageResolutionOptions,
): ResolvedPackage {
  try {
    return {
      pack: reconstructSelectedPackage(
        candidatePack,
        candidatePath,
        locator,
        packageIdentityForReference(cached, manifest.lexicalManifestPath),
        options,
      ),
      dependencies: declaration.dependencies,
    };
  } catch (error) {
    return enrichPackageFailure(
      error,
      authoringPack,
      declaration.dependencies,
      lookupTrustedRoots,
      lookupRetryParents,
    );
  }
}

function validatePackageIdentity(
  pack: ResourcePack,
  locator: RawResourceLocator,
  packageName: string,
  manifest: Record<string, unknown>,
  manifestPath: string,
): { readonly name: string; readonly version: string } {
  const name = manifest.name;
  const version = manifest.version;
  if (typeof name !== "string" || name !== packageName)
    return metadataFailure(
      "package-metadata-unreadable",
      "package metadata must declare the resolved package name and version",
      locator,
      pack,
      manifestPath,
    );
  if (typeof version !== "string" || !STRICT_SEMVER_PATTERN.test(version))
    return metadataFailure(
      "package-metadata-unreadable",
      "package metadata version must be a strict semver value",
      locator,
      pack,
      manifestPath,
    );
  return { name, version };
}

function validatePackFormat(
  pack: ResourcePack,
  locator: RawResourceLocator,
  manifest: Record<string, unknown>,
  manifestPath: string,
): void {
  const atlante = manifest.atlante;
  if (!isObject(atlante) || !Object.hasOwn(atlante, "format"))
    metadataFailure(
      "missing-pack-format",
      "package metadata must declare numeric atlante.format 1",
      locator,
      pack,
      manifestPath,
    );
  if (
    typeof atlante.format !== "number" ||
    !Number.isFinite(atlante.format) ||
    atlante.format !== 1
  )
    metadataFailure(
      "unsupported-pack-format",
      "package atlante.format is unsupported; expected numeric format 1",
      locator,
      pack,
      manifestPath,
    );
}

function validatePackManifest(
  pack: ResourcePack,
  locator: RawResourceLocator,
  packageName: string,
  options: PackageResolutionOptions,
): ResourcePackageIdentity {
  const loaded = readManifest(
    pack,
    locator,
    "package-metadata-unreadable",
    options,
  );
  const identity = validatePackageIdentity(
    pack,
    locator,
    packageName,
    loaded.manifest,
    loaded.manifestPath,
  );
  validatePackFormat(pack, locator, loaded.manifest, loaded.manifestPath);

  return Object.freeze({
    name: identity.name,
    version: identity.version,
    manifestPath: loaded.manifestPath,
    lexicalManifestPath: loaded.lexicalManifestPath,
    dependencies: dependencyMap(loaded.manifest, "dependencies"),
    optionalDependencies: dependencyMap(
      loaded.manifest,
      "optionalDependencies",
    ),
    devDependencies: dependencyMap(loaded.manifest, "devDependencies"),
  });
}

function canonicalPackageMetadata(
  identity: ResourcePackageIdentity,
): CanonicalPackageMetadata {
  return {
    name: identity.name,
    version: identity.version,
    manifestPath: identity.manifestPath,
    dependencies: identity.dependencies,
    optionalDependencies: identity.optionalDependencies,
    devDependencies: identity.devDependencies,
  };
}

function packageIdentityForReference(
  metadata: CanonicalPackageMetadata,
  lexicalManifestPath: string,
): ResourcePackageIdentity {
  return {
    ...metadata,
    lexicalManifestPath,
  };
}

function firstPartyRootChanged(
  pack: ResourcePack,
  locator: RawResourceLocator,
): never {
  return failResource(
    "unsafe-path",
    "first-party package root changed",
    { locator },
    {
      dependencies: resourcePackMetadataPaths(pack),
      unresolvedParents: [pack.root],
      trustedRoots: [resourcePackWatchRoot(pack)],
    },
  );
}

function refreshFirstPartyPack(
  pack: ResourcePack,
  locator: RawResourceLocator,
): ResourcePack {
  if (!isResourcePackLexicalRootStable(pack))
    return firstPartyRootChanged(pack, locator);

  const refreshed = createPackageResourcePackWithLocator(
    pack.lexicalRoot,
    "@atlante/pack",
    locator,
  );
  if (refreshed.root !== pack.root) return firstPartyRootChanged(pack, locator);
  return refreshed;
}

/** Resolves one package locator without scanning node_modules or loading code. */
export function resolvePackageResourcePack(
  authoringPack: ResourcePack,
  locator: PackageLocator,
  authoringFile: string,
  options: PackageResolutionOptions = {},
): ResolvedPackage {
  const packageName = locator.packageName;
  const authoringContext = authoringFileContext(
    authoringPack,
    locator.value,
    authoringFile,
  );
  const firstPartyPack =
    authoringPack.kind === "project" &&
    packageName === "@atlante/pack" &&
    options.resourceContext?.firstPartyPack?.kind === "package" &&
    options.resourceContext.firstPartyPack.package?.name === packageName
      ? options.resourceContext.firstPartyPack
      : undefined;
  if (firstPartyPack) {
    const cacheKey = firstPartyPack.root;
    const refreshed =
      options.cache?.firstPartyPacks.get(cacheKey) ??
      refreshFirstPartyPack(firstPartyPack, locator.value);
    options.cache?.firstPartyPacks.set(cacheKey, refreshed);
    return {
      pack: refreshed,
      dependencies: resourcePackMetadataPaths(refreshed),
    };
  }

  const declaration = packageDeclaration(
    authoringPack,
    locator.value,
    packageName,
    options,
  );
  if (declaration.self) return { pack: authoringPack, dependencies: [] };

  const lookup = packageDirectory(authoringPack, authoringContext, packageName);
  const candidatePack = candidatePackage(
    authoringPack,
    locator.value,
    declaration.dependencies,
    lookup,
  );
  const candidatePath = lookup.candidate;
  if (!candidatePath)
    return packageNotInstalled(
      authoringPack,
      locator.value,
      declaration.dependencies,
      lookup,
    );
  return selectedPackageManifest(
    authoringPack,
    candidatePack,
    locator.value,
    packageName,
    declaration,
    candidatePath,
    lookup.trustedRoots,
    lookup.retryParents,
    options,
  );
}

export function packageSubpathCandidate(
  pack: ResourcePack,
  subpath: string | undefined,
): { readonly candidate: string; readonly kind: "resource" | "preset" } {
  if (!subpath) return { candidate: pack.lexicalRoot, kind: "preset" };
  return { candidate: join(pack.lexicalRoot, subpath), kind: "resource" };
}
