import { describe, expect, test } from "vitest";
import {
  analyzeValueReferences,
  isValidValueKey,
  walkValueReferences,
} from "../src/index.js";

describe("value reference analysis", () => {
  test("finds supported values references and ignores unrelated tokens", () => {
    expect(
      analyzeValueReferences(
        "{{values.project}} {{variableName}} {{values.lang}}",
      ),
    ).toMatchObject([
      { expression: "values.project", key: "project", start: 0, end: 18 },
      { expression: "values.lang", key: "lang", start: 36, end: 51 },
    ]);
  });

  test("reports values-like expressions that use unsupported syntax", () => {
    const references = analyzeValueReferences(
      "{{values[project]}} {{ values . project }} {{values}}",
    );

    expect(
      references.map(({ expression, key }) => ({ expression, key })),
    ).toEqual([
      { expression: "values[project]", key: undefined },
      { expression: "values . project", key: undefined },
      { expression: "values", key: undefined },
    ]);
  });

  test("does not treat values-prefixed names or unbalanced expressions as references", () => {
    expect(
      analyzeValueReferences("{{valuesProject}} {{values.project}"),
    ).toEqual([]);
  });

  test("walks string values and object keys with their paths", () => {
    const visits: Array<{ expression: string; path: (string | number)[] }> = [];

    walkValueReferences(
      {
        "{{values.project}}": ["{{values.lang}}"],
        nested: { value: "{{values.project}}" },
      },
      ({ expression }, path) => visits.push({ expression, path }),
    );

    expect(visits).toEqual([
      { expression: "values.project", path: [] },
      { expression: "values.lang", path: ["{{values.project}}", 0] },
      { expression: "values.project", path: ["nested", "value"] },
    ]);
  });

  test("validates flat value keys", () => {
    expect(isValidValueKey("project")).toBe(true);
    expect(isValidValueKey("project-name")).toBe(true);
    expect(isValidValueKey("$project_2")).toBe(true);
    expect(isValidValueKey("project.name")).toBe(false);
    expect(isValidValueKey("project name")).toBe(false);
    expect(isValidValueKey("2project")).toBe(false);
  });
});
