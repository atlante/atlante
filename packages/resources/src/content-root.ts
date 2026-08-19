import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { failResource, normalizeResourcePaths } from "./errors.js";
import type { ResourcePackageIdentity, ResourceWatchRoot } from "./types.js";

export type ResourcePackKind = "project" | "package";

/** A captured root is immutable for the lifetime of the resource pack. */
export type ResourcePack = Readonly<{
  readonly kind: ResourcePackKind;
  /** Canonical absolute realpath used internally for containment checks. */
  readonly root: string;
  /** Absolute path spelling used for lexical watch paths. */
  readonly lexicalRoot: string;
  /** Package identity is present only for package resource roots. */
  readonly package?: ResourcePackageIdentity;
}>;

/** Trusted roots supplied by a host for first-party package resolution. */
export type ResourceResolutionContext = Readonly<{
  readonly firstPartyPack?: ResourcePack;
}>;

/** Returns authorization data without exposing package metadata as identity. */
export function resourcePackWatchRoot(pack: ResourcePack): ResourceWatchRoot {
  return Object.freeze({ canonical: pack.root, lexical: pack.lexicalRoot });
}

type CapturedSymlink = Readonly<{
  readonly path: string;
  readonly target: string;
}>;

const lexicalRootChains = new WeakMap<
  ResourcePack,
  readonly CapturedSymlink[]
>();

type SymlinkPrefixResult =
  | { readonly kind: "missing" }
  | { readonly kind: "plain" }
  | { readonly kind: "link"; readonly target: string };

function inspectSymlinkPrefix(
  path: string,
  links: CapturedSymlink[],
): SymlinkPrefixResult {
  let isSymlink: boolean;
  try {
    isSymlink = lstatSync(path).isSymbolicLink();
  } catch {
    return { kind: "missing" };
  }
  if (!isSymlink) return { kind: "plain" };

  let targetText: string;
  let canonicalParent: string;
  try {
    targetText = readlinkSync(path);
    canonicalParent = realpathSync(dirname(path));
  } catch {
    return { kind: "missing" };
  }

  const link = { path, target: targetText };
  if (!links.some((entry) => entry.path === path)) links.push(link);
  const target = isAbsolute(targetText)
    ? resolve(targetText)
    : resolve(canonicalParent, targetText);
  return { kind: "link", target };
}

function collectSymlinkChain(
  path: string,
  links: CapturedSymlink[],
  active: Set<string>,
  completed: Set<string>,
): boolean {
  const normalized = resolve(path);
  if (completed.has(normalized)) return true;
  if (active.has(normalized)) return false;
  active.add(normalized);

  let complete = false;
  try {
    let prefix: string = sep;
    const parts = normalized.slice(sep.length).split(sep).filter(Boolean);
    for (const part of parts) {
      prefix = join(prefix, part);
      const inspection = inspectSymlinkPrefix(prefix, links);
      if (inspection.kind === "missing") return false;
      if (inspection.kind === "plain") continue;
      if (!collectSymlinkChain(inspection.target, links, active, completed))
        return false;
    }
    complete = true;
    return true;
  } finally {
    active.delete(normalized);
    if (complete) completed.add(normalized);
  }
}

function captureLexicalRootChain(
  lexicalRoot: string,
): readonly CapturedSymlink[] | undefined {
  const links: CapturedSymlink[] = [];
  if (!collectSymlinkChain(lexicalRoot, links, new Set(), new Set())) {
    return undefined;
  }
  return Object.freeze(links.map((link) => Object.freeze(link)));
}

function sameChain(
  captured: readonly CapturedSymlink[],
  current: readonly CapturedSymlink[],
): boolean {
  return (
    captured.length === current.length &&
    captured.every(
      (link, index) =>
        link.path === current[index]?.path &&
        link.target === current[index]?.target,
    )
  );
}

