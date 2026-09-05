import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ResourcePack } from "./content-root.js";

export function isWithin(root: string, candidate: string): boolean {
  const result = relative(root, candidate);
  return (
    result === "" ||
    (result !== ".." && !result.startsWith(`..${sep}`) && !isAbsolute(result))
  );
}

export function stableRelative(root: string, candidate: string): string {
  return relative(root, candidate).replaceAll("\\", "/");
}

export function lexicalRootFor(
  pack: ResourcePack,
  candidate: string,
): string | undefined {
  const normalized = resolve(candidate);
  if (isWithin(pack.lexicalRoot, normalized)) return pack.lexicalRoot;
  if (isWithin(pack.root, normalized)) return pack.root;
  return undefined;
}

export function isRootPath(pack: ResourcePack, candidate: string): boolean {
  return lexicalRootFor(pack, candidate) !== undefined;
}

export function pathPrefixes(
  root: string,
  normalized: string,
): readonly string[] {
  const parts = relative(root, normalized).split(sep).filter(Boolean);
  let prefix = root;
  return parts.map((part) => {
    prefix = join(prefix, part);
    return prefix;
  });
}

export function* parentPaths(
  candidate: string,
  root?: string,
): Generator<string> {
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
