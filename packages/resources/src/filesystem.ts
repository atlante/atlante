import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  isResourcePackLexicalPathSafe,
  isResourcePackLexicalRootStable,
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
import { parseResourceLocator } from "./locator.js";
import {
  type PackageResolutionCache,
  packageSubpathCandidate,
  resolvePackageResourcePack,
} from "./package-resolution.js";
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

function isWithin(root: string, candidate: string): boolean {
  const result = relative(root, candidate);
  return (
    result === "" ||
    (result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result))
  );
}

function stableRelative(root: string, candidate: string): string {
  return relative(root, candidate).replaceAll("\\", "/");
}

function lexicalRootFor(
  pack: ResourcePack,
  candidate: string,
): string | undefined {
  const normalized = resolve(candidate);
  if (isWithin(pack.lexicalRoot, normalized)) return pack.lexicalRoot;
  if (isWithin(pack.root, normalized)) return pack.root;
  return undefined;
}

function isRootPath(pack: ResourcePack, candidate: string): boolean {
  return lexicalRootFor(pack, candidate) !== undefined;
}

function pathPrefixes(root: string, normalized: string): readonly string[] {
  const parts = relative(root, normalized).split(sep).filter(Boolean);
  let prefix = root;
  return parts.map((part) => {
    prefix = join(prefix, part);
    return prefix;
  });
}

