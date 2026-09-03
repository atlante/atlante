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
  ]);
});

test("the materializer surface keeps its runtime roles", () => {
  expect(typeof entrypoint.materializeOpenCode).toBe("function");
  expect(typeof entrypoint.OpenCodeMaterializationError).toBe("function");
  expect(entrypoint.OPENCODE_HOST_TARGET).toBe("opencode");
  expect(entrypoint.openCodeMaterializer.host).toBe(
    entrypoint.OPENCODE_HOST_TARGET,
  );
  expect(typeof entrypoint.openCodeMaterializer.materialize).toBe("function");
});

// The published package ships dist/ only: the manifest's main and the single
// "." export must point at files the build produces, or a packed tarball
// would expose an entry that cannot resolve.
test("the package manifest resolves its published entry into dist", () => {
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const manifest = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  ) as {
    main?: string;
    exports?: Record<string, { types?: string; default?: string }>;
  };

  expect(manifest.main).toBe("dist/index.js");
  expect(manifest.exports).toEqual({
    ".": {
      types: "./dist/index.d.ts",
      default: "./dist/index.js",
    },
  });
  for (const relative of [
    manifest.main,
    manifest.exports?.["."]?.types,
    manifest.exports?.["."]?.default,
  ]) {
    if (!relative) continue;
    expect(existsSync(join(packageRoot, relative)), relative).toBe(true);
  }
});
