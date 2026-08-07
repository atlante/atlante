import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { failResource } from "./errors.js";

export type ResourcePackKind = "project" | "bundled";

/** A captured root is immutable for the lifetime of the resource pack. */
export type ResourcePack = Readonly<{
  readonly kind: ResourcePackKind;
  /** Canonical absolute realpath used internally for containment checks. */
  readonly root: string;
  /** Absolute path spelling used for lexical watch paths. */
  readonly lexicalRoot: string;
}>;

type CapturedSymlink = Readonly<{
  readonly path: string;
  readonly target: string;
}>;

const lexicalRootChains = new WeakMap<
  ResourcePack,
  readonly CapturedSymlink[]
>();

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

  let prefix: string = sep;
  const parts = normalized.slice(sep.length).split(sep).filter(Boolean);
  for (const part of parts) {
    prefix = join(prefix, part);
    let isSymlink: boolean;
    try {
      isSymlink = lstatSync(prefix).isSymbolicLink();
    } catch {
      active.delete(normalized);
      return false;
    }
    if (!isSymlink) continue;

    let targetText: string;
    let canonicalParent: string;
    try {
      targetText = readlinkSync(prefix);
      canonicalParent = realpathSync(dirname(prefix));
    } catch {
      active.delete(normalized);
      return false;
    }

    const link = { path: prefix, target: targetText };
    if (!links.some((entry) => entry.path === prefix)) links.push(link);
    const target = isAbsolute(targetText)
      ? resolve(targetText)
      : resolve(canonicalParent, targetText);
    if (!collectSymlinkChain(target, links, active, completed)) {
      active.delete(normalized);
      return false;
    }
  }

  active.delete(normalized);
  completed.add(normalized);
  return true;
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

/** Captures a realpath root before any resource child is resolved. */
export function createResourcePack(
  rootDirectory: string,
  kind: ResourcePackKind,
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

  const pack = Object.freeze({ kind, root, lexicalRoot });
  lexicalRootChains.set(pack, lexicalRootChain);
  return pack;
}

export function createProjectResourcePack(rootDirectory: string): ResourcePack {
  return createResourcePack(rootDirectory, "project");
}
