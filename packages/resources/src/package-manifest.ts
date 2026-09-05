import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import {
  isResourcePackLexicalPathSafe,
  isResourcePackLexicalRootStable,
  isResourcePackPathContained,
  type ResourcePack,
} from "./content-root.js";
import { failResource, ResourceResolutionError } from "./errors.js";
import {
  DECLARED_DEPENDENCY_GROUPS,
  dependencyMap,
  isObject,
  metadataFailure,
  metadataPaths,
  type PackageResolutionOptions,
  type ProjectManifest,
  packageTrustContext,
} from "./package-common.js";
import type { RawResourceLocator } from "./types.js";

export type ManifestFile = Readonly<{
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

export function manifestFile(
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

export function assertManifestStable(
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

export function readManifest(
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

export function projectManifest(
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

export function isDeclared(name: string, manifest: ProjectManifest): boolean {
  return DECLARED_DEPENDENCY_GROUPS.some((group) =>
    Object.hasOwn(manifest[group], name),
  );
}

export function isRuntimeDependency(name: string, pack: ResourcePack): boolean {
  return Boolean(
    pack.package &&
      (Object.hasOwn(pack.package.dependencies, name) ||
        Object.hasOwn(pack.package.optionalDependencies, name)),
  );
}

export function packageEntry(nodeModules: string, packageName: string): string {
  return join(nodeModules, ...packageName.split("/"));
}

export function pathWithin(root: string, candidate: string): boolean {
  const pathToRoot = relative(root, candidate);
  return (
    pathToRoot === "" ||
    (pathToRoot !== ".." &&
      !pathToRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathToRoot))
  );
}
