import { createHash } from "node:crypto";

export type ArtifactNamespace = "agents" | "skills";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const FILENAME_PATTERN =
  /^(?:[a-z0-9]+(?:-[a-z0-9]+)*|artifact)-[0-9a-f]{64}-[0-9a-f]{64}\.md$/;
const encoder = new TextEncoder();

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifactIdDigest(id: string): string {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("artifact IDs must be non-empty strings");
  }
  return sha256(encoder.encode(id));
}

function asciiSlug(id: string): string {
  const folded = id.replace(/[A-Z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 32),
  );
  const trimmed = folded
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return trimmed || "artifact";
}

export function artifactPath(
  namespace: ArtifactNamespace,
  id: string,
  contentDigest: string,
): string {
  if (!HASH_PATTERN.test(contentDigest)) {
    throw new TypeError(
      "artifact content digest must be lowercase SHA-256 hex",
    );
  }
  return `${namespace}/${asciiSlug(id)}-${artifactIdDigest(id)}-${contentDigest}.md`;
}

export function isArtifactPayloadPath(path: string): boolean {
  const parts = path.split("/");
  const filename = parts[1] ?? "";
  return (
    parts.length === 2 &&
    (parts[0] === "agents" || parts[0] === "skills") &&
    filename.length <= 181 &&
    FILENAME_PATTERN.test(filename)
  );
}
