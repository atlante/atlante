import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("claude smoke exercises the pinned host and the claude-code native outputs", () => {
  const smoke = readFileSync(join(ROOT, "scripts", "claude-smoke.ts"), "utf8");

  // Pinned host with a documented bump policy, not a floating latest.
  expect(smoke).toContain("2.1.218");
  expect(smoke).toContain("CLAUDE_PACKAGE_VERSION");
  // v0.2 document selecting only the claude-code host.
  expect(smoke).toContain("https://atlante.sh/schema/v0.2/schema.json");
  expect(smoke).toContain('"claude-code"');
  // Native output contract: manifest, agent/skill paths, frontmatter, body.
  expect(smoke).toContain("claude-code-native.json");
  expect(smoke).toContain("atlante-claude-code-native");
  expect(smoke).toContain(".claude/agents/");
  expect(smoke).toContain("SKILL.md");
  expect(smoke).toContain("sha256");
  expect(smoke).toContain("manifest.format");
  expect(smoke).toContain("frontmatter");
  // Host-owned settings stay host-owned: the build must not author them.
  expect(smoke).toContain(".claude/settings.json");
  // Credential-free host health plus an idempotent rebuild.
  expect(smoke).toContain("doctor");
  expect(smoke).toContain("second build");
  // No authentication and no model spend in this script.
  expect(smoke).not.toContain("ANTHROPIC_API_KEY");
  expect(smoke).not.toContain('"--print"');
  expect(smoke).not.toContain('"-p"');
});
