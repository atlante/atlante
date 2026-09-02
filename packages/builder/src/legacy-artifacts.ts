import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "@atlante/validator";
import { error } from "@atlante/validator";

/**
 * Migration of the superseded `.atlante/artifacts` payload tree. The tree is
 * Atlante-owned generated state (never user content), so a manifest-valid tree
 * is removed whole once every materialization succeeded. Anything the manifest
 * does not account for fails the build closed, before any mutation.
 */

const MANIFEST_ENTRY = "manifest.json";
const ARTIFACT_FORMAT = "atlante-artifacts";
const ARTIFACT_VERSION = 1;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

type LegacyManifestEntry = {
  id: string;
  path: string;
  sha256: string;
};

export type LegacyManifest = {
  format: typeof ARTIFACT_FORMAT;
  version: typeof ARTIFACT_VERSION;
  agents: LegacyManifestEntry[];
  skills: LegacyManifestEntry[];
};

export type LegacyArtifactTree = {
  /** Absolute path of `.atlante/artifacts`. */
  treePath: string;
  entries: readonly LegacyManifestEntry[];
};

export type LegacyArtifactMigration =
  | { state: "absent" }
  | { state: "blocked"; diagnostics: Diagnostic[] }
  | { state: "pending"; tree: LegacyArtifactTree };

export type LegacyRemoval =
  | { state: "removed"; removedPath: string }
  | { state: "blocked"; diagnostics: Diagnostic[] };

function migrationDiagnostic(
  message: string,
  relativePath: string,
): Diagnostic {
  return error(
    "artifact-migration-blocked",
    `cannot migrate the legacy artifact tree: ${message}`,
    {
      source: relativePath,
      next: "resolve the reported legacy artifact state manually, then run `atlante build` again; the legacy tree is left untouched",
    },
  );
}

function existingStats(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
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

function parseManifestEntry(
  value: unknown,
  namespace: string,
  index: number,
  paths: Set<string>,
): LegacyManifestEntry | string {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return `${namespace}[${index}] must be an object`;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0)
    return `${namespace}[${index}].id must be a non-empty string`;
  if (typeof record.path !== "string")
    return `${namespace}[${index}].path must be a string`;
  if (typeof record.sha256 !== "string" || !SHA256_PATTERN.test(record.sha256))
    return `${namespace}[${index}].sha256 must be lowercase SHA-256 hex`;
  if (!isSafeRelativePath(record.path))
    return `${namespace}[${index}].path is unsafe`;
  if (paths.has(record.path)) return `duplicate artifact path: ${record.path}`;
  paths.add(record.path);
  return { id: record.id, path: record.path, sha256: record.sha256 };
}

function parseLegacyManifest(text: string): LegacyManifest | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return "manifest.json is not valid JSON";
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return "manifest.json must be an object";
  const manifest = parsed as Record<string, unknown>;
  if (
    manifest.format !== ARTIFACT_FORMAT ||
    manifest.version !== ARTIFACT_VERSION
  )
    return "manifest.json format or version is unsupported";
  if (!Array.isArray(manifest.agents) || !Array.isArray(manifest.skills))
    return "manifest.json agents and skills must be arrays";

  const paths = new Set<string>();
  const agents: LegacyManifestEntry[] = [];
  const skills: LegacyManifestEntry[] = [];
  for (const [index, value] of manifest.agents.entries()) {
    const entry = parseManifestEntry(value, "agents", index, paths);
    if (typeof entry === "string") return entry;
    agents.push(entry);
  }
  for (const [index, value] of manifest.skills.entries()) {
    const entry = parseManifestEntry(value, "skills", index, paths);
    if (typeof entry === "string") return entry;
    skills.push(entry);
  }
  return {
    format: ARTIFACT_FORMAT,
    version: ARTIFACT_VERSION,
    agents,
    skills,
  };
}

/** Collects every regular file below the tree, as forward-slash relative paths. */
function treeFiles(root: string): { files: string[] } | { error: string } {
  const files: string[] = [];
  const visit = (absolute: string, relative: string): string | undefined => {
    const stats = existingStats(absolute);
    if (!stats) return `${relative} is missing`;
    if (stats.isSymbolicLink()) return `${relative} must not be a symlink`;
    if (stats.isDirectory()) {
      for (const entry of readdirSync(absolute)) {
        const childRelative = relative ? `${relative}/${entry}` : entry;
        const failure = visit(join(absolute, entry), childRelative);
        if (failure) return failure;
      }
      return undefined;
    }
    if (stats.isFile()) {
      files.push(relative);
      return undefined;
    }
    return `${relative} is not a regular file`;
  };
  const failure = visit(root, "");
  return failure ? { error: failure } : { files };
}

