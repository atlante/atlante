import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ArtifactInputs, createArtifacts } from "@atlante/artifacts";

/**
 * Writes a complete, verified artifact publication tree without the builder.
 * The adapter boundary consumes only @atlante/artifacts, so test fixtures
 * craft trees directly through the package's own creation API: payloads and
 * the manifest use the same layout and formatting as publishArtifacts, which
 * writes `JSON.stringify(manifest, null, 2) + "\n"`.
 */
export function writeArtifactTree(root: string, inputs: ArtifactInputs): void {
  const created = createArtifacts(inputs);
  const artifactRoot = join(root, ".atlante", "artifacts");
  // Publication always creates both namespace directories, even when a
  // namespace is empty, and the fail-closed reader requires them.
  mkdirSync(join(artifactRoot, "agents"), { recursive: true });
  mkdirSync(join(artifactRoot, "skills"), { recursive: true });
  for (const payload of created.payloads) {
    const file = join(artifactRoot, ...payload.path.split("/"));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, payload.bytes);
  }
  writeFileSync(
    join(artifactRoot, "manifest.json"),
    `${JSON.stringify(created.manifest, null, 2)}\n`,
  );
}
