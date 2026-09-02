import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const NATIVE_FORMAT = "atlante-opencode-native" as const;
const NATIVE_VERSION = 1 as const;
const MANIFEST_PATH = ".atlante/opencode-native.json";
const MAX_ID_LENGTH = 64;
const NATIVE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export type OpenCodePreparedAgent = Readonly<{
  hostAgentId: string;
  description: string;
  prompt: string;
}>;

export type OpenCodePreparedSkill = Readonly<{
  skillId: string;
  description: string;
  content: string;
}>;

/**
 * Structural input accepted from the builder's PreparedProject.
 *
 * This type intentionally does not import the builder package. The builder can
 * pass its richer prepared value by structural compatibility, while the host
 * materializer remains independent from source loading and resolution.
 */
export type OpenCodePreparedProject = Readonly<{
  agents: readonly OpenCodePreparedAgent[];
  skills: readonly OpenCodePreparedSkill[];
}>;

export type OpenCodeOwnedFile = Readonly<{
  kind: "agent" | "skill";
  id: string;
  path: string;
  sha256: string;
}>;

export type OpenCodeOwnershipManifest = Readonly<{
  format: typeof NATIVE_FORMAT;
  version: typeof NATIVE_VERSION;
  files: readonly OpenCodeOwnedFile[];
}>;

export type OpenCodeMaterializationOperation =
  | "ensure-metadata"
  | "create-stage"
  | "stage-directory"
  | "stage-file"
  | "stage-manifest"
  | "publish-file"
  | "remove-stale"
  | "publish-manifest"
  | "rollback-file"
  | "rollback-manifest"
  | "cleanup-stage"
  | "cleanup-directory";

export type OpenCodeMaterializerDependencies = Readonly<{
  /** Test seam for failures at filesystem boundaries. */
  fault?: (operation: OpenCodeMaterializationOperation, path: string) => void;
}>;

export type OpenCodeMaterializationResult = Readonly<{
  manifestPath: string;
  manifest: OpenCodeOwnershipManifest;
  writtenPaths: readonly string[];
  removedPaths: readonly string[];
}>;

export type OpenCodeMaterializationErrorCode =
  | "invalid-input"
  | "invalid-id"
  | "invalid-manifest"
  | "unsafe-path"
  | "collision"
  | "drift"
  | "filesystem"
  | "publication-failed";

export class OpenCodeMaterializationError extends Error {
  readonly code: OpenCodeMaterializationErrorCode;
  readonly path?: string;

  constructor(
    message: string,
    code: OpenCodeMaterializationErrorCode,
    path?: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "OpenCodeMaterializationError";
    this.code = code;
    this.path = path;
  }
}

type ValidatedPreparedProject = {
  agents: OpenCodePreparedAgent[];
  skills: OpenCodePreparedSkill[];
};

type DesiredFile = {
  entry: OpenCodeOwnedFile;
  relativePath: string;
  absolutePath: string;
  bytes: Uint8Array;
};

type FileSnapshot = {
  relativePath: string;
  absolutePath: string;
  exists: boolean;
  bytes?: Uint8Array;
  mode?: number;
};

type PreviousManifest = {
  manifest?: OpenCodeOwnershipManifest;
  snapshot: FileSnapshot;
};

type MaterializationPlan = {
  root: string;
  manifestPath: string;
  manifestBytes: Uint8Array;
  manifest: OpenCodeOwnershipManifest;
  previousFiles: Map<string, OpenCodeOwnedFile>;
  desired: DesiredFile[];
  writes: DesiredFile[];
  stale: FileSnapshot[];
  snapshots: Map<string, FileSnapshot>;
  manifestWrite: boolean;
};

type PublicationState = {
  stageRoot?: string;
  createdDirectories: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && keys.every((key) => actual.includes(key))
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function missing(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "ENOENT"
  );
}

function invalidInput(
  message: string,
  path?: string,
): OpenCodeMaterializationError {
  return new OpenCodeMaterializationError(message, "invalid-input", path);
}