function isWithin(root: string, candidate: string): boolean {
  const pathToRoot = relative(root, candidate);
  return (
    pathToRoot === "" ||
    (pathToRoot !== ".." &&
      !pathToRoot.startsWith(`..${sep}`) &&
      !isAbsolute(pathToRoot))
  );
}

function missingPath(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { readonly code?: unknown }).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function capturedTarget(link: CapturedSymlink): string | undefined {
  try {
    const canonicalParent = realpathSync(dirname(link.path));
    return isAbsolute(link.target)
      ? resolve(link.target)
      : resolve(canonicalParent, link.target);
  } catch {
    return undefined;
  }
}

function isRootChainPath(
  lexicalRoot: string,
  root: string,
  candidate: string,
): boolean {
  const normalized = resolve(candidate);
  return (
    isWithin(lexicalRoot, normalized) ||
    isWithin(root, normalized) ||
    isWithin(normalized, lexicalRoot) ||
    isWithin(normalized, root)
  );
}

function isTerminalRootLink(root: string, target: string): boolean {
  try {
    return !lstatSync(target).isSymbolicLink() && realpathSync(target) === root;
  } catch {
    return false;
  }
}

function isPackageRootChainSafe(
  lexicalRoot: string,
  root: string,
  chain: readonly CapturedSymlink[],
): boolean {
  return chain.every((link) => {
    const target = capturedTarget(link);
    if (!target) return false;
    return (
      isRootChainPath(lexicalRoot, root, link.path) &&
      (isRootChainPath(lexicalRoot, root, target) ||
        (resolve(link.path) === resolve(lexicalRoot) &&
          isTerminalRootLink(root, target)))
    );
  });
}

function lexicalPathBase(pack: ResourcePack, path: string): string | undefined {
  const normalized = resolve(path);
  if (isWithin(pack.lexicalRoot, normalized)) return pack.lexicalRoot;
  if (isWithin(pack.root, normalized)) return pack.root;
  if (pack.kind === "package") {
    const target = packageRootLinkTarget(pack);
    if (target && isWithin(target, normalized)) return pack.root;
  }
  return undefined;
}

function packageRootLinkTarget(pack: ResourcePack): string | undefined {
  const rootLink = (lexicalRootChains.get(pack) ?? []).find(
    (link) => resolve(link.path) === pack.lexicalRoot,
  );
  return rootLink ? capturedTarget(rootLink) : undefined;
}

function canonicalPackagePath(
  pack: ResourcePack,
  path: string,
): string | undefined {
  if (pack.kind !== "package") return undefined;
  const normalized = resolve(path);
  const target = packageRootLinkTarget(pack);
  if (!target || !isWithin(target, normalized)) return undefined;
  return join(pack.root, relative(target, normalized));
}

function lexicalPrefixes(root: string, path: string): readonly string[] {
  const prefixes = [root];
  const parts = relative(root, path).split(sep).filter(Boolean);
  let prefix = root;
  for (const part of parts) {
    prefix = join(prefix, part);
    prefixes.push(prefix);
  }
  return prefixes;
}

type LexicalSymlinkInspection =
  | { readonly kind: "missing" }
  | { readonly kind: "plain" }
  | { readonly kind: "unsafe" }
  | { readonly kind: "link"; readonly target: string };

/** Allows only the selected root alias to transition to its captured root. */
function rootAliasTarget(
  pack: ResourcePack,
  prefix: string,
): string | undefined {
  if (resolve(prefix) !== pack.lexicalRoot) return undefined;
  try {
    return realpathSync(prefix) === pack.root ? pack.root : undefined;
  } catch {
    return undefined;
  }
}

