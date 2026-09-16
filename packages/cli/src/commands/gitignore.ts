import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnyAtlanteDocument,
  DEFAULT_AGENT_OUTPUT_DIR,
  DEFAULT_SKILL_OUTPUT_DIR,
} from "@atlante/schema";
import { type Diagnostic, warning } from "@atlante/validator";
import type { PackFileSystem, Snapshot } from "./pack-dependencies.js";

const ATLANTE_STATE_GITIGNORE_ENTRY = ".atlante/";
const ATLANTE_SKILLS_GITIGNORE_ENTRY = ".opencode/skills/atlante/";

const NATIVE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NATIVE_ID_LENGTH = 64;
const NATIVE_MANIFEST = ".atlante/opencode-native.json";

type GitignoreFileSystem = Pick<
  PackFileSystem,
  "existsSync" | "readFileSync" | "writeFileSync"
>;

const defaultGitignoreFileSystem: GitignoreFileSystem = {
  existsSync,
  readFileSync: (path, encoding) => readFileSync(path, encoding),
  writeFileSync,
};

export type GitignorePlan = Readonly<{
  path: string;
  previous: Snapshot;
  contents: string;
  write: boolean;
}>;

type GitignorePlanOptions = Readonly<{
  /** Entries that must be present after reconciliation, in stable order. */
  required?: readonly string[];
  /** Exact agent entries previously established by Atlante and now stale. */
  removeAgentPaths?: readonly string[];
}>;

type NativeManifestEntry = Readonly<{
  kind?: unknown;
  path?: unknown;
}>;

function lineEnding(contents: string): "\n" | "\r\n" {
  return contents.includes("\r\n") ? "\r\n" : "\n";
}

function snapshotGitignore(
  path: string,
  fileSystem: GitignoreFileSystem,
): Snapshot {
  if (!fileSystem.existsSync(path)) return { exists: false };
  return { exists: true, contents: fileSystem.readFileSync(path, "utf8") };
}

function appendMissing(
  contents: string,
  missing: readonly string[],
  separator: "\n" | "\r\n",
): string {
  if (missing.length === 0) return contents;
  let result = contents;
  if (result.length > 0) {
    if (!result.endsWith(separator)) result += separator;
    result += separator;
  }
  return `${result}${missing.join(separator)}${separator}`;
}

function uniqueEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

/**
 * Plans a line-preserving `.gitignore` reconciliation. Existing unrelated
 * lines stay in their original order; only explicitly managed stale
 * entries are removed, and missing policy entries are appended once.
 */
export function prepareGitignore(
  directory: string,
  fileSystem: GitignoreFileSystem,
  options: GitignorePlanOptions = {},
): GitignorePlan {
  const path = join(directory, ".gitignore");
  const previous = snapshotGitignore(path, fileSystem);
  const original = previous.exists ? (previous.contents ?? "") : "";
  const separator = lineEnding(original);
  const remove = new Set<string>([...(options.removeAgentPaths ?? [])]);
  const retained = original
    .split(/\r?\n/)
    .filter((line) => !remove.has(line.trim()));
  const base = retained.join(separator);
  const present = new Set(retained.map((line) => line.trim()));
  const required = uniqueEntries(options.required ?? []);
  const missing = required.filter((entry) => !present.has(entry));
  const contents = appendMissing(base, missing, separator);
  return {
    path,
    previous,
    contents,
    write: contents !== original,
  };
}

function nativeId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_NATIVE_ID_LENGTH &&
    NATIVE_ID_PATTERN.test(value)
  );
}

/** Returns the exact default agent ignore path for a valid native ID. */
export function defaultAgentGitignorePath(id: string): string | undefined {
  return nativeId(id) ? `${DEFAULT_AGENT_OUTPUT_DIR}/${id}.md` : undefined;
}

/** Returns exact default agent paths from a canonical document. */
export function defaultAgentGitignorePaths(
  document: AnyAtlanteDocument,
): string[] {
  if (document.options?.agents?.outDir !== DEFAULT_AGENT_OUTPUT_DIR) return [];
  return Object.keys(document.agents ?? {})
    .sort()
    .map(defaultAgentGitignorePath)
    .filter((path): path is string => path !== undefined);
}

function isDefaultAgentGitignorePath(path: string): boolean {
  const prefix = `${DEFAULT_AGENT_OUTPUT_DIR}/`;
  if (!path.startsWith(prefix) || !path.endsWith(".md")) return false;
  const id = path.slice(prefix.length, -3);
  return defaultAgentGitignorePath(id) === path;
}