function invalidManifest(
  message: string,
  path?: string,
): OpenCodeMaterializationError {
  return new OpenCodeMaterializationError(message, "invalid-manifest", path);
}

function unsafePath(
  message: string,
  path: string,
): OpenCodeMaterializationError {
  return new OpenCodeMaterializationError(message, "unsafe-path", path);
}

function existingStat(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (cause) {
    if (missing(cause)) return undefined;
    throw new OpenCodeMaterializationError(
      `cannot inspect OpenCode materialization path: ${path}`,
      "filesystem",
      path,
      cause,
    );
  }
}

function assertProjectRoot(projectRoot: string): string {
  if (typeof projectRoot !== "string" || projectRoot.length === 0)
    throw invalidInput("project root must be a non-empty string");

  const root = resolve(projectRoot);
  const stats = existingStat(root);
  if (!stats) throw invalidInput(`project root does not exist: ${root}`, root);
  if (stats.isSymbolicLink())
    throw unsafePath("project root must not be a symlink", root);
  if (!stats.isDirectory())
    throw invalidInput(`project root must be a directory: ${root}`, root);
  return root;
}

function assertNativeId(value: unknown, subject: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OpenCodeMaterializationError(
      `${subject} must be a non-empty OpenCode native ID`,
      "invalid-id",
    );
  }
  if (value.length > MAX_ID_LENGTH || !NATIVE_ID_PATTERN.test(value)) {
    throw new OpenCodeMaterializationError(
      `${subject} "${value}" is incompatible with OpenCode native materialization; expected lowercase kebab-case ASCII of at most ${MAX_ID_LENGTH} characters, and IDs are never renamed`,
      "invalid-id",
    );
  }
  return value;
}

function assertText(
  value: unknown,
  subject: string,
  allowEmpty: boolean,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw invalidInput(
      `${subject} must be a ${allowEmpty ? "string" : "non-empty string"}`,
    );
  }
  return value;
}

function validatePreparedAgent(
  value: unknown,
  index: number,
): OpenCodePreparedAgent {
  if (!isRecord(value))
    throw invalidInput(`prepared agent[${index}] must be an object`);
  return {
    hostAgentId: assertNativeId(
      value.hostAgentId,
      `prepared agent[${index}].hostAgentId`,
    ),
    description: assertText(
      value.description,
      `prepared agent[${index}].description`,
      false,
    ),
    prompt: assertText(value.prompt, `prepared agent[${index}].prompt`, true),
  };
}

function validatePreparedSkill(
  value: unknown,
  index: number,
): OpenCodePreparedSkill {
  if (!isRecord(value))
    throw invalidInput(`prepared skill[${index}] must be an object`);
  return {
    skillId: assertNativeId(value.skillId, `prepared skill[${index}].skillId`),
    description: assertText(
      value.description,
      `prepared skill[${index}].description`,
      false,
    ),
    content: assertText(
      value.content,
      `prepared skill[${index}].content`,
      true,
    ),
  };
}

function collectPrepared<T>(
  values: unknown[],
  subject: "agent" | "skill",
  validate: (value: unknown, index: number) => T,
  idOf: (value: T) => string,
): T[] {
  const ids = new Set<string>();
  const result: T[] = [];
  for (const [index, value] of values.entries()) {
    const item = validate(value, index);
    const id = idOf(item);
    if (ids.has(id))
      throw invalidInput(`duplicate prepared ${subject} ID: ${id}`);
    ids.add(id);
    result.push(item);
  }
  return result;
}

function validatePreparedProject(value: unknown): ValidatedPreparedProject {
  if (!isRecord(value))
    throw invalidInput("prepared project must be an object");
  if (!Array.isArray(value.agents) || !Array.isArray(value.skills)) {
    throw invalidInput(
      "prepared project must contain agents and skills arrays",
    );
  }

  const agents = collectPrepared(
    value.agents,
    "agent",
    validatePreparedAgent,
    (agent) => agent.hostAgentId,
  );
  const skills = collectPrepared(
    value.skills,
    "skill",
    validatePreparedSkill,
    (skill) => skill.skillId,
  );
  return { agents, skills };
}

