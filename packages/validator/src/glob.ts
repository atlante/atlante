import { type Dirent, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * Minimal glob support for scenario discovery: `*` matches within one path
 * segment, `**` matches zero or more whole segments, `?` matches one
 * non-separator character. Everything else is literal. Kept dependency-free
 * because the CLI bundle must stay self-contained.
 */
export function globHasMagic(pattern: string): boolean {
  return /[*?]/.test(pattern);
}

function segmentToRegexSource(segment: string): string {
  let source = "";
  for (const character of segment) {
    if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += character.replaceAll(/[\\^$.+{}()[\]|]/g, "\\$&");
  }
  return source;
}

/** Compiles a relative glob pattern into a whole-path regular expression. */
export function globToRegExp(pattern: string): RegExp {
  const segments = pattern.split("/");
  let source = "^";
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] ?? "";
    if (segment === "**") {
      source +=
        index === segments.length - 1 ? "(?:[^/]+(?:/|$))*" : "(?:[^/]+/)*";
      continue;
    }
    source += segmentToRegexSource(segment);
    if (index < segments.length - 1) source += "/";
  }
  source += "$";
  return new RegExp(source);
}

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

function collectFiles(root: string, prefix: string, files: string[]): void {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(root, { withFileTypes: true, encoding: "utf8" });
  } catch {
    return;
  }
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      collectFiles(join(root, entry.name), relative, files);
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
}

/**
 * Matches files under `root` against a project-root-relative glob pattern.
 * Returns matched paths (forward-slash separated, relative to root), sorted.
 * The `.git` and `node_modules` directories are never traversed.
 */
export function globFiles(root: string, pattern: string): string[] {
  const normalized = pattern.replaceAll(sep, "/");
  const files: string[] = [];
  if (globHasMagic(normalized)) {
    const regex = globToRegExp(normalized);
    collectFiles(root, "", files);
    return files.filter((file) => regex.test(file)).sort();
  }
  // Literal pattern: keep it only when it names an existing regular file.
  try {
    if (statSync(join(root, normalized), { throwIfNoEntry: false })?.isFile())
      return [normalized].sort();
  } catch {
    // Fall through to the empty match set below.
  }
  return [];
}
