import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  type ResourcePack,
  type ResourceResolutionContext,
  resourcePackMetadataPaths,
  resourcePackWatchRoot,
} from "./content-root.js";
import {
  failResource,
  normalizeResourcePaths,
  ResourceResolutionError,
} from "./errors.js";
import { parseResourceLocator } from "./locator.js";
import {
  type PackageResolutionCache,
  packageSubpathCandidate,
  resolvePackageResourcePack,
} from "./package-resolution.js";
import { isRootPath, isWithin, stableRelative } from "./resource-paths.js";
import {
  candidateWatchPaths,
  safeParentFor,
  symlinkTraversal,
  unresolvedParents,
} from "./symlink-watch.js";
import type {
  RawResourceLocator,
  ResourceWatchRoot,
  ValidatedResourceLocator,
} from "./types.js";

export type ResourceTargetKind = "resource" | "preset";

export type ResourceLocatorOptions = Readonly<{
  readonly packageCache?: PackageResolutionCache;
  readonly beforeRead?: (path: string) => void;
  readonly resourceContext?: ResourceResolutionContext;
}>;

export type ResolvedResourceTarget = Readonly<{
  readonly pack: ResourcePack;
  readonly locator: ValidatedResourceLocator;
  /** Canonical target directory, never the authored lexical path. */
  readonly directory: string;
  /** Authored lexical target directory used only for watch reconciliation. */
  readonly lexicalDirectory: string;
  readonly kind: ResourceTargetKind;
  /** Package/project manifest inputs used to resolve this target. */
  readonly resolutionDependencies: readonly string[];
  /** Stable canonical root-relative target identity. */
  readonly cacheKey: string;
}>;

export type ResourceFailureContext = {
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
  readonly trustedRoots?: readonly ResourceWatchRoot[];
};

export function withPackTrust(
  pack: ResourcePack,
  context: Omit<ResourceFailureContext, "trustedRoots">,
): ResourceFailureContext {
  return {
    ...context,
    ...(pack.kind === "package"
      ? { trustedRoots: [resourcePackWatchRoot(pack)] }
      : {}),
  };
}

export function targetResolutionDependencies(
  pack: ResourcePack,
  resolutionDependencies: readonly string[] = [],
  dependencies: readonly string[] = [],
): string[] {
  return normalizeResourcePaths([
    ...resolutionDependencies,
    ...resourcePackMetadataPaths(pack),
    ...dependencies,
  ]);
}

export function candidateContext(
  pack: ResourcePack,
  candidate: string,
  resolutionDependencies: readonly string[] = [],
): ResourceFailureContext {
  const traversal = symlinkTraversal(pack, candidate);
  return withPackTrust(pack, {
    dependencies: targetResolutionDependencies(
      pack,
      resolutionDependencies,
      candidateWatchPaths(pack, candidate),
    ),
    unresolvedParents: normalizeResourcePaths([
      ...safeParentFor(pack, candidate),
      ...traversal.unresolvedParents,
    ]),
  });
}

export function targetContext(
  target: ResolvedResourceTarget,
  candidate = target.lexicalDirectory,
): ResourceFailureContext {
  return withPackTrust(target.pack, {
    dependencies: targetResolutionDependencies(
      target.pack,
      target.resolutionDependencies,
      [target.directory, ...candidateWatchPaths(target.pack, candidate)],
    ),
    unresolvedParents: [target.directory],
  });
}

export type AuthoringDirectory = Readonly<{
  readonly canonical: string;
  readonly lexical: string;
}>;

export function canonicalMissingAuthoringDirectory(
  pack: ResourcePack,
  authoringFile: string,
  locator: RawResourceLocator,
  lexical: string,
): AuthoringDirectory {
  const directory = dirname(authoringFile);
  let canonicalDirectory: string;
  try {
    canonicalDirectory = realpathSync(directory);
  } catch {
    return failResource("missing-target", "authoring file is unavailable", {
      locator,
    });
  }
  if (!isWithin(pack.root, canonicalDirectory)) {
    return failResource(
      "unsafe-path",
      "authoring file is outside the resource root",
      { locator },
    );
  }
  return { canonical: canonicalDirectory, lexical };
}

