import { readFile, writeFile } from "node:fs/promises";

type Manifest = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  [key: string]: unknown;
};

function stagedManifest(manifest: Manifest, version: string): Manifest {
  const dependencies = manifest.dependencies;
  const packDependency = dependencies?.["@atlante/pack"];
  if (
    dependencies &&
    typeof packDependency === "string" &&
    packDependency.startsWith("workspace:")
  ) {
    dependencies["@atlante/pack"] = `^${version}`;
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
