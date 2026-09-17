import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as entrypoint from "../src/index.js";

test("the single entry exposes exactly the materializer surface", () => {
  expect(Object.keys(entrypoint).sort()).toEqual([
    "CLAUDE_CODE_HOST_TARGET",
    "ClaudeCodeMaterializationError",
    "claudeCodeMaterializer",
    "materializeClaudeCode",
    "planClaudeCodeMaterialization",
    "readClaudeCodeNative",
  ]);
});

test("the materializer surface keeps its runtime roles", () => {
  expect(typeof entrypoint.materializeClaudeCode).toBe("function");
  expect(typeof entrypoint.planClaudeCodeMaterialization).toBe("function");
  expect(typeof entrypoint.ClaudeCodeMaterializationError).toBe("function");
  expect(typeof entrypoint.readClaudeCodeNative).toBe("function");
  expect(entrypoint.CLAUDE_CODE_HOST_TARGET).toBe("claude-code");
  expect(entrypoint.claudeCodeMaterializer.host).toBe(
    entrypoint.CLAUDE_CODE_HOST_TARGET,
  );
  expect(typeof entrypoint.claudeCodeMaterializer.materialize).toBe("function");
});

// The manifest resolves workspace imports from src — like every other
// private package — so test processes never load a stale dist. dist/ remains
// a produced artifact for the CLI bundle; its contract is owned by
// dist.test.ts.
test("the workspace manifest resolves its entry from src", () => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as {
    main?: string;
    exports?: Record<string, string>;
  };

  expect(manifest.main).toBeUndefined();
  expect(manifest.exports).toEqual({
    ".": "./src/index.ts",
  });
  expect(existsSync(join(packageRoot, "src", "index.ts"))).toBe(true);
});
