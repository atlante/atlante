import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as entrypoint from "../src/index.js";

test("the single entry exposes exactly the materializer surface", () => {
  expect(Object.keys(entrypoint).sort()).toEqual([
    "OPENCODE_HOST_TARGET",
    "OpenCodeMaterializationError",
    "materializeOpenCode",
    "openCodeMaterializer",
    "planOpenCodeMaterialization",
    "readOpenCodeNative",
  ]);
});

test("the materializer surface keeps its runtime roles", () => {
  expect(typeof entrypoint.materializeOpenCode).toBe("function");
  expect(typeof entrypoint.planOpenCodeMaterialization).toBe("function");
  expect(typeof entrypoint.OpenCodeMaterializationError).toBe("function");
  expect(typeof entrypoint.readOpenCodeNative).toBe("function");
  expect(entrypoint.OPENCODE_HOST_TARGET).toBe("opencode");
  expect(entrypoint.openCodeMaterializer.host).toBe(
    entrypoint.OPENCODE_HOST_TARGET,
  );
  expect(typeof entrypoint.openCodeMaterializer.materialize).toBe("function");
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
    "./config": "./src/config.ts",
    "./dialect": "./src/dialect.ts",
  });
  expect(existsSync(join(packageRoot, "src", "index.ts"))).toBe(true);
});
