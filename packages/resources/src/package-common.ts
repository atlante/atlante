import { join } from "node:path";
import {
  type ResourcePack,
  type ResourceResolutionContext,
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
import type { RawResourceLocator, ResourceWatchRoot } from "./types.js";

export const STRICT_SEMVER_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![\s\S])/;

export type PackageLocator = Extract<
  ParsedResourceLocator,
  { readonly kind: "package" }
>;

export type ProjectManifest = Readonly<{
  readonly manifestPath: string;
  readonly lexicalManifestPath: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}>;

/** Request-local package resolution state. It must never be shared globally. */
export type CanonicalPackageMetadata = Readonly<{
  readonly name: string;
  readonly version: string;
  readonly manifestPath: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly devDependencies: Readonly<Record<string, string>>;
}>;

export function packageTrustContext(pack: ResourcePack): {
  readonly trustedRoots?: readonly ResourceWatchRoot[];
} {
  return pack.kind === "package"
    ? { trustedRoots: [resourcePackWatchRoot(pack)] }
    : {};
}

export type PackageResolutionCache = {
  readonly projectManifests: Map<string, ProjectManifest>;
  readonly packageMetadata: Map<string, CanonicalPackageMetadata>;
  readonly providedPacks: Map<string, ResourcePack>;
};

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

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Dependency groups package resolution reads when checking declarations.
 * `peerDependencies` is deliberately excluded: a peer-only declaration does
 * not resolve, so packages must be declared in a group that installs them.
 */
export type DeclaredDependencyGroup =
  | "dependencies"
  | "optionalDependencies"
  | "devDependencies";

export const DECLARED_DEPENDENCY_GROUPS: readonly DeclaredDependencyGroup[] = [
  "dependencies",
  "optionalDependencies",
  "devDependencies",
];

export function dependencyMap(
  manifest: Record<string, unknown>,
  key: DeclaredDependencyGroup,
): Readonly<Record<string, string>> {
  const value = manifest[key];
  if (!isObject(value)) return {};
  const output: Record<string, string> = {};
  for (const [name, version] of Object.entries(value)) {
    if (typeof version === "string") output[name] = version;
  }
  return Object.freeze(output);
}

/**
 * Whether a raw project manifest declares the package in a dependency group
 * package resolution reads: `dependencies`, `optionalDependencies`, or
 * `devDependencies` — never `peerDependencies`, because a peer-only
 * declaration does not resolve. Entries are normalized exactly like
 * `projectManifest`, so declaration checks cannot drift from resolution.
 */
export function isPackageDeclared(
  manifest: Record<string, unknown>,
  packageName: string,
): boolean {
  return DECLARED_DEPENDENCY_GROUPS.some((group) =>
    Object.hasOwn(dependencyMap(manifest, group), packageName),
  );
}

export function metadataPaths(
  pack: ResourcePack,
  manifestPath: string,
): string[] {
  return normalizeResourcePaths([
    manifestPath,
    join(pack.lexicalRoot, "package.json"),
    ...resourcePackLexicalRootSymlinkPaths(pack),
  ]);
}

export function metadataFailure(
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

export function packageFailureDependencies(
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

export function enrichPackageFailure(
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

export function withPackageFailureContext<T>(
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
