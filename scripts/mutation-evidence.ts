import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const RESOURCE_SOURCE_ROOT = "packages/resources/src";
export const RESOURCE_SOURCE_ALGORITHM = "sha256:path\0bytes\0:v1";

export type SourceFile = { path: string; bytes: Buffer };

export type MutationVerdictEntry = {
  source: string;
  mutantId: string;
  status: string;
};

export type MutationReport = {
  files: Record<string, { mutants: { id: string; status: string }[] }>;
};

export function canonicalMutationVerdict(
  report: MutationReport,
): MutationVerdictEntry[] {
  return Object.entries(report.files)
    .flatMap(([source, file]) =>
      file.mutants.map((mutant) => ({
        source,
        mutantId: mutant.id,
        status: mutant.status,
      })),
    )
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.mutantId.localeCompare(right.mutantId, undefined, {
          numeric: true,
        }) ||
        left.status.localeCompare(right.status),
    );
}

export function hashMutationVerdict(
  verdict: readonly MutationVerdictEntry[],
): string {
  return createHash("sha256").update(JSON.stringify(verdict)).digest("hex");
}

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

export async function sourceFiles(
  root: string,
  sourceRootIdentity: string,
): Promise<SourceFile[]> {
  const sourceRoot = resolve(root, sourceRootIdentity);
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

export async function resourceSourceFiles(root: string): Promise<SourceFile[]> {
  return sourceFiles(root, RESOURCE_SOURCE_ROOT);
}