function isDefaultSkillNativePath(path: string): boolean {
  const prefix = `${DEFAULT_SKILL_OUTPUT_DIR}/`;
  if (!path.startsWith(prefix) || !path.endsWith("/SKILL.md")) return false;
  const id = path.slice(prefix.length, -"/SKILL.md".length);
  return nativeId(id);
}

function readNativeManifestEntries(
  directory: string,
  fileSystem: GitignoreFileSystem,
): NativeManifestEntry[] {
  const manifest = join(directory, NATIVE_MANIFEST);
  if (!fileSystem.existsSync(manifest)) return [];
  try {
    const parsed: unknown = JSON.parse(
      fileSystem.readFileSync(manifest, "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return [];
    const files = (parsed as { files?: unknown }).files;
    return Array.isArray(files)
      ? files.filter(
          (entry): entry is NativeManifestEntry =>
            typeof entry === "object" && entry !== null,
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Reads only safe default agent paths from the ownership manifest. This is
 * bookkeeping for ignore reconciliation, not a replacement for materializer
 * manifest validation.
 */
export function ownedDefaultAgentGitignorePaths(
  directory: string,
  fileSystem: GitignoreFileSystem = defaultGitignoreFileSystem,
): string[] {
  return uniqueEntries(
    readNativeManifestEntries(directory, fileSystem)
      .filter(
        (entry) => entry.kind === "agent" && typeof entry.path === "string",
      )
      .map((entry) => entry.path as string)
      .filter(isDefaultAgentGitignorePath),
  );
}

/** Computes the default ignore policy from a resolved canonical document. */
function defaultGitignoreEntries(document: AnyAtlanteDocument): string[] {
  const options = document.options;
  const result = [ATLANTE_STATE_GITIGNORE_ENTRY];
  if (options?.skills?.outDir === DEFAULT_SKILL_OUTPUT_DIR)
    result.push(ATLANTE_SKILLS_GITIGNORE_ENTRY);
  result.push(...defaultAgentGitignorePaths(document));
  return result;
}

/** Computes exact default entries for an already materialized native set. */
export function defaultGitignoreEntriesForBuild(
  directory: string,
  writtenPaths: readonly string[] = [],
  fileSystem: GitignoreFileSystem = defaultGitignoreFileSystem,
): string[] {
  const entries = readNativeManifestEntries(directory, fileSystem);
  const nativeAgentPaths = entries
    .filter((entry) => entry.kind === "agent" && typeof entry.path === "string")
    .map((entry) => entry.path as string);
  const nativeSkillPaths = entries
    .filter((entry) => entry.kind === "skill" && typeof entry.path === "string")
    .map((entry) => entry.path as string);
  const fallbackPaths = entries.length > 0 ? [] : [...writtenPaths];
  const agentPaths = uniqueEntries(
    nativeAgentPaths
      .concat(fallbackPaths)
      .filter(isDefaultAgentGitignorePath)
      .sort(),
  );
  const hasDefaultSkill = nativeSkillPaths
    .concat(fallbackPaths)
    .some(isDefaultSkillNativePath);
  return [
    ATLANTE_STATE_GITIGNORE_ENTRY,
    ...(hasDefaultSkill ? [ATLANTE_SKILLS_GITIGNORE_ENTRY] : []),
    ...agentPaths,
  ];
}

/**
 * Returns the stable warning emitted by ordinary builds. The function only
 * reads `.gitignore`; callers decide whether and when to print the diagnostic.
 */
export function missingGitignoreDiagnostics(
  directory: string,
  required: readonly string[],
  fileSystem: GitignoreFileSystem = defaultGitignoreFileSystem,
): Diagnostic[] {
  const path = join(directory, ".gitignore");
  const current = snapshotGitignore(path, fileSystem);
  const present = new Set(
    (current.contents ?? "").split(/\r?\n/).map((line) => line.trim()),
  );
  const missing = uniqueEntries(required).filter(
    (entry) => !present.has(entry),
  );
  if (missing.length === 0) return [];
  return [
    warning(
      "missing-gitignore",
      "default Atlante outputs are not fully covered by .gitignore",
      {
        source: ".gitignore",
        expected: missing.join(", "),
        next: "add the listed entries to .gitignore; ordinary `atlante build` never edits that file",
      },
    ),
  ];
}

/** Prepares the init reconciliation for the ownership-scoped policy. */
export function prepareInitGitignore(
  directory: string,
  document: AnyAtlanteDocument,
  fileSystem: GitignoreFileSystem,
): GitignorePlan {
  const required = defaultGitignoreEntries(document);
  const desired = new Set(required);
  const stale = ownedDefaultAgentGitignorePaths(directory, fileSystem).filter(
    (path) => !desired.has(path),
  );
  return prepareGitignore(directory, fileSystem, {
    required,
    removeAgentPaths: stale,
  });
}
