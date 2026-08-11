import { describe, expect, test } from "bun:test";
import {
  JsoncParseError,
  parseJsoncWithLocations,
  parseJsonWithLocations,
} from "../src/index.js";

describe("JSONC parsing", () => {
  test("collects root, nested, and array locations", () => {
    const source = `{
  "name": "root",
  "nested": {
    "enabled": true,
    "items": [
      "first",
      { "value": 2 }
    ]
  }
}`;

    expect(parseJsoncWithLocations(source)).toEqual({
      value: {
        name: "root",
        nested: {
          enabled: true,
          items: ["first", { value: 2 }],
        },
      },
      locations: {
        "": { line: 1, column: 1 },
        "/name": { line: 2, column: 11 },
        "/nested": { line: 3, column: 13 },
        "/nested/enabled": { line: 4, column: 16 },
        "/nested/items": { line: 5, column: 14 },
        "/nested/items/0": { line: 6, column: 7 },
        "/nested/items/1": { line: 7, column: 7 },
        "/nested/items/1/value": { line: 7, column: 18 },
      },
    });
  });

  test("keeps locations in JavaScript code-unit offsets", () => {
    const source = '{"emoji": "😀", "after": 1}';

    expect(parseJsoncWithLocations(source).locations).toEqual({
      "": { line: 1, column: 1 },
      "/emoji": { line: 1, column: 11 },
      "/after": { line: 1, column: 26 },
    });
  });

  test("reports the parser offset and location for malformed input", () => {
    const source = `{
  "ok": true,
  "broken":
}
`;

    try {
      parseJsoncWithLocations(source);
      throw new Error("expected malformed JSONC");
    } catch (error) {
      expect(error).toBeInstanceOf(JsoncParseError);
      if (!(error instanceof JsoncParseError)) return;
      expect(error.name).toBe("JsoncParseError");
      expect(error.message).toBe("selected JSONC is malformed");
      expect(error.offset).toBe(source.indexOf("}"));
      expect(error.location).toEqual({ line: 4, column: 1 });
    }
  });

  test("keeps one-based positions across CRLF input", () => {
    const source = '{\r\n  "nested": {\r\n    "value": 1\r\n  }\r\n}\r\n';

    expect(parseJsoncWithLocations(source).locations).toEqual({
      "": { line: 1, column: 1 },
      "/nested": { line: 2, column: 13 },
      "/nested/value": { line: 3, column: 14 },
    });
  });

  test("accepts comments and trailing commas in JSONC", () => {
    const source = `{
  // comments are valid in JSONC
  "value": 1,
}`;

    expect(parseJsoncWithLocations(source)).toEqual({
      value: { value: 1 },
      locations: {
        "": { line: 1, column: 1 },
        "/value": { line: 3, column: 12 },
      },
    });
  });

  test("keeps strict JSON behavior for comments and trailing commas", () => {
    for (const source of [
      `{
  // comments are not valid in strict JSON
  "value": 1
}`,
      '{"value": 1,}',
    ]) {
      expect(() => parseJsonWithLocations(source)).toThrow(JsoncParseError);
    }
  });
});
