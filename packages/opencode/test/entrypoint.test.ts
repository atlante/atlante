import { expect, test } from "bun:test";
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
