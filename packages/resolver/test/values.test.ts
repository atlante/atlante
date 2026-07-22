import { describe, expect, test } from "bun:test";
import { mergeValues } from "../src/index.ts";

describe("mergeValues", () => {
  test("returns global values when there are no overrides", () => {
    expect(mergeValues({ project: "a" }, undefined)).toEqual({ project: "a" });
  });

  test("returns local values when there are no globals", () => {
    expect(mergeValues(undefined, { project: "b" })).toEqual({ project: "b" });
  });

  test("replaces a global value with the local one for the same key", () => {
    expect(mergeValues({ project: "a", lang: "it" }, { project: "b" })).toEqual(
      {
        project: "b",
        lang: "it",
      },
    );
  });

  test("does not mutate its inputs", () => {
    const global = { project: "a" };
    mergeValues(global, { project: "b" });
    expect(global).toEqual({ project: "a" });
  });
});