function inspectLexicalSymlink(
  pack: ResourcePack,
  prefix: string,
): LexicalSymlinkInspection {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(prefix);
  } catch (error) {
    return missingPath(error) ? { kind: "missing" } : { kind: "unsafe" };
  }
  if (!stat.isSymbolicLink()) return { kind: "plain" };

  const rootTarget = rootAliasTarget(pack, prefix);
  if (rootTarget) return { kind: "link", target: rootTarget };

  let targetText: string;
  let canonicalParent: string;
  try {
    targetText = readlinkSync(prefix);
    canonicalParent = realpathSync(dirname(prefix));
  } catch {
    return { kind: "unsafe" };
  }
  if (!isWithin(pack.root, canonicalParent)) return { kind: "unsafe" };

  const target = isAbsolute(targetText)
    ? resolve(targetText)
    : resolve(canonicalParent, targetText);
  return { kind: "link", target };
}

function walkLexicalPrefixes(
  pack: ResourcePack,
  root: string,
  path: string,
  visit: (path: string) => boolean,
): boolean {
  for (const prefix of lexicalPrefixes(root, path)) {
    const inspection = inspectLexicalSymlink(pack, prefix);
    if (inspection.kind === "missing") return true;
    if (inspection.kind === "plain") continue;
    if (inspection.kind === "unsafe" || !visit(inspection.target)) return false;
  }
  return true;
}

/**
 * Verifies every lexical symlink hop without trusting a safe final realpath.
 * Captured chain links are stability/watch evidence, not generic walk bases.
 */
export function isResourcePackLexicalPathSafe(
  pack: ResourcePack,
  candidate: string,
): boolean {
  const active = new Set<string>();
  const completed = new Set<string>();

  function walk(path: string): boolean {
    const normalized = resolve(path);
    const base = lexicalPathBase(pack, normalized);
    const canonical = canonicalPackagePath(pack, normalized) ?? normalized;
    if (!base && canonical === normalized) return false;
    const walkBase = base ?? pack.root;

    const key = `${walkBase}\u0000${canonical}`;
    if (active.has(key)) return false;
    if (completed.has(key)) return true;
    active.add(key);

    let safe = true;
    try {
      safe = walkLexicalPrefixes(pack, walkBase, canonical, walk);
    } finally {
      active.delete(key);
    }

    if (safe) completed.add(key);
    return safe;
  }

  return walk(candidate);
}

/** Revalidates the lexical root and every captured symlink hop. */
export function isResourcePackLexicalRootStable(pack: ResourcePack): boolean {
  const captured = lexicalRootChains.get(pack);
  if (!captured) return false;

  let canonical: string;
  try {
    canonical = realpathSync(pack.lexicalRoot);
  } catch {
    return false;
  }
  if (canonical !== pack.root) return false;

  const current = captureLexicalRootChain(pack.lexicalRoot);
  return current !== undefined && sameChain(captured, current);
}

/** Returns only the symlink entries captured while the pack was created. */
export function resourcePackLexicalRootSymlinkPaths(
  pack: ResourcePack,
): readonly string[] {
  return Object.freeze(
    (lexicalRootChains.get(pack) ?? [])
      .filter((link) => {
        const path = resolve(link.path);
        const pathToRoot = relative(path, pack.lexicalRoot);
        const isAncestor =
          pathToRoot === "" ||
          (pathToRoot !== ".." && !pathToRoot.startsWith(`..${sep}`));
        return path === pack.lexicalRoot || !isAncestor;
      })
      .map((link) => link.path),
  );
}

/** Checks a canonical candidate against a captured pack root. */
export function isResourcePackPathContained(
  pack: ResourcePack,
  candidate: string,
): boolean {
  return isWithin(pack.root, resolve(candidate));
}

function lexicalAliasForLink(
  pack: ResourcePack,
  link: CapturedSymlink,
): string | undefined {
  const linkPath = resolve(link.path);
  if (!isWithin(linkPath, pack.lexicalRoot)) return undefined;

  const captured = capturedTarget(link);
  if (!captured) return undefined;
  try {
    if (!isWithin(realpathSync(captured), pack.root)) return undefined;
  } catch {
    return undefined;
  }

  const lexicalTarget = isAbsolute(link.target)
    ? resolve(link.target)
    : resolve(dirname(link.path), link.target);
  const alias = resolve(lexicalTarget, relative(linkPath, pack.lexicalRoot));
  try {
    return realpathSync(alias) === pack.root ? alias : undefined;
  } catch {
    return undefined;
  }
}

