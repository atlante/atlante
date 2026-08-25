import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const RESOURCE_SOURCE_ROOT = "packages/resources/src";
export const RESOURCE_SOURCE_ALGORITHM = "sha256:path\0bytes\0:v1";

export type SourceFile = { path: string; bytes: Buffer };

export function hashSourceFiles(files: readonly SourceFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    hash.update(file.path, "utf8");
    hash.update("\0", "utf8");
    hash.update(file.bytes);
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

export async function resourceSourceFiles(root: string): Promise<SourceFile[]> {
  const sourceRoot = resolve(root, RESOURCE_SOURCE_ROOT);
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) paths.push(path);
    }
  }

  await visit(sourceRoot);
  return Promise.all(
    paths.sort().map(async (path) => ({
      path: relative(root, path).split("\\").join("/"),
      bytes: await readFile(path),
    })),
  );
}
