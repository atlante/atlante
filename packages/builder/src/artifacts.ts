import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  type Stats,
} from "node:fs";
import { join, resolve } from "node:path";
import { TextDecoder, TextEncoder } from "node:util";
import { type ArtifactNamespace, artifactPath } from "./artifact-names.js";
import type {
  ArtifactInputs,
  ArtifactManifest,
  ArtifactManifestEntry,
  ArtifactPayload,
  CreatedArtifacts,
} from "./artifacts-internal.js";

const ARTIFACT_FORMAT = "atlante-artifacts" as const;
const ARTIFACT_VERSION = 1 as const;

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const manifestDecoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

export type VerifiedAgentArtifact = {
  hostAgentId: string;
  description: string;
  prompt: string;
};

export type VerifiedSkillArtifact = {
  skillId: string;
  description: string;
  content: string;
};

/** The intentionally small contract exposed to host adapters. */
export type VerifiedArtifacts = {
  agents: VerifiedAgentArtifact[];
  skills: VerifiedSkillArtifact[];
};

type ArtifactReadErrorCode =
  | "invalid-tree"
  | "invalid-manifest"
  | "unsafe-path"
  | "missing-payload"
  | "invalid-payload"
  | "digest-mismatch"
  | "filesystem";

export class ArtifactReadError extends Error {
  readonly code: ArtifactReadErrorCode;
  readonly artifactPath?: string;

  constructor(
    message: string,
    code: ArtifactReadErrorCode = "invalid-tree",
    artifactPath?: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "ArtifactReadError";
    this.code = code;
    this.artifactPath = artifactPath;
  }
}

function utf8(value: string): Uint8Array {
  return encoder.encode(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function validateSourceText(
  value: unknown,
  subject: string,
  allowEmpty: boolean,
): asserts value is string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new TypeError(
      `${subject} must be a ${allowEmpty ? "string" : "non-empty string"}`,
    );
  }
}

function sourceEntry(
  namespace: ArtifactNamespace,
  id: string,
  description: string,
  content: string,
): { entry: ArtifactManifestEntry; payload: ArtifactPayload } {
  const contentBytes = utf8(content);
  const contentDigest = sha256(contentBytes);
  const path = artifactPath(namespace, id, contentDigest);
  return {
    entry: { id, description, path, sha256: contentDigest },
    payload: { path, bytes: contentBytes },
  };
}

function assertInputs(value: ArtifactInputs): void {
  if (!value || typeof value !== "object") {
    throw new TypeError("artifact inputs must be an object");
  }
  if (!Array.isArray(value.agents) || !Array.isArray(value.skills)) {
    throw new TypeError(
      "artifact inputs must contain agents and skills arrays",
    );
  }
}

/**
 * Creates the complete deterministic v1 representation in memory. Payload
 * bytes are returned separately so publication can write them before its
 * manifest without having to reconstruct or re-encode rendered content.
 */
export function createArtifacts(input: ArtifactInputs): CreatedArtifacts {
  assertInputs(input);

  const agents: ArtifactManifestEntry[] = [];
  const skills: ArtifactManifestEntry[] = [];
  const payloads: ArtifactPayload[] = [];
  const agentIds = new Set<string>();
  const skillIds = new Set<string>();

  for (const agent of input.agents) {
    validateSourceText(agent?.hostAgentId, "agent ID", false);
    validateSourceText(agent?.description, "agent description", false);
    validateSourceText(agent?.prompt, "agent prompt", true);
    if (agentIds.has(agent.hostAgentId)) {
      throw new TypeError(`duplicate agent ID: ${agent.hostAgentId}`);
    }
    agentIds.add(agent.hostAgentId);
    const created = sourceEntry(
      "agents",
      agent.hostAgentId,
      agent.description,
      agent.prompt,
    );
    agents.push(created.entry);
    payloads.push(created.payload);
  }

  for (const skill of input.skills) {
    validateSourceText(skill?.skillId, "skill ID", false);
    validateSourceText(skill?.description, "skill description", false);
    validateSourceText(skill?.content, "skill content", true);
    if (skillIds.has(skill.skillId)) {
      throw new TypeError(`duplicate skill ID: ${skill.skillId}`);
    }
    skillIds.add(skill.skillId);
    const created = sourceEntry(
      "skills",
      skill.skillId,
      skill.description,
      skill.content,
    );
    skills.push(created.entry);
    payloads.push(created.payload);
  }

  return {
    manifest: {
      format: ARTIFACT_FORMAT,
      version: ARTIFACT_VERSION,
      agents,
      skills,
    },
    payloads,
  };
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidManifest(message: string): ArtifactReadError {
  return new ArtifactReadError(message, "invalid-manifest");
}

function parseManifest(text: string): ArtifactManifest {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ArtifactReadError(
      "manifest.json is not valid JSON",
      "invalid-manifest",
      "manifest.json",
      cause,
    );
  }

  if (!isRecord(value)) throw invalidManifest("manifest must be an object");
  if (!hasExactKeys(value, ["format", "version", "agents", "skills"])) {
    throw invalidManifest("manifest contains unknown fields");
  }
  if (value.format !== ARTIFACT_FORMAT || value.version !== ARTIFACT_VERSION) {
    throw invalidManifest("manifest format or version is unsupported");
  }
  if (!Array.isArray(value.agents) || !Array.isArray(value.skills)) {
    throw invalidManifest("manifest agents and skills must be arrays");
  }

  return {
    format: ARTIFACT_FORMAT,
    version: ARTIFACT_VERSION,
    agents: parseEntries(value.agents, "agents"),
    skills: parseEntries(value.skills, "skills"),
  };
}

