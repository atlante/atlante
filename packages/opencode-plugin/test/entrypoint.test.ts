import { expect, test } from "bun:test";
import * as entrypoint from "../src/index.js";

test("the package root exposes exactly one plugin factory", () => {
  const functions = Object.values(entrypoint).filter(
    (value) => typeof value === "function",
  );

  expect(functions).toHaveLength(1);
  expect(functions[0]).toBe(entrypoint.default);
});
