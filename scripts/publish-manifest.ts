import { readFile, writeFile } from "node:fs/promises";

type Manifest = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  [key: string]: unknown;
};

// Packages published to the registry by scripts/publish-packages.ts, in the
// same layer order. A workspace range on one of these cannot resolve from the
// registry as-is, so staging rewrites it to the released caret range; a
// workspace range on any other workspace package can never resolve and stays
// forbidden.
const PUBLISHED_PACKAGES: ReadonlySet<string> = new Set([
  "@atlante/pack",
  "@atlante/opencode",
]);

function stagedManifest(manifest: Manifest, version: string): Manifest {
  const dependencies = manifest.dependencies;
  if (dependencies) {
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) {
        continue;
      }
      if (!PUBLISHED_PACKAGES.has(name)) {
        throw new Error(
          `${name} declares "${range}" in dependencies; move it to devDependencies or publish the package`,
        );
      }
      dependencies[name] = `^${version}`;
    }
  }

  delete manifest.devDependencies;
  return manifest;
}

export async function withStagedPublishManifest<T>(
  manifestPath: string,
  version: string,
  publish: () => Promise<T>,
): Promise<T> {
  const original = await readFile(manifestPath, "utf8");
  try {
    const manifest = stagedManifest(JSON.parse(original) as Manifest, version);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return await publish();
  } finally {
    await writeFile(manifestPath, original);
  }
}
