import { join } from "node:path";

/** OpenCode's project configuration precedence, highest priority first. */
export const OPEN_CODE_CONFIG_RELATIVE_PATHS = [
  join(".opencode", "opencode.jsonc"),
  join(".opencode", "opencode.json"),
  "opencode.jsonc",
  "opencode.json",
] as const;

export function openCodeConfigPaths(root: string): string[] {
  return OPEN_CODE_CONFIG_RELATIVE_PATHS.map((path) => join(root, path));
}
