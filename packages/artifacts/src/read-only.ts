/** The adapter-facing, reader-only surface. It exposes no artifact creation, digest, or publication helpers. */
export type {
  VerifiedAgentArtifact,
  VerifiedArtifacts,
  VerifiedSkillArtifact,
} from "./artifacts.js";
export { ArtifactReadError, readArtifacts } from "./artifacts.js";
