import { lstatSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import {
  isResourcePackLexicalPathSafe,
  isResourcePackLexicalRootStable,
  isResourcePackPathContained,
  type ResourcePack,
  resourcePackLexicalPathForCanonical,
  resourcePackMetadataPaths,
  resourcePackWatchRoot,
} from "./content-root.js";
import { failResource } from "./errors.js";
import {
  enrichPackageFailure,
  metadataPaths,
  type PackageResolutionOptions,
  packageFailureDependencies,
  packageTrustContext,
} from "./package-common.js";
import {
  isDeclared,
  isRuntimeDependency,
  type ManifestFile,
  manifestFile,
  packageEntry,
  pathWithin,
  projectManifest,
} from "./package-manifest.js";
import type { RawResourceLocator, ResourceWatchRoot } from "./types.js";

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

export function authoringFileContext(
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

export type PackageDirectory = Readonly<{
  readonly candidate?: string;
  readonly retryParents: readonly string[];
  readonly trustedRoots: readonly ResourceWatchRoot[];
  readonly unsafe: boolean;
}>;

type PackageDirectoryState = Omit<PackageDirectory, "candidate">;

export type PackageDeclaration = Readonly<{
  readonly dependencies: readonly string[];
  readonly self: boolean;
}>;

export function packageDeclaration(
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

export function packageDirectory(
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

  const visited = new Set<string>();
  for (const _ of resolve(current)) {
    if (!pathWithin(scope.root, current)) break;
    if (visited.has(current)) break;
    visited.add(current);
    const step = packageDirectoryStep(pack, scope, current, packageName, state);
    if (step.candidate) return step;
    state = packageDirectoryState(step);
    if (!step.next) break;
    if (step.next === current) break;
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

  const visited = new Set<string>();
  for (const _ of resolve(current)) {
    if (visited.has(current)) break;
    visited.add(current);
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
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
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

export function packageNotInstalled(
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
