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
  isResourcePackLexicalRootStable,
  type ResourcePack,
  resourcePackLexicalRootSymlinkPaths,
} from "./content-root.js";
import {
  failResource,
  normalizeResourcePaths,
  ResourceResolutionError,
} from "./errors.js";
import { parseResourceLocator } from "./locator.js";
import type { RawResourceLocator, ValidatedResourceLocator } from "./types.js";

export type ResourceTargetKind = "resource" | "preset";

export type ResolvedResourceTarget = Readonly<{
  readonly pack: ResourcePack;
  readonly locator: ValidatedResourceLocator;
  /** Canonical target directory, never the authored lexical path. */
  readonly directory: string;
  /** Authored lexical target directory used only for watch reconciliation. */
  readonly lexicalDirectory: string;
  readonly kind: ResourceTargetKind;
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
  let current = candidate;
  while (true) {
    try {
      const canonical = realpathSync(current);
      if (!isWithin(pack.root, canonical)) return { kind: "escaped" };
      if (lstatSync(canonical).isDirectory()) {
        return { kind: "parents", paths: [canonical] };
      }
    } catch {
      // Continue to the nearest existing parent.
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
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

  let current = resolve(candidate);
  let missing = false;
  const paths = new Map<string, string>();
  while (isWithin(root, current)) {
    try {
      const canonical = realpathSync(current);
      if (!isWithin(pack.root, canonical)) return { kind: "escaped" };
      if (missing && lstatSync(canonical).isDirectory()) {
        paths.set(current, canonical);
      }
    } catch {
      missing = true;
    }
    if (current === root) break;
    current = dirname(current);
  }
  return {
    kind: "parents",
    paths: [...paths].map(([lexical, canonical]) => ({ lexical, canonical })),
  };
}

function safeParentFor(pack: ResourcePack, candidate: string): string[] {
  const root = lexicalRootFor(pack, candidate);
  if (!root) return [];

  let current = dirname(resolve(candidate));
  while (isWithin(root, current)) {
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
    if (current === root) break;
    current = dirname(current);
  }
  return [pack.root];
}

type SymlinkPrefixInspection = Readonly<{
  readonly target?: string;
  readonly watchTarget?: string;
  readonly missing: boolean;
  readonly escaped: boolean;
}>;

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
  if (!isRootPath(pack, target)) {
    return { missing: false, escaped: true };
  }
  const lexicalTarget = resolve(parent, link);
  return {
    missing: false,
    escaped: false,
    target,
    ...(isRootPath(pack, lexicalTarget) ? { watchTarget: lexicalTarget } : {}),
  };
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
    const parts = relative(root, normalized).split(sep).filter(Boolean);
    let prefix = root;
    for (const part of parts) {
      prefix = join(prefix, part);
      const inspection = inspectSymlinkPrefix(
        pack,
        prefix,
        new Set(),
        new Set(),
      );
      if (inspection.escaped) {
        safe = false;
        break;
      }
      if (
        inspection.target &&
        !inspectCanonicalPath(
          pack,
          inspection.target,
          active,
          completed,
          unresolved,
        )
      ) {
        safe = false;
        break;
      }
      if (inspection.missing) break;
    }

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

  const parts = relative(root, normalized).split(sep).filter(Boolean);
  let prefix = root;
  for (const part of parts) {
    prefix = join(prefix, part);
    const inspection = inspectSymlinkPrefix(pack, prefix, inspected, paths);
    if (inspection.escaped) {
      // The canonical walk has already made the safety decision. An escaped
      // lexical alternative is not a dependency and must not reject a safe
      // canonical target.
      return;
    }
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
  const safe = inspectCanonicalPath(
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
};

function candidateContext(
  pack: ResourcePack,
  candidate: string,
): ResourceFailureContext {
  const traversal = symlinkTraversal(pack, candidate);
  return {
    dependencies: candidateWatchPaths(pack, candidate),
    unresolvedParents: normalizeResourcePaths([
      ...safeParentFor(pack, candidate),
      ...traversal.unresolvedParents,
    ]),
  };
}

function targetContext(
  target: ResolvedResourceTarget,
  candidate = target.lexicalDirectory,
): ResourceFailureContext {
  return {
    dependencies: normalizeResourcePaths([
      target.directory,
      ...candidateWatchPaths(target.pack, candidate),
    ]),
    unresolvedParents: [target.directory],
  };
}

type AuthoringDirectory = Readonly<{
  readonly canonical: string;
  readonly lexical: string;
}>;

function targetFailure(
  pack: ResourcePack,
  locator: RawResourceLocator,
  candidate: string,
): never {
  const parents = unresolvedParents(pack, candidate);
  const context = candidateContext(pack, candidate);
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
    {
      dependencies: context.dependencies,
      unresolvedParents: normalizeResourcePaths([
        ...parents.paths,
        ...context.unresolvedParents,
        ...traversal.unresolvedParents,
      ]),
    },
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
  const lexical = dirname(lexicalFile);

  let authoringPath: string;
  try {
    authoringPath = realpathSync(authoringFile);
  } catch {
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
        {
          locator,
        },
      );
    }
    return { canonical: canonicalDirectory, lexical };
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
      {
        locator,
      },
    );
  }

  {
    const directory = dirname(authoringPath);
    if (!isWithin(pack.root, directory)) {
      return failResource(
        "unsafe-path",
        "authoring file is outside the resource root",
        {
          locator,
        },
      );
    }
    return { canonical: directory, lexical };
  }
}