function nativePath(kind: OpenCodeOwnedFile["kind"], id: string): string {
  return kind === "agent"
    ? `.opencode/agents/${id}.md`
    : `.opencode/skills/${id}/SKILL.md`;
}

function isSafeRelativePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  )
    return false;
  return path
    .split("/")
    .every((part) => part.length > 0 && part !== "." && part !== "..");
}

function absolutePath(root: string, relativePath: string): string {
  if (!isSafeRelativePath(relativePath))
    throw unsafePath("OpenCode materialization path is unsafe", relativePath);
  const absolute = resolve(root, ...relativePath.split("/"));
  const prefix = root.endsWith("/") ? root : `${root}/`;
  if (absolute !== root && !absolute.startsWith(prefix))
    throw unsafePath(
      "OpenCode materialization path escapes the project root",
      relativePath,
    );
  return absolute;
}

function validateParentDirectories(root: string, relativePath: string): void {
  let current = root;
  for (const part of relativePath.split("/").slice(0, -1)) {
    current = join(current, part);
    const stats = existingStat(current);
    if (!stats) break;
    if (stats.isSymbolicLink())
      throw unsafePath(
        "OpenCode materialization parent must not be a symlink",
        current,
      );
    if (!stats.isDirectory())
      throw new OpenCodeMaterializationError(
        `OpenCode materialization parent must be a directory: ${current}`,
        "unsafe-path",
        current,
      );
  }
}

function readSnapshot(root: string, relativePath: string): FileSnapshot {
  const absolute = absolutePath(root, relativePath);
  const stats = existingStat(absolute);
  if (!stats) return { relativePath, absolutePath: absolute, exists: false };
  if (stats.isSymbolicLink())
    throw unsafePath(
      "OpenCode materialization target must not be a symlink",
      absolute,
    );
  if (!stats.isFile())
    throw new OpenCodeMaterializationError(
      `OpenCode materialization target must be a regular file: ${absolute}`,
      "unsafe-path",
      absolute,
    );
  try {
    return {
      relativePath,
      absolutePath: absolute,
      exists: true,
      bytes: readFileSync(absolute),
      mode: stats.mode & 0o777,
    };
  } catch (cause) {
    throw new OpenCodeMaterializationError(
      `cannot read OpenCode materialization target: ${absolute}`,
      "filesystem",
      absolute,
      cause,
    );
  }
}

function sameBytes(
  left: Uint8Array | undefined,
  right: Uint8Array | undefined,
): boolean {
  if (!left || !right) return left === right;
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function quoteFrontmatter(value: string): string {
  return JSON.stringify(value);
}

function renderAgent(agent: OpenCodePreparedAgent): Uint8Array {
  return utf8(
    `---\ndescription: ${quoteFrontmatter(agent.description)}\n---\n${agent.prompt}`,
  );
}

function renderSkill(skill: OpenCodePreparedSkill): Uint8Array {
  return utf8(
    `---\nname: ${quoteFrontmatter(skill.skillId)}\ndescription: ${quoteFrontmatter(skill.description)}\n---\n${skill.content}`,
  );
}

function desiredFiles(
  root: string,
  prepared: ValidatedPreparedProject,
): DesiredFile[] {
  const files: DesiredFile[] = [
    ...prepared.agents.map((agent) => {
      const bytes = renderAgent(agent);
      const relativePath = nativePath("agent", agent.hostAgentId);
      return {
        entry: {
          kind: "agent" as const,
          id: agent.hostAgentId,
          path: relativePath,
          sha256: sha256(bytes),
        },
        relativePath,
        absolutePath: absolutePath(root, relativePath),
        bytes,
      };
    }),
    ...prepared.skills.map((skill) => {
      const bytes = renderSkill(skill);
      const relativePath = nativePath("skill", skill.skillId);
      return {
        entry: {
          kind: "skill" as const,
          id: skill.skillId,
          path: relativePath,
          sha256: sha256(bytes),
        },
        relativePath,
        absolutePath: absolutePath(root, relativePath),
        bytes,
      };
    }),
  ];
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

function manifestEntryRecord(
  value: unknown,
  index: number,
): Record<string, unknown> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "id", "path", "sha256"])
  )
    throw invalidManifest(
      `files[${index}] must contain exactly kind, id, path, and sha256`,
    );
  return value;
}

