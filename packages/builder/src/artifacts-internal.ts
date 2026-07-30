type ArtifactManifestEntry = {
  id: string;
  description: string;
  path: string;
  sha256: string;
};

type ArtifactManifest = {
  format: "atlante-artifacts";
  version: 1;
  agents: ArtifactManifestEntry[];
  skills: ArtifactManifestEntry[];
};

/** The source fields needed to create an on-disk artifact. */
type ArtifactAgentInput = {
  hostAgentId: string;
  description: string;
  prompt: string;
  /** Accepted as build provenance, but deliberately omitted from the manifest. */
  templateId?: string;
};

/** The source fields needed to create an on-disk skill artifact. */
type ArtifactSkillInput = {
  skillId: string;
  description: string;
  content: string;
  /** Accepted as build provenance, but deliberately omitted from the manifest. */
  templateId?: string;
};

type ArtifactInputs = {
  agents: readonly ArtifactAgentInput[];
  skills: readonly ArtifactSkillInput[];
};

type ArtifactPayload = {
  path: string;
  bytes: Uint8Array;
};

type CreatedArtifacts = {
  manifest: ArtifactManifest;
  payloads: ArtifactPayload[];
};

export type {
  ArtifactAgentInput,
  ArtifactInputs,
  ArtifactManifest,
  ArtifactManifestEntry,
  ArtifactPayload,
  ArtifactSkillInput,
  CreatedArtifacts,
};
