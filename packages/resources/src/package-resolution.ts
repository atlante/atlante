import { join } from "node:path";
import {
  type ResourcePack,
  resourcePackMetadataPaths,
} from "./content-root.js";
import {
  candidatePackage,
  createPackageResourcePack,
  refreshProvidedPack,
  selectedPackageManifest,
} from "./package-candidate.js";
import {
  isPackageDeclared,
  type PackageLocator,
  type PackageResolutionCache,
  type PackageResolutionOptions,
  type ResolvedPackage,
} from "./package-common.js";
import {
  authoringFileContext,
  packageDeclaration,
  packageDirectory,
  packageNotInstalled,
} from "./package-lookup.js";

export type {
  PackageResolutionCache,
  PackageResolutionOptions,
  ResolvedPackage,
} from "./package-common.js";
export { createPackageResourcePack, isPackageDeclared };

export function createPackageResolutionCache(): PackageResolutionCache {
  return {
    projectManifests: new Map(),
    packageMetadata: new Map(),
    providedPacks: new Map(),
  };
}

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
  const provided =
    authoringPack.kind === "project"
      ? options.resourceContext?.packageProvider?.(packageName)
      : undefined;
  if (provided) {
    const cacheKey = provided.root;
    const refreshed =
      options.cache?.providedPacks.get(cacheKey) ??
      refreshProvidedPack(provided, packageName, locator.value);
    options.cache?.providedPacks.set(cacheKey, refreshed);
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
