import { realpathSync } from "node:fs";
import { join } from "node:path";
import {
  createResourcePack,
  isResourcePackLexicalPathSafe,
  isResourcePackLexicalRootStable,
  type ResourcePack,
  resourcePackMetadataPaths,
  resourcePackWatchRoot,
} from "./content-root.js";
import { failResource, ResourceResolutionError } from "./errors.js";
import {
  type CanonicalPackageMetadata,
  dependencyMap,
  enrichPackageFailure,
  isObject,
  metadataFailure,
  metadataPaths,
  type PackageResolutionOptions,
  packageFailureDependencies,
  packageTrustContext,
  type ResolvedPackage,
  STRICT_SEMVER_PATTERN,
  withPackageFailureContext,
} from "./package-common.js";
import {
  type PackageDeclaration,
  type PackageDirectory,
  packageNotInstalled,
} from "./package-lookup.js";
import {
  assertManifestStable,
  type ManifestFile,
  manifestFile,
  readManifest,
} from "./package-manifest.js";
import type {
  RawResourceLocator,
  ResourcePackageIdentity,
  ResourceWatchRoot,
} from "./types.js";

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

export function candidatePackage(
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

export function selectedPackageManifest(
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

function providedRootChanged(
  pack: ResourcePack,
  locator: RawResourceLocator,
): never {
  return failResource(
    "unsafe-path",
    "provided package root changed",
    { locator },
    {
      dependencies: resourcePackMetadataPaths(pack),
      unresolvedParents: [pack.root],
      trustedRoots: [resourcePackWatchRoot(pack)],
    },
  );
}

export function refreshProvidedPack(
  provided: ResourcePack,
  packageName: string,
  locator: RawResourceLocator,
): ResourcePack {
  if (!isResourcePackLexicalRootStable(provided))
    return providedRootChanged(provided, locator);

  const refreshed = createPackageResourcePackWithLocator(
    provided.lexicalRoot,
    packageName,
    locator,
  );
  if (refreshed.root !== provided.root)
    return providedRootChanged(provided, locator);
  return refreshed;
}
