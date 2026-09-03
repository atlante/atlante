import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("smoke test exercises the installed static pack and global-style CLI", () => {
  const smoke = readFileSync(join(ROOT, "scripts", "smoke-test.ts"), "utf8");

  expect(smoke).toContain("@atlante/pack");
  expect(smoke).toContain("node_modules");
  expect(smoke).toContain("!opencode.includes");
  expect(smoke).toContain("opencode-native.json");
  expect(smoke).toContain("manifest.format");
  expect(smoke).toContain("sha256");
  expect(smoke).toContain("rootManifest");
});
