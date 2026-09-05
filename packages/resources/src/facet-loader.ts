import { basename, join } from "node:path";
import {
  isResourcePackPathContained,
  type ResourcePack,
  resourcePackMetadataPaths,
} from "./content-root.js";
import {
  failResource,
  normalizeResourcePaths,
  ResourceResolutionError,
} from "./errors.js";
import {
  type FacetCandidate,
  facetCandidateNames,
  inspectFacetCandidates,
  type LoadedResource,
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
} from "./facets.js";
import type { JsoncLocation } from "./jsonc.js";
import { createPackageResolutionCache } from "./package-resolution.js";
import type { ResolutionTraversal } from "./resolution-traversal.js";
import type {
  LoadedFacet,
  ResourceResolveOptions,
} from "./resolution-types.js";
import { authoringContext } from "./resolution-values.js";
import {
  type ResolvedResourceTarget,
  type ResourceLocatorOptions,
  resolveResourceLocator,
  resourceCandidateWatchPaths,
} from "./resource-targets.js";
import type {
  InstanceFacet,
  Preset,
  RawResourceLocator,
  TemplateFacet,
} from "./types.js";

type FacetCacheKind = "template" | "instance" | "preset";

type CachedFacetCandidate = Readonly<{
  readonly name: FacetCandidate["name"];
  readonly path?: string;
}>;

type CachedFacet = Readonly<{
  readonly facet: TemplateFacet | InstanceFacet | Preset;
  readonly canonicalDependencies: readonly string[];
  readonly candidates: readonly CachedFacetCandidate[];
  readonly locations?: Readonly<Record<string, JsoncLocation>>;
}>;

function cachedFacetDependencies(
  target: ResolvedResourceTarget,
  facet: CachedFacet["facet"],
  canonicalDependencies: readonly string[],
): readonly string[] {
  return normalizeResourcePaths([
    ...canonicalDependencies,
    ...target.resolutionDependencies,
    ...resourcePackMetadataPaths(target.pack),
    target.lexicalDirectory,
    ...facetCandidateNames(facet.kind).flatMap((name) =>
      resourceCandidateWatchPaths(target, name),
    ),
  ]);
}

function facetCandidateIdentities(
  candidates: readonly FacetCandidate[],
): readonly CachedFacetCandidate[] {
  return Object.freeze(
    candidates.map(({ name, file }) =>
      Object.freeze({ name, ...(file ? { path: file.path } : {}) }),
    ),
  );
}

function sameFacetCandidateIdentities(
  expected: readonly CachedFacetCandidate[],
  current: readonly FacetCandidate[],
): boolean {
  return (
    expected.length === current.length &&
    expected.every((candidate, index) => {
      const observed = current[index];
      return (
        observed?.name === candidate.name &&
        observed.file?.path === candidate.path
      );
    })
  );
}

function facetCacheFailure(
  target: ResolvedResourceTarget,
  facet: FacetCacheKind,
  locator: RawResourceLocator,
  dependencies: readonly string[] = [],
): never {
  return failResource(
    "unsafe-path",
    "resource file changed outside the resource root",
    { locator },
    {
      dependencies: normalizeResourcePaths([
        ...target.resolutionDependencies,
        ...resourcePackMetadataPaths(target.pack),
        target.directory,
        target.lexicalDirectory,
        ...facetCandidateNames(facet).flatMap((name) =>
          resourceCandidateWatchPaths(target, name),
        ),
        ...dependencies,
      ]),
      unresolvedParents: [target.directory],
    },
  );
}

function inspectFacetCandidatesForCache(
  target: ResolvedResourceTarget,
  facet: FacetCacheKind,
  locator: RawResourceLocator,
  dependencies: readonly string[] = [],
): readonly FacetCandidate[] {
  try {
    return inspectFacetCandidates(target, facet, locator, dependencies);
  } catch (error) {
    if (error instanceof ResourceResolutionError) {
      return facetCacheFailure(target, facet, locator, [
        ...dependencies,
        ...error.dependencies,
      ]);
    }
    throw error;
  }
}

function requireTarget(
  pack: ResourcePack,
  locator: RawResourceLocator,
  authoringFile: string,
  options: ResourceLocatorOptions = {},
): ResolvedResourceTarget {
  // Kept as a small seam so every facet read still goes through the locator
  // safety checks before the selected facet loader opens a file.
  return resolveResourceLocator(pack, locator, authoringFile, options);
}

/**
 * Facet read seam: resolves targets through the locator checks, loads
 * template/instance/preset facets, and keeps the cross-request facet cache
 * with its TOCTOU candidate-identity checks.
 */
export class FacetLoader {
  private readonly packageCache = createPackageResolutionCache();
  private readonly facetCache = new Map<string, CachedFacet>();