function manifestEntryValue(
  value: unknown,
  namespace: ArtifactNamespace,
  index: number,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw invalidManifest(`${namespace}[${index}] must be an object`);
  }
  if (!hasExactKeys(value, ["id", "description", "path", "sha256"])) {
    throw invalidManifest(`${namespace}[${index}] contains unknown fields`);
  }
  return value;
}

type ManifestEntryFields = {
  id: string;
  description: string;
  path: string;
  sha256: string;
};

function validateManifestEntryFields(
  value: Record<string, unknown>,
  namespace: ArtifactNamespace,
  index: number,
): asserts value is ManifestEntryFields {
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw invalidManifest(`${namespace}[${index}].id must be non-empty`);
  }
  if (typeof value.description !== "string" || value.description.length === 0) {
    throw invalidManifest(
      `${namespace}[${index}].description must be non-empty`,
    );
  }
  if (typeof value.path !== "string") {
    throw invalidManifest(`${namespace}[${index}].path must be a string`);
  }
  if (typeof value.sha256 !== "string" || !HASH_PATTERN.test(value.sha256)) {
    throw invalidManifest(
      `${namespace}[${index}].sha256 must be lowercase SHA-256 hex`,
    );
  }
}

function validateManifestEntryPath(
  value: ManifestEntryFields,
  namespace: ArtifactNamespace,
  index: number,
  ids: Set<string>,
  paths: Set<string>,
): void {
  if (ids.has(value.id)) {
    throw invalidManifest(`duplicate ${namespace} ID: ${value.id}`);
  }
  if (paths.has(value.path)) {
    throw invalidManifest(`duplicate artifact path: ${value.path}`);
  }
  if (!isSafeRelativePath(value.path)) {
    throw new ArtifactReadError(
      `${namespace}[${index}].path is unsafe`,
      "unsafe-path",
      value.path,
    );
  }

  const expectedPath = artifactPath(namespace, value.id, value.sha256);
  if (value.path !== expectedPath) {
    throw new ArtifactReadError(
      `${namespace}[${index}].path does not match its ID, namespace, and digest`,
      "unsafe-path",
      value.path,
    );
  }
}

function parseEntry(
  value: unknown,
  namespace: ArtifactNamespace,
  index: number,
  ids: Set<string>,
  paths: Set<string>,
): ArtifactManifestEntry {
  const entry = manifestEntryValue(value, namespace, index);
  validateManifestEntryFields(entry, namespace, index);
  validateManifestEntryPath(entry, namespace, index, ids, paths);

  ids.add(entry.id);
  paths.add(entry.path);
  return {
    id: entry.id,
    description: entry.description,
    path: entry.path,
    sha256: entry.sha256,
  };
}

function parseEntries(
  values: unknown[],
  namespace: ArtifactNamespace,
): ArtifactManifestEntry[] {
  const ids = new Set<string>();
  const paths = new Set<string>();
  const entries: ArtifactManifestEntry[] = [];

  for (const [index, value] of values.entries()) {
    entries.push(parseEntry(value, namespace, index, ids, paths));
  }

  return entries;
}

function isSafeRelativePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return false;
  }
  const parts = path.split("/");
  return parts.every(
    (part) => part.length > 0 && part !== "." && part !== "..",
  );
}

function filesystemError(
  message: string,
  path: string,
  cause: unknown,
): ArtifactReadError {
  return new ArtifactReadError(message, "filesystem", path, cause);
}

function existingStat(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (cause) {
    if (
      typeof cause === "object" &&
      cause !== null &&
      "code" in cause &&
      cause.code === "ENOENT"
    ) {
      return undefined;
    }
    throw filesystemError(`cannot inspect artifact path: ${path}`, path, cause);
  }
}

function requireDirectory(
  path: string,
  symlinkMessage: string,
  directoryMessage: string,
): boolean {
  const stat = existingStat(path);
  if (!stat) return false;
  if (stat.isSymbolicLink()) {
    throw new ArtifactReadError(symlinkMessage, "unsafe-path", path);
  }
  if (!stat.isDirectory()) {
    throw new ArtifactReadError(directoryMessage, "invalid-tree", path);
  }
  return true;
}

function findArtifactRoot(projectRoot: string): string | undefined {
  const root = resolve(projectRoot);
  if (
    !requireDirectory(
      root,
      "project root must not be a symlink",
      "project root must be a directory",
    )
  )
    return undefined;

  const metadataRoot = join(root, ".atlante");
  if (
    !requireDirectory(
      metadataRoot,
      ".atlante must not be a symlink",
      ".atlante must be a directory",
    )
  )
    return undefined;

  const artifactRoot = join(metadataRoot, "artifacts");
  if (
    !requireDirectory(
      artifactRoot,
      "artifacts must not be a symlink",
      "artifacts must be a directory",
    )
  )
    return undefined;

  const agentsPath = join(artifactRoot, "agents");
  if (
    !requireDirectory(
      agentsPath,
      "agents must not be a symlink",
      "agents must be a directory",
    )
  ) {
    throw new ArtifactReadError(
      "agents directory is missing",
      "invalid-tree",
      agentsPath,
    );
  }

  const skillsPath = join(artifactRoot, "skills");
  if (
    !requireDirectory(
      skillsPath,
      "skills must not be a symlink",
      "skills must be a directory",
    )
  ) {
    throw new ArtifactReadError(
      "skills directory is missing",
      "invalid-tree",
      skillsPath,
    );
  }
  return artifactRoot;
}

function inspectArtifactRoot(root: string, artifactPath: string): void {
  const rootStat = existingStat(root);
  if (!rootStat) {
    throw new ArtifactReadError(
      `artifact payload is missing: ${artifactPath}`,
      "missing-payload",
      artifactPath,
    );
  }
  if (rootStat.isSymbolicLink()) {
    throw new ArtifactReadError(
      `artifact path must not be a symlink: ${artifactPath}`,
      "unsafe-path",
      artifactPath,
    );
  }
  if (!rootStat.isDirectory()) {
    throw new ArtifactReadError(
      `artifact path has a non-directory parent: ${artifactPath}`,
      "invalid-payload",
      artifactPath,
    );
  }
}