export function canonicalAuthoringFile(
  pack: ResourcePack,
  authoringFile: string,
  locator: RawResourceLocator,
  lexical: string,
): AuthoringDirectory {
  let authoringPath: string;
  try {
    authoringPath = realpathSync(authoringFile);
  } catch {
    return canonicalMissingAuthoringDirectory(
      pack,
      authoringFile,
      locator,
      lexical,
    );
  }

  let authoringIsFile: boolean;
  try {
    authoringIsFile = lstatSync(authoringPath).isFile();
  } catch {
    return failResource("missing-target", "authoring file is unavailable", {
      locator,
    });
  }
  if (!authoringIsFile) {
    return failResource(
      "wrong-target-type",
      "authoring path is not a regular file",
      { locator },
    );
  }

  const directory = dirname(authoringPath);
  if (!isWithin(pack.root, directory)) {
    return failResource(
      "unsafe-path",
      "authoring file is outside the resource root",
      { locator },
    );
  }
  return { canonical: directory, lexical };
}

export function targetFailure(
  pack: ResourcePack,
  locator: RawResourceLocator,
  candidate: string,
  resolutionDependencies: readonly string[] = [],
): never {
  const parents = unresolvedParents(pack, candidate);
  const context = candidateContext(pack, candidate, resolutionDependencies);
  const traversal = symlinkTraversal(pack, candidate);
  if (parents.kind === "escaped" || traversal.escaped) {
    return failResource(
      "unsafe-path",
      "resource target escapes the resource root",
      {
        locator,
      },
      context,
    );
  }
  return failResource(
    "missing-target",
    "resource target is unavailable",
    { locator },
    withPackTrust(pack, {
      dependencies: context.dependencies,
      unresolvedParents: normalizeResourcePaths([
        ...parents.paths,
        ...context.unresolvedParents,
        ...traversal.unresolvedParents,
      ]),
    }),
  );
}

export function canonicalAuthoringDirectory(
  pack: ResourcePack,
  authoringFile: string,
  locator: RawResourceLocator,
): AuthoringDirectory {
  if (!isAbsolute(authoringFile)) {
    return failResource(
      "invalid-locator",
      "authoring file must be an absolute path",
      { locator },
    );
  }

  const lexicalFile = resolve(authoringFile);
  if (!isRootPath(pack, lexicalFile)) {
    return failResource(
      "unsafe-path",
      "authoring file is outside the resource root",
      { locator },
    );
  }
  if (symlinkTraversal(pack, lexicalFile).escaped) {
    return failResource(
      "unsafe-path",
      "authoring file is outside the resource root",
      { locator },
      candidateContext(pack, lexicalFile),
    );
  }
  return canonicalAuthoringFile(
    pack,
    authoringFile,
    locator,
    dirname(lexicalFile),
  );
}

export function canonicalDirectory(
  pack: ResourcePack,
  locator: RawResourceLocator,
  candidate: string,
  resolutionDependencies: readonly string[] = [],
): string {
  if (symlinkTraversal(pack, candidate).escaped) {
    return failResource(
      "unsafe-path",
      "resource target escapes the resource root",
      { locator },
      candidateContext(pack, candidate, resolutionDependencies),
    );
  }

  let target: string;
  try {
    target = realpathSync(candidate);
  } catch {
    return targetFailure(pack, locator, candidate, resolutionDependencies);
  }
  if (!isWithin(pack.root, target)) {
    return failResource(
      "unsafe-path",
      "resource target escapes the resource root",
      {
        locator,
      },
      candidateContext(pack, candidate, resolutionDependencies),
    );
  }

  let targetIsDirectory: boolean;
  try {
    targetIsDirectory = lstatSync(target).isDirectory();
  } catch {
    return targetFailure(pack, locator, candidate, resolutionDependencies);
  }
  if (!targetIsDirectory) {
    return failResource(
      "wrong-target-type",
      "resource target is not a directory",
      {
        locator,
      },
      candidateContext(pack, candidate, resolutionDependencies),
    );
  }
  return target;
}

export type PreparedResourceTarget = Readonly<{
  readonly pack: ResourcePack;
  readonly candidate: string;
  readonly lexicalDirectory: string;
  readonly kind: ResourceTargetKind;
  readonly resolutionDependencies: readonly string[];
}>;

