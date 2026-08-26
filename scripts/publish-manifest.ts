import { readFile, writeFile } from "node:fs/promises";

type Manifest = {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  [key: string]: unknown;
};

function stagedManifest(manifest: Manifest, version: string): Manifest {
  const dependencies = manifest.dependencies;
  if (dependencies) {
    // Workspace packages other than the static pack are not published; a
    // runtime dependency on one can never resolve from the registry.
    for (const [name, range] of Object.entries(dependencies)) {
      if (
        name !== "@atlante/pack" &&
        typeof range === "string" &&
        range.startsWith("workspace:")
      ) {
        throw new Error(
          `${name} declares "${range}" in dependencies; move it to devDependencies or publish the package`,
        );
      }
    }

    const packDependency = dependencies["@atlante/pack"];
    if (
      typeof packDependency === "string" &&
      packDependency.startsWith("workspace:")
    ) {
      dependencies["@atlante/pack"] = `^${version}`;
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