function inspectArtifactPart(
  path: string,
  artifactPath: string,
  isFinal: boolean,
): Stats {
  const stat = existingStat(path);
  if (!stat) {
    throw new ArtifactReadError(
      `artifact payload is missing: ${artifactPath}`,
      "missing-payload",
      artifactPath,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new ArtifactReadError(
      `artifact path must not be a symlink: ${artifactPath}`,
      "unsafe-path",
      artifactPath,
    );
  }
  if (!isFinal && !stat.isDirectory()) {
    throw new ArtifactReadError(
      `artifact path has a non-directory parent: ${artifactPath}`,
      "invalid-payload",
      artifactPath,
    );
  }
  if (isFinal && !stat.isFile()) {
    throw new ArtifactReadError(
      `artifact payload is not a regular file: ${artifactPath}`,
      "invalid-payload",
      artifactPath,
    );
  }
  return stat;
}

function inspectRegularPath(
  root: string,
  relativePath: string,
  artifactPath: string,
): { path: string; stat: Stats } {
  if (!isSafeRelativePath(relativePath)) {
    throw new ArtifactReadError(
      `artifact path is unsafe: ${artifactPath}`,
      "unsafe-path",
      artifactPath,
    );
  }

  const parts = relativePath.split("/");
  let current = root;
  inspectArtifactRoot(current, artifactPath);

  let finalStat: Stats | undefined;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    finalStat = inspectArtifactPart(
      current,
      artifactPath,
      index === parts.length - 1,
    );
  }

  if (!finalStat) {
    throw new ArtifactReadError(
      `artifact path is empty: ${artifactPath}`,
      "invalid-payload",
      artifactPath,
    );
  }
  return { path: current, stat: finalStat };
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function changedPath(artifactPath: string): ArtifactReadError {
  return new ArtifactReadError(
    `artifact path changed while it was being opened: ${artifactPath}`,
    "unsafe-path",
    artifactPath,
  );
}

function readRegularFile(
  root: string,
  relativePath: string,
  artifactPath = relativePath,
): Uint8Array {
  const before = inspectRegularPath(root, relativePath, artifactPath);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      before.path,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) {
      throw new ArtifactReadError(
        `artifact payload is not a regular file: ${artifactPath}`,
        "invalid-payload",
        artifactPath,
      );
    }
    if (!sameFile(before.stat, opened)) {
      throw changedPath(artifactPath);
    }

    const after = inspectRegularPath(root, relativePath, artifactPath);
    if (!sameFile(after.stat, opened)) {
      throw changedPath(artifactPath);
    }
    return readFileSync(descriptor);
  } catch (cause) {
    if (cause instanceof ArtifactReadError) throw cause;
    throw filesystemError(
      `cannot read artifact payload: ${artifactPath}`,
      artifactPath,
      cause,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function decodePayload(
  bytes: Uint8Array,
  path: string,
  decoderToUse = decoder,
): string {
  try {
    return decoderToUse.decode(bytes);
  } catch (cause) {
    throw new ArtifactReadError(
      `artifact payload is not valid UTF-8: ${path}`,
      "invalid-payload",
      path,
      cause,
    );
  }
}

function verifyPayload(
  projectRoot: string,
  entry: ArtifactManifestEntry,
): string {
  const bytes = readRegularFile(
    projectRoot,
    `.atlante/artifacts/${entry.path}`,
    entry.path,
  );
  const actual = sha256(bytes);
  if (actual !== entry.sha256) {
    throw new ArtifactReadError(
      `artifact payload digest mismatch: ${entry.path}`,
      "digest-mismatch",
      entry.path,
    );
  }
  return decodePayload(bytes, entry.path);
}

function manifestBytes(projectRoot: string): string {
  const path = join(projectRoot, ".atlante", "artifacts", "manifest.json");
  const stat = existingStat(path);
  if (!stat) {
    throw new ArtifactReadError(
      "manifest.json is missing",
      "invalid-manifest",
      path,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new ArtifactReadError(
      "manifest.json must not be a symlink",
      "unsafe-path",
      path,
    );
  }
  if (!stat.isFile()) {
    throw new ArtifactReadError(
      "manifest.json must be a regular file",
      "invalid-manifest",
      path,
    );
  }
  return decodePayload(
    readRegularFile(
      projectRoot,
      ".atlante/artifacts/manifest.json",
      "manifest.json",
    ),
    "manifest.json",
    manifestDecoder,
  );
}

/**
 * Reads and verifies a complete artifact publication. The directory is
 * intentionally treated as an all-or-nothing value: arrays are assembled only
 * after every manifest entry has passed path, UTF-8, and digest verification.
 */
export function readArtifacts(
  projectRoot: string,
): VerifiedArtifacts | undefined {
  if (typeof projectRoot !== "string" || projectRoot.length === 0) {
    throw new ArtifactReadError("project root must be a non-empty string");
  }

  const resolvedProjectRoot = resolve(projectRoot);
  if (!findArtifactRoot(resolvedProjectRoot)) return undefined;

  const manifest = parseManifest(manifestBytes(resolvedProjectRoot));
  const verifiedAgents = manifest.agents.map((entry) => ({
    entry,
    content: verifyPayload(resolvedProjectRoot, entry),
  }));
  const verifiedSkills = manifest.skills.map((entry) => ({
    entry,
    content: verifyPayload(resolvedProjectRoot, entry),
  }));

  const agents = verifiedAgents.map(({ entry, content: prompt }) => ({
    hostAgentId: entry.id,
    description: entry.description,
    prompt,
  }));
  const skills = verifiedSkills.map(({ entry, content }) => ({
    skillId: entry.id,
    description: entry.description,
    content,
  }));

  return { agents, skills };
}