function manifestEntryIdentity(
  value: Record<string, unknown>,
  index: number,
  ids: Set<string>,
): Pick<OpenCodeOwnedFile, "kind" | "id"> {
  if (value.kind !== "agent" && value.kind !== "skill")
    throw invalidManifest(`files[${index}].kind is unsupported`);
  if (typeof value.id !== "string")
    throw invalidManifest(`files[${index}].id must be a string`);
  const id = assertNativeId(value.id, `manifest files[${index}].id`);
  const identity = `${value.kind}:${id}`;
  if (ids.has(identity))
    throw invalidManifest(`duplicate ${value.kind} ID: ${id}`);
  ids.add(identity);
  return { kind: value.kind, id };
}

function manifestEntryPath(
  value: Record<string, unknown>,
  index: number,
  identity: Pick<OpenCodeOwnedFile, "kind" | "id">,
  paths: Set<string>,
): string {
  if (typeof value.path !== "string" || !isSafeRelativePath(value.path))
    throw unsafePath(`files[${index}].path is unsafe`, String(value.path));
  if (paths.has(value.path))
    throw invalidManifest(`duplicate native path: ${value.path}`);
  const expectedPath = nativePath(identity.kind, identity.id);
  if (value.path !== expectedPath)
    throw unsafePath(
      `manifest files[${index}].path does not match its native kind and ID`,
      value.path,
    );
  paths.add(value.path);
  return value.path;
}

function manifestEntryDigest(
  value: Record<string, unknown>,
  index: number,
): string {
  if (typeof value.sha256 !== "string" || !SHA256_PATTERN.test(value.sha256))
    throw invalidManifest(
      `files[${index}].sha256 must be lowercase SHA-256 hex`,
    );
  return value.sha256;
}

function validateManifestEntry(
  value: unknown,
  index: number,
  ids: Set<string>,
  paths: Set<string>,
): OpenCodeOwnedFile {
  const record = manifestEntryRecord(value, index);
  const identity = manifestEntryIdentity(record, index, ids);
  const path = manifestEntryPath(record, index, identity, paths);
  return {
    ...identity,
    path,
    sha256: manifestEntryDigest(record, index),
  };
}

function readPreviousManifest(root: string): PreviousManifest {
  const snapshot = readSnapshot(root, MANIFEST_PATH);
  if (!snapshot.exists) return { snapshot };
  let value: unknown;
  try {
    value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes),
    );
  } catch (cause) {
    throw invalidManifest(
      `ownership manifest is not valid UTF-8 JSON: ${errorMessage(cause)}`,
      MANIFEST_PATH,
    );
  }
  if (!isRecord(value) || !hasExactKeys(value, ["format", "version", "files"]))
    throw invalidManifest(
      "ownership manifest contains unknown or missing fields",
      MANIFEST_PATH,
    );
  if (value.format !== NATIVE_FORMAT || value.version !== NATIVE_VERSION)
    throw invalidManifest(
      "ownership manifest format or version is unsupported",
      MANIFEST_PATH,
    );
  if (!Array.isArray(value.files))
    throw invalidManifest(
      "ownership manifest files must be an array",
      MANIFEST_PATH,
    );

  const ids = new Set<string>();
  const paths = new Set<string>();
  const files = value.files.map((entry, index) =>
    validateManifestEntry(entry, index, ids, paths),
  );
  return {
    snapshot,
    manifest: { format: NATIVE_FORMAT, version: NATIVE_VERSION, files },
  };
}

