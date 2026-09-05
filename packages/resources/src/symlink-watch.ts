import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import {
  isResourcePackLexicalPathSafe,
  isResourcePackLexicalRootStable,
  type ResourcePack,
  resourcePackLexicalRootSymlinkPaths,
} from "./content-root.js";
import { normalizeResourcePaths } from "./errors.js";
import {
  isRootPath,
  isWithin,
  lexicalRootFor,
  parentPaths,
  pathPrefixes,
} from "./resource-paths.js";

type ParentLookup =
  | { readonly kind: "parents"; readonly paths: readonly string[] }
  | { readonly kind: "escaped" };

export type PendingParent = Readonly<{
  readonly lexical: string;
  readonly canonical: string;
}>;

export type PendingParentLookup =
  | { readonly kind: "parents"; readonly paths: readonly PendingParent[] }
  | { readonly kind: "escaped" };

export function unresolvedParents(
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
export function pendingParents(
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

export function safeParentFor(pack: ResourcePack, candidate: string): string[] {
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

export type SymlinkPrefixInspection = Readonly<{
  readonly target?: string;
  readonly watchTarget?: string;
  readonly missing: boolean;
  readonly escaped: boolean;
}>;

export function canonicalSymlinkTarget(
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

export function inspectSymlinkTarget(
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

export function inspectSymlinkPrefix(
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

export function inspectCanonicalPrefixes(
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

export function inspectCanonicalPath(
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

export function collectLexicalWatchPrefixes(
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
export function collectLexicalWatchPath(
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

export type SymlinkTraversal = Readonly<{
  readonly paths: Set<string>;
  readonly unresolvedParents: Set<string>;
  readonly escaped: boolean;
}>;

export function symlinkTraversal(
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

export function symlinkWatchPaths(
  pack: ResourcePack,
  candidate: string,
): readonly string[] {
  return normalizeResourcePaths([...symlinkTraversal(pack, candidate).paths]);
}

export function candidateWatchPaths(
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