function lexicalRootAlias(pack: ResourcePack): string | undefined {
  const links = lexicalRootChains.get(pack) ?? [];
  for (let index = links.length - 1; index >= 0; index -= 1) {
    const link = links[index];
    const alias = link ? lexicalAliasForLink(pack, link) : undefined;
    if (alias) return alias;
  }

  try {
    if (realpathSync(pack.lexicalRoot) === pack.root) return pack.lexicalRoot;
  } catch {
    // The caller will fail closed when the captured root is no longer stable.
  }
  return undefined;
}

/** Maps a canonical package path to the captured lexical root route. */
export function resourcePackLexicalPathForCanonical(
  pack: ResourcePack,
  candidate: string,
): string | undefined {
  if (pack.kind !== "package" || !isResourcePackLexicalRootStable(pack))
    return undefined;

  const alias = lexicalRootAlias(pack);
  if (!alias) return undefined;

  const normalized = resolve(candidate);
  if (isWithin(pack.root, normalized))
    return resolve(alias, relative(pack.root, normalized));
  if (!isWithin(normalized, pack.root)) return undefined;

  let result = alias;
  for (const _ of relative(normalized, pack.root).split(sep).filter(Boolean))
    result = dirname(result);
  return result;
}

/** Returns package metadata and captured lexical-root paths for watch inputs. */
export function resourcePackMetadataPaths(
  pack: ResourcePack,
): readonly string[] {
  if (!pack.package) return [];
  return normalizeResourcePaths([
    pack.package.manifestPath,
    pack.package.lexicalManifestPath,
    ...resourcePackLexicalRootSymlinkPaths(pack),
  ]);
}

/** Captures a realpath root before any resource child is resolved. */
export function createResourcePack(
  rootDirectory: string,
  kind: ResourcePackKind,
  packageIdentity?: ResourcePackageIdentity,
): ResourcePack {
  if (!isAbsolute(rootDirectory)) {
    failResource(
      "invalid-locator",
      "resource pack root must be an absolute path",
    );
  }

  const lexicalRoot = resolve(rootDirectory);
  let root: string;
  try {
    root = realpathSync(rootDirectory);
  } catch {
    failResource("missing-target", "resource pack root is unavailable");
  }

  let rootIsDirectory: boolean;
  try {
    rootIsDirectory = lstatSync(root).isDirectory();
  } catch {
    failResource("missing-target", "resource pack root is unavailable");
  }
  if (!rootIsDirectory) {
    failResource("wrong-target-type", "resource pack root is not a directory");
  }

  const lexicalRootChain = captureLexicalRootChain(lexicalRoot);
  if (!lexicalRootChain) {
    failResource(
      "unsafe-path",
      "resource pack root symlink chain is unavailable",
    );
  }
  if (
    kind === "package" &&
    !isPackageRootChainSafe(lexicalRoot, root, lexicalRootChain)
  ) {
    failResource(
      "unsafe-path",
      "package root symlink chain leaves its authorized roots",
    );
  }

  const pack = Object.freeze({
    kind,
    root,
    lexicalRoot,
    ...(packageIdentity
      ? {
          package: Object.freeze({
            ...packageIdentity,
            dependencies: Object.freeze({ ...packageIdentity.dependencies }),
            optionalDependencies: Object.freeze({
              ...packageIdentity.optionalDependencies,
            }),
            devDependencies: Object.freeze({
              ...packageIdentity.devDependencies,
            }),
          }),
        }
      : {}),
  });
  lexicalRootChains.set(pack, lexicalRootChain);
  return pack;
}

export function createProjectResourcePack(rootDirectory: string): ResourcePack {
  return createResourcePack(rootDirectory, "project");
}