export function prepareResourceTarget(
  pack: ResourcePack,
  parsed: ReturnType<typeof parseResourceLocator>,
  rawLocator: RawResourceLocator,
  authoringFile: string,
  options: ResourceLocatorOptions,
): PreparedResourceTarget {
  if (parsed.kind === "package") {
    canonicalAuthoringDirectory(pack, authoringFile, rawLocator);
    const resolvedPackage = resolvePackageResourcePack(
      pack,
      parsed,
      authoringFile,
      {
        cache: options.packageCache,
        beforeRead: options.beforeRead,
        resourceContext: options.resourceContext,
      },
    );
    const selectedPack = resolvedPackage.pack;
    const packageTarget = packageSubpathCandidate(selectedPack, parsed.subpath);
    return {
      pack: selectedPack,
      candidate: packageTarget.candidate,
      lexicalDirectory: packageTarget.candidate,
      kind: packageTarget.kind,
      resolutionDependencies: resolvedPackage.dependencies,
    };
  }

  const containingDirectory = canonicalAuthoringDirectory(
    pack,
    authoringFile,
    rawLocator,
  );
  const candidate = resolve(containingDirectory.lexical, parsed.value);
  if (!isRootPath(pack, candidate))
    return failResource(
      "unsafe-path",
      "resource target escapes the resource root",
      { locator: rawLocator },
    );
  if (!isWithin(pack.root, containingDirectory.canonical))
    return failResource(
      "unsafe-path",
      "authoring file is outside the resource root",
      { locator: rawLocator },
    );
  return {
    pack,
    candidate,
    lexicalDirectory: candidate,
    kind: "resource",
    resolutionDependencies: [],
  };
}

/** Resolves a validated target without enumerating any sibling directories. */
export function resolveResourceLocator(
  pack: ResourcePack,
  rawLocator: RawResourceLocator,
  authoringFile: string,
  options: ResourceLocatorOptions = {},
): ResolvedResourceTarget {
  const parsed = parseResourceLocator(rawLocator);
  const prepared = prepareResourceTarget(
    pack,
    parsed,
    rawLocator,
    authoringFile,
    options,
  );

  let directory: string;
  try {
    directory = canonicalDirectory(
      prepared.pack,
      rawLocator,
      prepared.candidate,
      prepared.resolutionDependencies,
    );
  } catch (error) {
    if (
      parsed.kind === "package" &&
      error instanceof ResourceResolutionError &&
      error.failure.code === "missing-target"
    ) {
      throw new ResourceResolutionError(
        {
          ...error.failure,
          code: "missing-package-subpath",
          message: "package subpath is unavailable",
        },
        withPackTrust(prepared.pack, {
          dependencies: targetResolutionDependencies(
            prepared.pack,
            prepared.resolutionDependencies,
            error.dependencies,
          ),
          unresolvedParents: error.unresolvedParents,
        }),
      );
    }
    throw error;
  }
  const cacheKey = `${prepared.pack.root}\u0000${prepared.kind}\u0000${stableRelative(prepared.pack.root, directory)}`;
  return Object.freeze({
    pack: prepared.pack,
    locator: parsed.value,
    directory,
    lexicalDirectory: prepared.lexicalDirectory,
    kind: prepared.kind,
    resolutionDependencies: Object.freeze(
      normalizeResourcePaths(prepared.resolutionDependencies),
    ),
    cacheKey,
  });
}

export type ResourceFileName =
  | "template.jsonc"
  | "template.md"
  | "instance.jsonc"
  | "atlante.jsonc"
  | "atlante.json";

export type ResourceFile = Readonly<{
  /** Canonical file path used for safe reads. */
  readonly path: string;
  /** Authored lexical path retained for watch reconciliation. */
  readonly lexicalPath: string;
  /** Lexical symlink entries and their relevant parents. */
  readonly watchPaths: readonly string[];
  readonly name: ResourceFileName;
}>;

/** Candidate lexical watch paths for one facet filename under a target. */
export function resourceCandidateWatchPaths(
  target: ResolvedResourceTarget,
  name: ResourceFileName,
): readonly string[] {
  return candidateWatchPaths(target.pack, join(target.lexicalDirectory, name));
}
