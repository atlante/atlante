/** The complete artifact contract: creation, publication, reading, and verification. */
export type { ArtifactNamespace } from "./artifact-names.js";
export { artifactPath, isArtifactPayloadPath } from "./artifact-names.js";
export type {
  ArtifactReadOptions,
  VerifiedAgentArtifact,
  VerifiedArtifacts,
  VerifiedSkillArtifact,
} from "./artifacts.js";
export {
  ArtifactReadError,
  createArtifacts,
  readArtifacts,
} from "./artifacts.js";
export type {
  ArtifactAgentInput,
  ArtifactInputs,
  ArtifactManifest,
  ArtifactManifestEntry,
  ArtifactPayload,
  ArtifactSkillInput,
  CreatedArtifacts,
} from "./artifacts-internal.js";
export type {
  ArtifactPublicationWarning,
  PublishDependencies,
  PublishedArtifacts,
  PublishOperation,
} from "./publish.js";
export { publishArtifacts } from "./publish.js";
