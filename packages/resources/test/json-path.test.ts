import { describe, expect, test } from "vitest";
import { jsonValueAtPath } from "../src/index.js";

describe("JSON path traversal", () => {
  test("reads object properties and numeric array indexes only", () => {
    const value = {
      object: { value: "nested" },
      array: [{ value: "first" }, { value: "second" }],
    };

    expect(jsonValueAtPath<string>(value, ["object", "value"])).toBe("nested");
    expect(jsonValueAtPath<string>(value, ["array", "1", "value"])).toBe(
      "second",
    );
    expect(jsonValueAtPath(value, ["array", "not-an-index"])).toBeUndefined();
    expect(jsonValueAtPath(value, ["missing"])).toBeUndefined();
  });
});