function trigger(
  dependencies: OpenCodeMaterializerDependencies,
  operation: OpenCodeMaterializationOperation,
  path: string,
): void {
  dependencies.fault?.(operation, path);
}

function ensureDirectory(
  root: string,
  relativeDirectory: string,
  state: PublicationState,
  dependencies: OpenCodeMaterializerDependencies,
): string {
  if (relativeDirectory.length === 0) return root;
  let current = root;
  for (const part of relativeDirectory.split("/")) {
    current = join(current, part);
    const stats = existingStat(current);
    if (stats) {
      if (stats.isSymbolicLink())
        throw unsafePath(
          "OpenCode materialization directory must not be a symlink",
          current,
        );
      if (!stats.isDirectory())
        throw new OpenCodeMaterializationError(
          `OpenCode materialization path must be a directory: ${current}`,
          "unsafe-path",
          current,
        );
      continue;
    }
    trigger(dependencies, "stage-directory", current);
    mkdirSync(current);
    state.createdDirectories.push(current);
  }
  return current;
}

function syncFile(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function stageFile(
  path: string,
  bytes: Uint8Array,
  mode: number,
  operation: "stage-file" | "stage-manifest",
  dependencies: OpenCodeMaterializerDependencies,
): void {
  trigger(dependencies, operation, path);
  writeFileSync(path, bytes, { flag: "wx", mode });
  chmodSync(path, mode);
  syncFile(path);
}

function stagePath(stageRoot: string, relativePath: string): string {
  return join(stageRoot, ...relativePath.split("/"));
}

function snapshotMatches(
  current: FileSnapshot,
  expected: FileSnapshot,
): boolean {
  return (
    current.exists === expected.exists &&
    (!current.exists || sameBytes(current.bytes, expected.bytes))
  );
}

function assertSnapshotUnchanged(root: string, expected: FileSnapshot): void {
  const current = readSnapshot(root, expected.relativePath);
  if (!snapshotMatches(current, expected)) {
    throw new OpenCodeMaterializationError(
      `OpenCode materialization target changed during publication: ${expected.relativePath}`,
      "publication-failed",
      expected.absolutePath,
    );
  }
}

function expectedAfterMatches(
  current: FileSnapshot,
  expected: Uint8Array | undefined,
): boolean {
  if (!expected) return !current.exists;
  return current.exists && sameBytes(current.bytes, expected);
}

function restoreSnapshot(
  root: string,
  snapshot: FileSnapshot,
  expectedAfter: Uint8Array | undefined,
  stageRoot: string,
  index: number,
  dependencies: OpenCodeMaterializerDependencies,
): void {
  const current = readSnapshot(root, snapshot.relativePath);
  if (snapshotMatches(current, snapshot)) return;
  if (!expectedAfterMatches(current, expectedAfter)) {
    throw new OpenCodeMaterializationError(
      `cannot safely roll back changed OpenCode target: ${snapshot.relativePath}`,
      "publication-failed",
      snapshot.absolutePath,
    );
  }

  if (!snapshot.exists) {
    rmSync(snapshot.absolutePath, { force: true });
    return;
  }

  const restoreDirectory = join(stageRoot, "restore");
  mkdirSync(restoreDirectory, { recursive: true });
  const restorePath = join(restoreDirectory, `${index}.restore`);
  trigger(
    dependencies,
    snapshot.relativePath === MANIFEST_PATH
      ? "rollback-manifest"
      : "rollback-file",
    snapshot.absolutePath,
  );
  writeFileSync(restorePath, snapshot.bytes as Uint8Array, {
    flag: "wx",
    mode: snapshot.mode ?? 0o644,
  });
  chmodSync(restorePath, snapshot.mode ?? 0o644);
  syncFile(restorePath);
  renameSync(restorePath, snapshot.absolutePath);
}

function cleanupDirectories(
  state: PublicationState,
  dependencies: OpenCodeMaterializerDependencies,
): void {
  for (const path of [...state.createdDirectories].reverse()) {
    try {
      trigger(dependencies, "cleanup-directory", path);
      rmSync(path);
    } catch (cause) {
      if (!missing(cause)) throw cause;
    }
  }
}

function previousFileMap(
  previous: PreviousManifest,
): Map<string, OpenCodeOwnedFile> {
  return new Map(
    (previous.manifest?.files ?? []).map((entry) => [entry.path, entry]),
  );
}

function desiredPathSet(desired: readonly DesiredFile[]): Set<string> {
  const paths = new Set<string>();
  for (const file of desired) {
    if (paths.has(file.relativePath))
      throw invalidInput(
        `duplicate native materialization path: ${file.relativePath}`,
      );
    paths.add(file.relativePath);
  }
  return paths;
}

function staleEntries(
  previousFiles: ReadonlyMap<string, OpenCodeOwnedFile>,
  desiredPaths: ReadonlySet<string>,
): OpenCodeOwnedFile[] {
  return [...previousFiles.values()].filter(
    (entry) => !desiredPaths.has(entry.path),
  );
}

function captureSnapshots(
  root: string,
  desired: readonly DesiredFile[],
  stale: readonly OpenCodeOwnedFile[],
): Map<string, FileSnapshot> {
  const paths = new Set([
    ...desired.map((file) => file.relativePath),
    ...stale.map((entry) => entry.path),
    MANIFEST_PATH,
  ]);
  return new Map([...paths].map((path) => [path, readSnapshot(root, path)]));
}

function requireSnapshot(
  snapshots: ReadonlyMap<string, FileSnapshot>,
  path: string,
): FileSnapshot {
  const snapshot = snapshots.get(path);
  if (!snapshot) throw new Error(`missing snapshot: ${path}`);
  return snapshot;
}

function validateDesiredFiles(
  desired: readonly DesiredFile[],
  previousFiles: ReadonlyMap<string, OpenCodeOwnedFile>,
  snapshots: ReadonlyMap<string, FileSnapshot>,
): void {
  for (const file of desired) {
    const current = requireSnapshot(snapshots, file.relativePath);
    const previous = previousFiles.get(file.relativePath);
    if (current.exists && !previous)
      throw new OpenCodeMaterializationError(
        `unowned OpenCode target would be overwritten: ${file.relativePath}`,
        "collision",
        current.absolutePath,
      );
    if (
      current.exists &&
      previous &&
      sha256(current.bytes as Uint8Array) !== previous.sha256
    )
      throw new OpenCodeMaterializationError(
        `owned OpenCode target drifted since the last materialization: ${file.relativePath}`,
        "drift",
        current.absolutePath,
      );
  }
}

function staleSnapshots(
  entries: readonly OpenCodeOwnedFile[],
  snapshots: ReadonlyMap<string, FileSnapshot>,
): FileSnapshot[] {
  const stale: FileSnapshot[] = [];
  for (const entry of entries) {
    const current = requireSnapshot(snapshots, entry.path);
    if (current.exists && sha256(current.bytes as Uint8Array) !== entry.sha256)
      throw new OpenCodeMaterializationError(
        `stale owned OpenCode target drifted and cannot be removed: ${entry.path}`,
        "drift",
        current.absolutePath,
      );
    if (current.exists) stale.push(current);
  }
  return stale;
}

function planMaterialization(
  projectRoot: string,
  input: OpenCodePreparedProject,
): MaterializationPlan {
  const root = assertProjectRoot(projectRoot);
  const prepared = validatePreparedProject(input);
  const previous = readPreviousManifest(root);
  const previousFiles = previousFileMap(previous);
  const desired = desiredFiles(root, prepared);
  const desiredPaths = desiredPathSet(desired);
  for (const file of desired)
    validateParentDirectories(root, file.relativePath);
  const oldEntries = staleEntries(previousFiles, desiredPaths);
  for (const entry of oldEntries) validateParentDirectories(root, entry.path);
  validateParentDirectories(root, MANIFEST_PATH);

  const snapshots = captureSnapshots(root, desired, oldEntries);
  validateDesiredFiles(desired, previousFiles, snapshots);
  const stale = staleSnapshots(oldEntries, snapshots);
  const manifest: OpenCodeOwnershipManifest = {
    format: NATIVE_FORMAT,
    version: NATIVE_VERSION,
    files: desired.map((file) => file.entry),
  };
  const manifestBytes = utf8(`${JSON.stringify(manifest, null, 2)}\n`);
  const currentManifest = requireSnapshot(snapshots, MANIFEST_PATH);

  return {
    root,
    manifestPath: absolutePath(root, MANIFEST_PATH),
    manifestBytes,
    manifest,
    previousFiles,
    desired,
    writes: desired.filter((file) => {
      const current = requireSnapshot(snapshots, file.relativePath);
      return !current.exists || !sameBytes(current.bytes, file.bytes);
    }),
    stale,
    snapshots,
    manifestWrite:
      !currentManifest.exists ||
      !sameBytes(currentManifest.bytes, manifestBytes),
  };
}

type Stage = {
  root: string;
  manifest: string;
};

function relativeDirectory(relativePath: string): string {
  return dirname(relativePath).replaceAll("\\", "/");
}

function createStage(
  plan: MaterializationPlan,
  state: PublicationState,
  dependencies: OpenCodeMaterializerDependencies,
): Stage {
  ensureDirectory(plan.root, ".atlante", state, dependencies);
  const metadata = join(plan.root, ".atlante");
  trigger(dependencies, "create-stage", metadata);
  const root = mkdtempSync(join(metadata, ".opencode-native.stage-"));
  state.stageRoot = root;
  const stageState: PublicationState = { createdDirectories: [] };
  for (const file of plan.writes) {
    const staged = stagePath(root, file.relativePath);
    ensureDirectory(
      root,
      relativeDirectory(file.relativePath),
      stageState,
      dependencies,
    );
    const snapshot = requireSnapshot(plan.snapshots, file.relativePath);
    stageFile(
      staged,
      file.bytes,
      snapshot.mode ?? 0o644,
      "stage-file",
      dependencies,
    );
  }
  const manifest = join(root, "manifest.json");
  if (plan.manifestWrite)
    stageFile(
      manifest,
      plan.manifestBytes,
      0o644,
      "stage-manifest",
      dependencies,
    );
  return { root, manifest };
}

function publishDesiredFiles(
  plan: MaterializationPlan,
  stage: Stage,
  state: PublicationState,
  dependencies: OpenCodeMaterializerDependencies,
): void {
  for (const file of plan.writes) {
    ensureDirectory(
      plan.root,
      relativeDirectory(file.relativePath),
      state,
      dependencies,
    );
    const snapshot = requireSnapshot(plan.snapshots, file.relativePath);
    assertSnapshotUnchanged(plan.root, snapshot);
    trigger(dependencies, "publish-file", file.absolutePath);
    renameSync(stagePath(stage.root, file.relativePath), file.absolutePath);
  }
}

function publishStaleFiles(
  plan: MaterializationPlan,
  dependencies: OpenCodeMaterializerDependencies,
): void {
  for (const file of plan.stale) {
    const snapshot = requireSnapshot(plan.snapshots, file.relativePath);
    assertSnapshotUnchanged(plan.root, snapshot);
    trigger(dependencies, "remove-stale", file.absolutePath);
    rmSync(file.absolutePath);
  }
}

function publishManifest(
  plan: MaterializationPlan,
  stage: Stage,
  dependencies: OpenCodeMaterializerDependencies,
): void {
  if (!plan.manifestWrite) return;
  const snapshot = requireSnapshot(plan.snapshots, MANIFEST_PATH);
  assertSnapshotUnchanged(plan.root, snapshot);
  trigger(dependencies, "publish-manifest", plan.manifestPath);
  renameSync(stage.manifest, plan.manifestPath);
}

function touchedPaths(plan: MaterializationPlan): string[] {
  return [
    ...plan.writes.map((file) => file.relativePath),
    ...plan.stale.map((file) => file.relativePath),
    ...(plan.manifestWrite ? [MANIFEST_PATH] : []),
  ];
}

function expectedAfter(
  plan: MaterializationPlan,
): Map<string, Uint8Array | undefined> {
  const expected = new Map<string, Uint8Array | undefined>();
  for (const file of plan.writes) expected.set(file.relativePath, file.bytes);
  for (const file of plan.stale) expected.set(file.relativePath, undefined);
  if (plan.manifestWrite) expected.set(MANIFEST_PATH, plan.manifestBytes);
  return expected;
}

function rollbackPlan(
  plan: MaterializationPlan,
  state: PublicationState,
  touched: readonly string[],
  expected: ReadonlyMap<string, Uint8Array | undefined>,
  dependencies: OpenCodeMaterializerDependencies,
): unknown[] {
  if (!state.stageRoot) return [];
  const errors: unknown[] = [];
  for (const [index, relativePath] of [...touched].reverse().entries()) {
    const snapshot = plan.snapshots.get(relativePath);
    if (!snapshot) continue;
    try {
      restoreSnapshot(
        plan.root,
        snapshot,
        expected.get(relativePath),
        state.stageRoot,
        index,
        dependencies,
      );
    } catch (cause) {
      errors.push(cause);
    }
  }
  return errors;
}

function cleanupStage(
  state: PublicationState,
  dependencies: OpenCodeMaterializerDependencies,
): void {
  if (!state.stageRoot) return;
  const stageRoot = state.stageRoot;
  trigger(dependencies, "cleanup-stage", stageRoot);
  rmSync(stageRoot, { recursive: true, force: true });
  state.stageRoot = undefined;
}

function publishPlan(
  plan: MaterializationPlan,
  dependencies: OpenCodeMaterializerDependencies,
): OpenCodeMaterializationResult {
  const state: PublicationState = { createdDirectories: [] };
  const touched = touchedPaths(plan);
  const expected = expectedAfter(plan);
  try {
    const stage = createStage(plan, state, dependencies);
    publishDesiredFiles(plan, stage, state, dependencies);
    publishStaleFiles(plan, dependencies);
    publishManifest(plan, stage, dependencies);
    cleanupStage(state, dependencies);
    return {
      manifestPath: plan.manifestPath,
      manifest: plan.manifest,
      writtenPaths: plan.writes.map((file) => file.relativePath),
      removedPaths: plan.stale.map((file) => file.relativePath),
    };
  } catch (cause) {
    const rollbackErrors = rollbackPlan(
      plan,
      state,
      touched,
      expected,
      dependencies,
    );
    try {
      cleanupStage(state, dependencies);
    } catch (cleanupCause) {
      rollbackErrors.push(cleanupCause);
    }
    try {
      cleanupDirectories(state, dependencies);
    } catch (cleanupCause) {
      rollbackErrors.push(cleanupCause);
    }
    const detail = rollbackErrors.length
      ? `; rollback failed: ${rollbackErrors.map(errorMessage).join("; ")}`
      : "";
    throw new OpenCodeMaterializationError(
      `OpenCode native publication failed: ${errorMessage(cause)}${detail}`,
      "publication-failed",
      undefined,
      cause,
    );
  }
}

/**
 * Materializes a prepared-project-shaped value into OpenCode-native files.
 *
 * This is an experimental build-time prototype. It deliberately does not load
 * source configuration, resolve resources, or alter the runtime plugin path.
 */
export function materializeOpenCode(
  projectRoot: string,
  preparedProject: OpenCodePreparedProject,
  dependencies: OpenCodeMaterializerDependencies = {},
): OpenCodeMaterializationResult {
  return publishPlan(
    planMaterialization(projectRoot, preparedProject),
    dependencies,
  );
}
