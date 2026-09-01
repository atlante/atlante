import { describe, expect, mock, test } from "bun:test";
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

  test("preserves UTF-16 offsets after a long astral-character prefix", () => {
    const prefix = "🚀".repeat(10_000);
    const [reference] = analyzeValueReferences(`${prefix}{{values.project}}`);

    expect(reference).toMatchObject({
      expression: "values.project",
      key: "project",
      start: prefix.length,
      end: prefix.length + "{{values.project}}".length,
    });
  });

  test("finds multiple references after an astral-character prefix", () => {
    const prefix = "🧪".repeat(2_000);

    expect(
      analyzeValueReferences(`${prefix}{{values.one}} text {{values.two}}`),
    ).toMatchObject([
      { expression: "values.one", key: "one", start: prefix.length },
      { expression: "values.two", key: "two" },
    ]);
  });

  test("rejects merged value expressions with whitespace and an extra token", () => {
    expect(analyzeValueReferences("{{values.one values.two}}")).toEqual([]);
  });

  test("does not report an unterminated expression", () => {
    expect(analyzeValueReferences("{{values.one")).toEqual([]);
  });

  test("requires delimiters and a complete values expression", () => {
    expect(
      analyzeValueReferences("xvalues.project}} {{values.project trailing}}"),
    ).toMatchObject([
      {
        expression: "values.project trailing",
        key: undefined,
        start: 18,
        end: 45,
      },
    ]);
  });

  test("uses the closing delimiter after the opening delimiter", () => {
    expect(analyzeValueReferences("}}{{values.project}}")).toEqual([
      {
        expression: "values.project",
        key: "project",
        start: 2,
        end: 20,
      },
    ]);
  });

  test("does not rescan nested opening delimiters while advancing", () => {
    expect(analyzeValueReferences("{{values{{project}}")).toEqual([
      {
        expression: "values{{project",
        key: undefined,
        start: 0,
        end: 19,
      },
    ]);
  });

  test("reports unsupported value-key characters without rejecting the reference", () => {
    expect(
      analyzeValueReferences(
        "{{prefix.values.project}} {{values.project.extra}} {{values.project!}}",
      ),
    ).toEqual([
      {
        expression: "values.project.extra",
        key: "project.extra",
        start: 26,
        end: 50,
      },
      {
        expression: "values.project!",
        key: "project!",
        start: 51,
        end: 70,
      },
    ]);
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
    expect(isValidValueKey("2project")).toBe(false);
    expect(isValidValueKey("project/")).toBe(false);
    expect(isValidValueKey("project.name")).toBe(false);
    expect(isValidValueKey("project name")).toBe(false);
  });

  test("does not walk null, primitive, or empty containers", () => {
    const visit = mock();

    walkValueReferences(null, visit);
    walkValueReferences([], visit);
    walkValueReferences({}, visit);

    expect(visit).not.toHaveBeenCalled();
  });
});