/**
 * Fail-closed preflight, run before any filesystem mutation: an existing
 * legacy tree must be a manifest-valid, fully accounted publication.
 */
export function preflightLegacyArtifactTree(
  projectRoot: string,
): LegacyArtifactMigration {
  const treePath = join(projectRoot, ".atlante", "artifacts");
  const treeStats = existingStats(treePath);
  if (!treeStats) return { state: "absent" };
  if (treeStats.isSymbolicLink() || !treeStats.isDirectory())
    return {
      state: "blocked",
      diagnostics: [
        migrationDiagnostic(
          ".atlante/artifacts must be a real directory",
          ".atlante/artifacts",
        ),
      ],
    };

  const manifestPath = join(treePath, MANIFEST_ENTRY);
  const manifestStats = existingStats(manifestPath);
  if (
    !manifestStats ||
    manifestStats.isSymbolicLink() ||
    !manifestStats.isFile()
  )
    return {
      state: "blocked",
      diagnostics: [
        migrationDiagnostic(
          "manifest.json is missing or is not a regular file",
          ".atlante/artifacts/manifest.json",
        ),
      ],
    };

  let manifest: LegacyManifest | string;
  try {
    manifest = parseLegacyManifest(readFileSync(manifestPath, "utf8"));
  } catch {
    manifest = "manifest.json is unreadable";
  }
  if (typeof manifest === "string")
    return {
      state: "blocked",
      diagnostics: [
        migrationDiagnostic(manifest, ".atlante/artifacts/manifest.json"),
      ],
    };

  const scanned = treeFiles(treePath);
  if ("error" in scanned)
    return {
      state: "blocked",
      diagnostics: [migrationDiagnostic(scanned.error, ".atlante/artifacts")],
    };

  const declared = new Set(
    [...manifest.agents, ...manifest.skills].map((entry) => entry.path),
  );
  const offending =
    scanned.files.find(
      (file) => file !== MANIFEST_ENTRY && !declared.has(file),
    ) ?? [...declared].find((path) => !scanned.files.includes(path));
  if (offending) {
    const reason = declared.has(offending)
      ? `the declared payload is missing: ${offending}`
      : `the file is not declared by manifest.json: ${offending}`;
    return {
      state: "blocked",
      diagnostics: [
        migrationDiagnostic(reason, `.atlante/artifacts/${offending}`),
      ],
    };
  }

  return {
    state: "pending",
    tree: { treePath, entries: [...manifest.agents, ...manifest.skills] },
  };
}

function payloadDigest(
  treePath: string,
  entry: LegacyManifestEntry,
): string | undefined {
  const absolute = join(treePath, ...entry.path.split("/"));
  const stats = existingStats(absolute);
  if (!stats || stats.isSymbolicLink() || !stats.isFile()) return undefined;
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

/**
 * Re-verifies the tree's accounting and every declared payload against its
 * manifest digest, then removes the whole tree. Called only after every
 * materialization succeeded; any re-verification failure leaves the tree
 * untouched.
 */
export function removeLegacyArtifactTree(
  tree: LegacyArtifactTree,
): LegacyRemoval {
  const scanned = treeFiles(tree.treePath);
  if ("error" in scanned)
    return {
      state: "blocked",
      diagnostics: [migrationDiagnostic(scanned.error, ".atlante/artifacts")],
    };
  const declared = new Set(tree.entries.map((entry) => entry.path));
  const undeclared = scanned.files.find(
    (file) => file !== MANIFEST_ENTRY && !declared.has(file),
  );
  if (undeclared) {
    return {
      state: "blocked",
      diagnostics: [
        migrationDiagnostic(
          `the file is not declared by manifest.json: ${undeclared}`,
          `.atlante/artifacts/${undeclared}`,
        ),
      ],
    };
  }
  for (const entry of tree.entries) {
    if (payloadDigest(tree.treePath, entry) !== entry.sha256)
      return {
        state: "blocked",
        diagnostics: [
          migrationDiagnostic(
            `the payload no longer matches its manifest digest: ${entry.path}`,
            `.atlante/artifacts/${entry.path}`,
          ),
        ],
      };
  }
  try {
    rmSync(tree.treePath, { recursive: true });
  } catch (cause) {
    return {
      state: "blocked",
      diagnostics: [
        migrationDiagnostic(
          `removing the legacy tree failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          ".atlante/artifacts",
        ),
      ],
    };
  }
  return { state: "removed", removedPath: tree.treePath };
}