function* parentPaths(candidate: string, root?: string): Generator<string> {
  let current = resolve(candidate);
  const visited = new Set<string>();
  // Bound the walk by the resolved path depth so traversal mutants terminate.
  for (const _ of current.split(sep)) {
    if (root && !isWithin(root, current)) return;
    if (visited.has(current)) return;
    visited.add(current);
    yield current;
    if (root && current === root) return;
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

type ParentLookup =
  | { readonly kind: "parents"; readonly paths: readonly string[] }
  | { readonly kind: "escaped" };

type PendingParent = Readonly<{
  readonly lexical: string;
  readonly canonical: string;
}>;

type PendingParentLookup =
  | { readonly kind: "parents"; readonly paths: readonly PendingParent[] }
  | { readonly kind: "escaped" };

function unresolvedParents(
  pack: ResourcePack,
  candidate: string,
): ParentLookup {
  for (const current of parentPaths(candidate)) {
    try {
      const canonical = realpathSync(current);
      if (!isWithin(pack.root, canonical)) return { kind: "escaped" };
      if (lstatSync(canonical).isDirectory()) {
        return { kind: "parents", paths: [canonical] };
      }
    } catch {
      // Continue to the nearest existing parent.
    }
  }
  return { kind: "parents", paths: [] };
}

/** Finds all existing in-root directories above a pending lexical target. */
function pendingParents(
  pack: ResourcePack,
  candidate: string,
): PendingParentLookup {
  const root = lexicalRootFor(pack, candidate);
  if (!root) return { kind: "escaped" };

  let missing = false;
  const paths = new Map<string, string>();
  for (const current of parentPaths(candidate, root)) {
    try {
      const canonical = realpathSync(current);
      if (!isWithin(pack.root, canonical)) return { kind: "escaped" };
      if (missing && lstatSync(canonical).isDirectory()) {
        paths.set(current, canonical);
      }
    } catch {
      missing = true;
    }
  }
  return {
    kind: "parents",
    paths: [...paths].map(([lexical, canonical]) => ({ lexical, canonical })),
  };
}

function safeParentFor(pack: ResourcePack, candidate: string): string[] {
  const root = lexicalRootFor(pack, candidate);
  if (!root) return [];

  for (const current of parentPaths(dirname(candidate), root)) {
    try {
      const canonical = realpathSync(current);
      if (
        isWithin(pack.root, canonical) &&
        lstatSync(canonical).isDirectory()
      ) {
        return [canonical];
      }
    } catch {
      // Continue to the nearest existing lexical parent.
    }
  }
  return [pack.root];
}

type SymlinkPrefixInspection = Readonly<{
  readonly target?: string;
  readonly watchTarget?: string;
  readonly missing: boolean;
  readonly escaped: boolean;
}>;

function canonicalSymlinkTarget(
  pack: ResourcePack,
  target: string,
): string | undefined {
  try {
    if (lstatSync(target).isSymbolicLink() && !isRootPath(pack, target))
      return undefined;
  } catch {
    // The canonical target check handles missing in-root links.
  }
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

function inspectSymlinkTarget(
  pack: ResourcePack,
  prefix: string,
): SymlinkPrefixInspection {
  const parent = dirname(prefix);
  let canonicalParent: string;
  let link: string;
  try {
    canonicalParent = realpathSync(parent);
    link = readlinkSync(prefix);
  } catch {
    // An unprovable parent or link target is unsafe, even if a concurrent
    // filesystem change makes the final realpath look usable.
    return { missing: false, escaped: true };
  }
  if (!isWithin(pack.root, canonicalParent)) {
    return { missing: false, escaped: true };
  }

  const target = isAbsolute(link)
    ? resolve(link)
    : resolve(canonicalParent, link);
  const canonicalTarget = canonicalSymlinkTarget(pack, target);
  if (!canonicalTarget || !isRootPath(pack, canonicalTarget)) {
    return { missing: false, escaped: true };
  }
  const lexicalTarget = resolve(parent, link);
  return {
    missing: false,
    escaped: false,
    target: isRootPath(pack, target) ? target : canonicalTarget,
    ...(isRootPath(pack, lexicalTarget) ? { watchTarget: lexicalTarget } : {}),
  };
}

function inspectSymlinkPrefix(
  pack: ResourcePack,
  prefix: string,
  inspected: Set<string>,
  paths: Set<string>,
): SymlinkPrefixInspection {
  if (inspected.has(prefix)) {
    return { missing: false, escaped: false };
  }
  inspected.add(prefix);

  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(prefix);
  } catch {
    return { missing: true, escaped: false };
  }
  if (!stat.isSymbolicLink()) return { missing: false, escaped: false };

  paths.add(prefix);
  const parent = dirname(prefix);
  if (isRootPath(pack, parent)) paths.add(parent);
  return inspectSymlinkTarget(pack, prefix);
}

function inspectCanonicalPrefixes(
  pack: ResourcePack,
  root: string,
  normalized: string,
  active: Set<string>,
  completed: Set<string>,
  unresolved: Set<string>,
): boolean {
  for (const prefix of pathPrefixes(root, normalized)) {
    const inspection = inspectSymlinkPrefix(pack, prefix, new Set(), new Set());
    if (inspection.escaped) return false;
    if (inspection.target) {
      const targetIsSafe = inspectCanonicalPath(
        pack,
        inspection.target,
        active,
        completed,
        unresolved,
      );
      if (!targetIsSafe) return false;
    }
    if (inspection.missing) break;
  }
  return true;
}

function inspectCanonicalPath(
  pack: ResourcePack,
  current: string,
  active: Set<string>,
  completed: Set<string>,
  unresolved: Set<string>,
): boolean {
  const root = lexicalRootFor(pack, current);
  if (!root) return false;

  const normalized = resolve(current);
  if (active.has(normalized)) return false;
  if (completed.has(normalized)) return true;
  active.add(normalized);

  let safe = true;
  try {
    safe = inspectCanonicalPrefixes(
      pack,
      root,
      normalized,
      active,
      completed,
      unresolved,
    );

    if (safe) {
      const parents = pendingParents(pack, normalized);
      if (parents.kind === "escaped") {
        safe = false;
      } else {
        for (const parent of parents.paths) unresolved.add(parent.canonical);
      }
    }
  } finally {
    active.delete(normalized);
  }

  if (safe) completed.add(normalized);
  return safe;
}

function collectLexicalWatchPrefixes(
  pack: ResourcePack,
  root: string,
  normalized: string,
  paths: Set<string>,
  unresolved: Set<string>,
  visited: Set<string>,
  inspected: Set<string>,
): boolean {
  for (const prefix of pathPrefixes(root, normalized)) {
    const inspection = inspectSymlinkPrefix(pack, prefix, inspected, paths);
    if (inspection.escaped) return false;
    if (inspection.watchTarget) {
      collectLexicalWatchPath(
        pack,
        inspection.watchTarget,
        paths,
        unresolved,
        visited,
        inspected,
        true,
      );
    }
    if (inspection.missing) break;
  }
  return true;
}

/** Collects authored watch spellings without making them a safety decision. */
function collectLexicalWatchPath(
  pack: ResourcePack,
  current: string,
  paths: Set<string>,
  unresolved: Set<string>,
  visited: Set<string>,
  inspected: Set<string>,
  collectParents: boolean,
): void {
  const root = lexicalRootFor(pack, current);
  if (!root) return;

  const normalized = resolve(current);
  if (visited.has(normalized)) return;
  visited.add(normalized);

  if (
    !collectLexicalWatchPrefixes(
      pack,
      root,
      normalized,
      paths,
      unresolved,
      visited,
      inspected,
    )
  ) {
    // The canonical walk has already made the safety decision. An escaped
    // lexical alternative is not a dependency and must not reject a safe
    // canonical target.
    return;
  }

  if (collectParents) {
    const parents = pendingParents(pack, normalized);
    if (parents.kind === "escaped") return;
    for (const parent of parents.paths) {
      paths.add(parent.lexical);
      unresolved.add(parent.canonical);
    }
  }
}

type SymlinkTraversal = Readonly<{
  readonly paths: Set<string>;
  readonly unresolvedParents: Set<string>;
  readonly escaped: boolean;
}>;

function symlinkTraversal(
  pack: ResourcePack,
  candidate: string,
): SymlinkTraversal {
  if (!isResourcePackLexicalRootStable(pack)) {
    const paths = new Set(resourcePackLexicalRootSymlinkPaths(pack));
    if (paths.size > 0) paths.add(pack.root);
    return { paths, unresolvedParents: new Set(), escaped: true };
  }
  if (!lexicalRootFor(pack, candidate)) {
    return { paths: new Set(), unresolvedParents: new Set(), escaped: false };
  }

  const paths = new Set(resourcePackLexicalRootSymlinkPaths(pack));
  if (paths.size > 0) paths.add(pack.root);
  const unresolved = new Set<string>();
  const safe =
    isResourcePackLexicalPathSafe(pack, resolve(candidate)) &&
    inspectCanonicalPath(
      pack,
      resolve(candidate),
      new Set(),
      new Set(),
      unresolved,
    );
  collectLexicalWatchPath(
    pack,
    resolve(candidate),
    paths,
    unresolved,
    new Set(),
    new Set(),
    false,
  );
  return { paths, unresolvedParents: unresolved, escaped: !safe };
}

function symlinkWatchPaths(
  pack: ResourcePack,
  candidate: string,
): readonly string[] {
  return normalizeResourcePaths([...symlinkTraversal(pack, candidate).paths]);
}

function candidateWatchPaths(
  pack: ResourcePack,
  candidate: string,
): readonly string[] {
  const traversal = symlinkTraversal(pack, candidate);
  const paths = new Set(traversal.paths);
  if (!traversal.escaped && isRootPath(pack, candidate)) {
    paths.add(resolve(candidate));
  }
  return normalizeResourcePaths([...paths]);
}

export function resourceCandidateWatchPaths(
  target: ResolvedResourceTarget,
  name: ResourceFileName,
): readonly string[] {
  return candidateWatchPaths(target.pack, join(target.lexicalDirectory, name));
}

type ResourceFailureContext = {
  readonly dependencies: readonly string[];
  readonly unresolvedParents: readonly string[];
  readonly trustedRoots?: readonly ResourceWatchRoot[];
};

function withPackTrust(
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

function targetResolutionDependencies(
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

function candidateContext(
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

function targetContext(
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

type AuthoringDirectory = Readonly<{
  readonly canonical: string;
  readonly lexical: string;
}>;

function canonicalMissingAuthoringDirectory(
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

function canonicalAuthoringFile(
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

function targetFailure(
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

function canonicalAuthoringDirectory(
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

function canonicalDirectory(
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

type PreparedResourceTarget = Readonly<{
  readonly pack: ResourcePack;
  readonly candidate: string;
  readonly lexicalDirectory: string;
  readonly kind: ResourceTargetKind;
  readonly resolutionDependencies: readonly string[];
}>;

function prepareResourceTarget(
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

function fileContext(
  target: ResolvedResourceTarget,
  file: ResourceFile,
): ResourceFailureContext {
  return withPackTrust(target.pack, {
    dependencies: targetResolutionDependencies(
      target.pack,
      target.resolutionDependencies,
      [file.path, ...file.watchPaths],
    ),
    unresolvedParents: [target.directory],
  });
}

function unsafeRead(
  locator: RawResourceLocator,
  target?: ResolvedResourceTarget,
  file?: ResourceFile,
): never {
  const context =
    file && target
      ? fileContext(target, file)
      : target
        ? targetContext(target)
        : undefined;
  return failResource(
    "unsafe-path",
    "resource file changed outside the resource root",
    { locator },
    context,
  );
}

function missingFile(
  target: ResolvedResourceTarget,
  locator: RawResourceLocator,
  name: ResourceFileName,
): never {
  const candidate = join(target.lexicalDirectory, name);
  const context = candidateContext(
    target.pack,
    candidate,
    target.resolutionDependencies,
  );
  return failResource(
    "missing-target",
    "resource facet file is unavailable",
    { locator },
    withPackTrust(target.pack, {
      dependencies: targetResolutionDependencies(
        target.pack,
        target.resolutionDependencies,
        [target.directory, ...context.dependencies],
      ),
      unresolvedParents: normalizeResourcePaths([
        target.directory,
        ...context.unresolvedParents,
      ]),
    }),
  );
}

/** Checks one exact facet filename with lstat before any read or open. */
export function inspectResourceFile(
  target: ResolvedResourceTarget,
  name: ResourceFileName,
  locator: RawResourceLocator = target.locator,
): ResourceFile | undefined {
  assertStableTarget(target, locator);
  const candidate = join(target.lexicalDirectory, name);
  if (symlinkTraversal(target.pack, candidate).escaped) {
    return failResource(
      "unsafe-path",
      "resource file changed outside the resource root",
      { locator },
      candidateContext(target.pack, candidate, target.resolutionDependencies),
    );
  }
  let candidateStat: ReturnType<typeof lstatSync>;
  try {
    candidateStat = lstatSync(candidate);
  } catch {
    return undefined;
  }

  let canonical: string;
  try {
    canonical = realpathSync(candidate);
  } catch {
    return missingFile(target, locator, name);
  }
  if (!isWithin(target.pack.root, canonical)) {
    return failResource(
      "unsafe-path",
      "resource file changed outside the resource root",
      { locator },
      candidateContext(target.pack, candidate, target.resolutionDependencies),
    );
  }

  let targetStat: ReturnType<typeof lstatSync>;
  try {
    targetStat = lstatSync(canonical);
  } catch {
    return missingFile(target, locator, name);
  }
  if (!targetStat.isFile() || candidateStat.isFIFO()) {
    return failResource(
      "wrong-target-type",
      "resource facet is not a regular file",
      {
        locator,
      },
      withPackTrust(target.pack, {
        dependencies: targetResolutionDependencies(
          target.pack,
          target.resolutionDependencies,
          [target.directory, ...candidateWatchPaths(target.pack, candidate)],
        ),
        unresolvedParents: [target.directory],
      }),
    );
  }
  return Object.freeze({
    path: canonical,
    lexicalPath: candidate,
    watchPaths: Object.freeze([...symlinkWatchPaths(target.pack, candidate)]),
    name,
  });
}

function assertStableTarget(
  target: ResolvedResourceTarget,
  locator: RawResourceLocator,
): void {
  if (symlinkTraversal(target.pack, target.lexicalDirectory).escaped) {
    unsafeRead(locator, target);
  }
  let canonical: string;
  try {
    canonical = realpathSync(target.lexicalDirectory);
  } catch {
    unsafeRead(locator, target);
  }
  if (
    canonical !== target.directory ||
    !isWithin(target.pack.root, canonical)
  ) {
    unsafeRead(locator, target);
  }
  try {
    if (!lstatSync(target.directory).isDirectory()) unsafeRead(locator, target);
  } catch {
    unsafeRead(locator, target);
  }
}

function assertStableFile(
  target: ResolvedResourceTarget,
  file: ResourceFile,
  locator: RawResourceLocator,
): void {
  if (symlinkTraversal(target.pack, file.lexicalPath).escaped) {
    unsafeRead(locator, target, file);
  }
  let canonical: string;
  try {
    canonical = realpathSync(file.lexicalPath);
  } catch {
    unsafeRead(locator, target, file);
  }
  if (canonical !== file.path || !isWithin(target.pack.root, canonical)) {
    unsafeRead(locator, target, file);
  }
  let isRegularFile: boolean;
  try {
    isRegularFile = lstatSync(file.path).isFile();
  } catch {
    unsafeRead(locator, target, file);
  }
  if (!isRegularFile) {
    failResource(
      "wrong-target-type",
      "resource facet is not a regular file",
      { locator },
      fileContext(target, file),
    );
  }
}

function readFlags(): number {
  const fsConstants = constants as typeof constants & {
    readonly O_NOFOLLOW?: number;
    readonly O_NONBLOCK?: number;
  };
  return (
    fsConstants.O_RDONLY |
    (fsConstants.O_NOFOLLOW ?? 0) |
    (fsConstants.O_NONBLOCK ?? 0)
  );
}

function openAndReadResourceFile(
  target: ResolvedResourceTarget,
  file: ResourceFile,
  locator: RawResourceLocator,
  beforeRead?: (path: string) => void,
): Uint8Array {
  let fd: number | undefined;
  try {
    beforeRead?.(file.path);
    fd = openSync(file.path, readFlags());
    if (!fstatSync(fd).isFile()) {
      return failResource(
        "wrong-target-type",
        "resource facet is not a regular file",
        {
          locator,
        },
        fileContext(target, file),
      );
    }
    return readFileSync(fd);
  } catch {
    assertStableTarget(target, locator);
    let observed: string | undefined;
    try {
      observed = realpathSync(file.path);
    } catch {
      // The path disappeared during the read attempt.
    }
    if (observed && !isWithin(target.pack.root, observed)) {
      return unsafeRead(locator, target, file);
    }
    return failResource(
      "wrong-target-type",
      "resource facet could not be read",
      {
        locator,
      },
      fileContext(target, file),
    );
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // The read result is already determined.
      }
    }
  }
}

function assertStableRead(
  target: ResolvedResourceTarget,
  file: ResourceFile,
  locator: RawResourceLocator,
): void {
  if (symlinkTraversal(target.pack, file.lexicalPath).escaped) {
    unsafeRead(locator, target, file);
  }
  let afterFile: string;
  try {
    afterFile = realpathSync(file.lexicalPath);
  } catch {
    unsafeRead(locator, target, file);
  }
  if (afterFile !== file.path || !isWithin(target.pack.root, afterFile)) {
    unsafeRead(locator, target, file);
  }
  assertStableTarget(target, locator);
}

/**
 * Reads the canonical file, not the authored symlink path. The final
 * realpath/lstat checks reject changes observed after the read. Node/Bun do
 * not expose a portable openat-style descriptor walk, so a concurrent swap
 * after the last check is not a privilege boundary; this layer makes no
 * stronger claim than those race checks support.
 */
export function readResourceFile(
  target: ResolvedResourceTarget,
  file: ResourceFile,
  locator: RawResourceLocator = target.locator,
  beforeRead?: (path: string) => void,
): string {
  assertStableTarget(target, locator);
  assertStableFile(target, file, locator);
  const bytes = openAndReadResourceFile(target, file, locator, beforeRead);
  assertStableRead(target, file, locator);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failResource(
      "invalid-resolved-input",
      "resource facet is not valid UTF-8",
      {
        locator,
      },
      fileContext(target, file),
    );
  }
}

export function isResourceResolutionError(
  error: unknown,
): error is ResourceResolutionError {
  return error instanceof ResourceResolutionError;
}
