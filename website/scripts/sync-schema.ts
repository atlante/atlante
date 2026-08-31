import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA_ID = "https://atlante.sh/schema/v0.1/schema.json";

type SyncSchemaOptions = {
  repoRoot?: string;
  websiteRoot?: string;
};

type SyncSchemaResult = {
  sourcePath: string;
  destinationPath: string;
};

export function syncSchema({
  repoRoot: configuredRepoRoot,
  websiteRoot: configuredWebsiteRoot,
}: SyncSchemaOptions = {}): SyncSchemaResult {
  const websiteRoot =
    configuredWebsiteRoot ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = configuredRepoRoot ?? join(websiteRoot, "..");
  const sourcePath = join(
    repoRoot,
    "packages",
    "schema",
    "schema",
    "v0.1",
    "schema.json",
  );
  const destinationPath = join(
    websiteRoot,
    "public",
    "schema",
    "v0.1",
    "schema.json",
  );

  let source: Buffer;
  try {
    source = readFileSync(sourcePath);
  } catch {
    throw new Error(`Authoritative schema is unavailable: ${sourcePath}`);
  }

  let schema: { $id?: unknown } | null;
  try {
    schema = JSON.parse(source.toString("utf8")) as { $id?: unknown };
  } catch {
    throw new Error(`Authoritative schema is not valid JSON: ${sourcePath}`);
  }

  if (schema?.$id !== SCHEMA_ID) {
    throw new Error(
      `Authoritative schema has unexpected $id; expected ${SCHEMA_ID}: ${sourcePath}`,
    );
  }

  mkdirSync(dirname(destinationPath), { recursive: true });
  copyFileSync(sourcePath, destinationPath);

  return { sourcePath, destinationPath };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  syncSchema();
}
