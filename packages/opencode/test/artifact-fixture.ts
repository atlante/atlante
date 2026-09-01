import {
  type ArtifactInputs,
  createArtifacts,
  publishArtifacts,
} from "@atlante/artifacts";

/**
 * Writes a complete, verified artifact publication tree through the
 * package's own publication API, so fixtures stay byte-faithful to real
 * builds by construction rather than by convention. The builder itself
 * stays outside the adapter boundary: this imports @atlante/artifacts,
 * which the workspace rules allow opencode tests to consume.
 */
export function writeArtifactTree(root: string, inputs: ArtifactInputs): void {
  publishArtifacts(root, createArtifacts(inputs));
}
