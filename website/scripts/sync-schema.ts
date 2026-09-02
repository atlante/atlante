import { copyFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
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

/**
 * Publishes every generated JSON Schema under
 * `packages/schema/schema/<version>/` to the website's public path so each
 * schema's `$id` URL resolves in production. Each source must carry the
 * `$id` its filename promises; a mismatch means the generator and the
 * deployment contract have drifted, which must fail the build instead of
 * serving a schema under the wrong identity.
 */
export function syncSchema({
  repoRoot: configuredRepoRoot,
  websiteRoot: configuredWebsiteRoot,
}: SyncSchemaOptions = {}): SyncSchemaResult[] {
  const websiteRoot =
    configuredWebsiteRoot ?? dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = configuredRepoRoot ?? join(websiteRoot, "..");
  const sourceDir = join(repoRoot, "packages", "schema", "schema", "v0.1");
  const destinationDir = join(websiteRoot, "public", "schema", "v0.1");

  let sources: string[];
  try {
    sources = readdirSync(sourceDir)
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    throw new Error(`Authoritative schema is unavailable: ${sourceDir}`);
  }
  if (sources.length === 0) {
    throw new Error(`Authoritative schema is unavailable: ${sourceDir}`);
  }

  return sources.map((name) => {
    const sourcePath = join(sourceDir, name);
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

    const expectedId = `https://atlante.sh/schema/v0.1/${name}`;
    if (schema?.$id !== expectedId) {
      throw new Error(
        `Authoritative schema has unexpected $id; expected ${expectedId}: ${sourcePath}`,
      );
    }

    const destinationPath = join(destinationDir, name);
    mkdirSync(dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);

    return { sourcePath, destinationPath };
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  syncSchema();
}