  constructor(
    private readonly traversal: ResolutionTraversal,
    private readonly beforeRead: ResourceResolveOptions["beforeRead"],
    private readonly resourceContext: ResourceResolveOptions["resourceContext"],
  ) {}

  private locatorOptions(): ResourceLocatorOptions {
    return {
      packageCache: this.packageCache,
      beforeRead: this.beforeRead,
      resourceContext: this.resourceContext,
    };
  }

  private loadedFile<T extends TemplateFacet | InstanceFacet | Preset>(
    pack: ResourcePack,
    target: ResolvedResourceTarget,
    loaded: LoadedResource<T>,
  ): LoadedFacet<T> {
    this.traversal.collectPack(pack);
    this.traversal.collect(loaded);
    return {
      pack,
      target,
      loaded,
      authoring: authoringContext(
        pack,
        join(target.lexicalDirectory, basename(loaded.facet.origin.path)),
        loaded.locations,
      ),
    };
  }

  loadTemplate(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ): LoadedFacet<TemplateFacet> {
    const target = requireTarget(pack, locator, authoringFile, {
      ...this.locatorOptions(),
    });
    this.traversal.collectPack(target.pack);
    return this.cachedFacet(target, "template", () =>
      loadTemplateFacet(pack, locator, authoringFile, {
        ...this.locatorOptions(),
      }),
    );
  }

  loadInstance(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ): LoadedFacet<InstanceFacet> {
    const target = requireTarget(pack, locator, authoringFile, {
      ...this.locatorOptions(),
    });
    this.traversal.collectPack(target.pack);
    return this.cachedFacet(target, "instance", () =>
      loadInstanceFacet(pack, locator, authoringFile, {
        ...this.locatorOptions(),
      }),
    );
  }

  loadPreset(
    pack: ResourcePack,
    locator: RawResourceLocator,
    authoringFile: string,
  ): LoadedFacet<Preset> {
    const target = requireTarget(pack, locator, authoringFile, {
      ...this.locatorOptions(),
    });
    this.traversal.collectPack(target.pack);
    return this.cachedFacet(target, "preset", () =>
      loadPresetFacet(pack, locator, authoringFile, {
        ...this.locatorOptions(),
      }),
    );
  }

  private cachedFacet<T extends TemplateFacet | InstanceFacet | Preset>(
    target: ResolvedResourceTarget,
    facet: FacetCacheKind,
    load: () => LoadedResource<T>,
  ): LoadedFacet<T> {
    const cacheKey = `${target.cacheKey}\u0000${facet}`;
    if (target.pack.kind === "package") {
      const cached = this.facetCache.get(cacheKey);
      if (cached) {
        const candidates = inspectFacetCandidatesForCache(
          target,
          facet,
          target.locator,
          cached.canonicalDependencies,
        );
        if (!sameFacetCandidateIdentities(cached.candidates, candidates)) {
          return facetCacheFailure(
            target,
            facet,
            target.locator,
            cached.canonicalDependencies,
          );
        }
        return this.loadedFile(
          target.pack,
          target,
          Object.freeze({
            facet: Object.freeze({
              ...cached.facet,
              locator: target.locator,
            }) as T,
            dependencies: Object.freeze(
              cachedFacetDependencies(
                target,
                cached.facet,
                cached.canonicalDependencies,
              ),
            ),
            unresolvedParents: Object.freeze([]),
            ...(cached.locations
              ? { locations: Object.freeze({ ...cached.locations }) }
              : {}),
          }),
        );
      }
    }
    if (target.pack.kind === "package") {
      const initialCandidates = inspectFacetCandidatesForCache(
        target,
        facet,
        target.locator,
      );
      const loaded = load();
      const finalCandidates = inspectFacetCandidatesForCache(
        target,
        facet,
        target.locator,
        loaded.dependencies,
      );
      if (
        !sameFacetCandidateIdentities(
          facetCandidateIdentities(initialCandidates),
          finalCandidates,
        )
      ) {
        return facetCacheFailure(
          target,
          facet,
          target.locator,
          loaded.dependencies,
        );
      }
      this.facetCache.set(
        cacheKey,
        Object.freeze({
          facet: loaded.facet,
          canonicalDependencies: Object.freeze(
            normalizeResourcePaths(
              loaded.dependencies.filter((path) =>
                isResourcePackPathContained(target.pack, path),
              ),
            ),
          ),
          candidates: facetCandidateIdentities(finalCandidates),
          ...(loaded.locations ? { locations: loaded.locations } : {}),
        }),
      );
      return this.loadedFile(
        target.pack,
        target,
        Object.freeze({
          ...loaded,
          dependencies: Object.freeze(
            cachedFacetDependencies(
              target,
              loaded.facet,
              loaded.dependencies.filter((path) =>
                isResourcePackPathContained(target.pack, path),
              ),
            ),
          ),
        }),
      );
    }
    const loaded = load();
    return this.loadedFile(target.pack, target, loaded);
  }
}
