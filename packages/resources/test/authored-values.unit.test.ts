import { describe, expect, test } from "bun:test";
import { authoredValueLayerIssues } from "../src/index.js";

describe("authored value layer validation", () => {
  test("accepts an omitted values map", () => {
    expect(authoredValueLayerIssues({}, { kind: "instance" })).toEqual([]);
  });

  test("reports an invalid root map with its location", () => {
    expect(
      authoredValueLayerIssues(
        { values: ["not", "an", "object"] },
        {
          kind: "instance",
          locations: { "/values": { line: 4, column: 7 } },
        },
      ),
    ).toEqual([
      {
        code: "invalid-resolved-input",
        message: "binding values must be a JSON object",
        pointer: "/values",
        location: { line: 4, column: 7 },
      },
    ]);
  });

  test("reports invalid names, non-string values, and escaped pointers", () => {
    expect(
      authoredValueLayerIssues(
        {
          values: {
            "bad/name~part": 42,
            "also bad": false,
            good: 42,
          },
        },
        { kind: "instance" },
      ),
    ).toEqual([
      {
        code: "invalid-value-reference",
        message:
          'binding value name "also bad" must match [A-Za-z_$][A-Za-z0-9_$-]*',
        pointer: "/values/also bad",
      },
      {
        code: "invalid-value-reference",
        message:
          'binding value name "bad/name~part" must match [A-Za-z_$][A-Za-z0-9_$-]*',
        pointer: "/values/bad~1name~0part",
      },
      {
        code: "non-string-value",
        message:
          'binding value "good" must be a string or null (SPECIFICATION.md, Configuration Document)',
        pointer: "/values/good",
      },
    ]);
  });

  test("validates preset values and nested agent and skill bindings", () => {
    expect(
      authoredValueLayerIssues(
        {
          values: { presetValue: 1 },
          agents: {
            valid: { values: { agentValue: false } },
            invalid: { values: { "agent/name": null } },
            ignored: "not a binding",
          },
          skills: {
            invalid: { values: "not a map" },
            ignored: [],
          },
        },
        { kind: "preset", bindingKeys: ["agents", "skills"] },
      ),
    ).toEqual([
      {
        code: "invalid-value-reference",
        message:
          'binding value name "agent/name" must match [A-Za-z_$][A-Za-z0-9_$-]*',
        pointer: "/agents/invalid/values/agent~1name",
      },
      {
        code: "non-string-value",
        message:
          'binding value "agentValue" must be a string or null (SPECIFICATION.md, Configuration Document)',
        pointer: "/agents/valid/values/agentValue",
      },
      {
        code: "invalid-resolved-input",
        message: "binding values must be a JSON object",
        pointer: "/skills/invalid/values",
      },
      {
        code: "non-string-value",
        message:
          'preset value "presetValue" must be a string or null (SPECIFICATION.md, Configuration Document)',
        pointer: "/values/presetValue",
      },
    ]);
  });

  test("sorts preset issues by pointer and then code", () => {
    const issues = authoredValueLayerIssues(
      {
        agents: {
          z: { values: { bad: 1 } },
          a: { values: { bad: 1 } },
        },
        values: { bad: 1 },
      },
      { kind: "preset", bindingKeys: ["agents", "skills"] },
    );

    expect(issues.map(({ pointer }) => pointer)).toEqual([
      "/agents/a/values/bad",
      "/agents/z/values/bad",
      "/values/bad",
    ]);
  });
});