function canonicalDirectory(
  pack: ResourcePack,
  locator: RawResourceLocator,
  candidate: string,
): string {
  if (symlinkTraversal(pack, candidate).escaped) {
    return failResource(
      "unsafe-path",
      "resource target escapes the resource root",
      { locator },
      candidateContext(pack, candidate),
    );
  }

  let target: string;
  try {
    target = realpathSync(candidate);
  } catch {
    return targetFailure(pack, locator, candidate);
  }
  if (!isWithin(pack.root, target)) {
    return failResource(
      "unsafe-path",
      "resource target escapes the resource root",
      {
        locator,
      },
      candidateContext(pack, candidate),
    );
  }

  let targetIsDirectory: boolean;
  try {
    targetIsDirectory = lstatSync(target).isDirectory();
  } catch {
    return targetFailure(pack, locator, candidate);
  }
  if (!targetIsDirectory) {
    return failResource(
      "wrong-target-type",
      "resource target is not a directory",
      {
        locator,
      },
      candidateContext(pack, candidate),
    );
  }
  return target;
}

/** Resolves a validated target without enumerating any sibling directories. */
export function resolveResourceLocator(
  pack: ResourcePack,
  rawLocator: RawResourceLocator,
  authoringFile: string,
): ResolvedResourceTarget {
  const parsed = parseResourceLocator(rawLocator);
  let candidate: string;
  let lexicalDirectory: string;
  let kind: ResourceTargetKind = "resource";

  if (parsed.kind === "builtin") {
    if (pack.kind !== "bundled") {
      return failResource(
        "invalid-locator",
        "built-in locator requires the bundled resource root",
        { locator: rawLocator },
      );
    }
    if (parsed.name === "starter") {
      candidate = pack.root;
      kind = "preset";
    } else {
      candidate = join(pack.root, parsed.name);
    }
    lexicalDirectory = candidate;
  } else {
    const containingDirectory = canonicalAuthoringDirectory(
      pack,
      authoringFile,
      rawLocator,
    );
    candidate = resolve(containingDirectory.lexical, parsed.value);
    if (!isRootPath(pack, candidate)) {
      return failResource(
        "unsafe-path",
        "resource target escapes the resource root",
        { locator: rawLocator },
      );
    }
    if (!isWithin(pack.root, containingDirectory.canonical)) {
      return failResource(
        "unsafe-path",
        "authoring file is outside the resource root",
        { locator: rawLocator },
      );
    }
    lexicalDirectory = candidate;
  }

  const directory = canonicalDirectory(pack, rawLocator, candidate);
  const cacheKey = `${pack.root}\u0000${kind}\u0000${stableRelative(pack.root, directory)}`;
  return Object.freeze({
    pack,
    locator: parsed.value,
    directory,
    lexicalDirectory,
    kind,
    cacheKey,
  });
}

function fileContext(
  target: ResolvedResourceTarget,
  file: ResourceFile,
): ResourceFailureContext {
  return {
    dependencies: normalizeResourcePaths([file.path, ...file.watchPaths]),
    unresolvedParents: [target.directory],
  };
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
  const context = candidateContext(target.pack, candidate);
  return failResource(
    "missing-target",
    "resource facet file is unavailable",
    { locator },
    {
      dependencies: normalizeResourcePaths([
        target.directory,
        ...context.dependencies,
      ]),
      unresolvedParents: normalizeResourcePaths([
        target.directory,
        ...context.unresolvedParents,
      ]),
    },
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
      candidateContext(target.pack, candidate),
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
      candidateContext(target.pack, candidate),
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
      {
        dependencies: normalizeResourcePaths([
          target.directory,
          ...candidateWatchPaths(target.pack, candidate),
        ]),
        unresolvedParents: [target.directory],
      },
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
  beforeRead?: () => void,
): Uint8Array {
  let fd: number | undefined;
  try {
    beforeRead?.();
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
  beforeRead?: () => void,
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
