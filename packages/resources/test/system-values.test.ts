import { basename } from "node:path";
import { describe, expect, test } from "vitest";
import {
  resolveSystemValues,
  SYSTEM_RESOLVERS,
  UnknownSystemVariableError,
} from "../src/index.js";

describe("resource system values", () => {
  test("substitutes cwd.basename in one value", () => {
    const result = resolveSystemValues({ project: "{{sys.cwd.basename}}" });

    expect(result.project).toBe(basename(process.cwd()));
  });

  test("substitutes multiple references in one value", () => {
    const result = resolveSystemValues({
      label: "{{sys.cwd.basename}}/{{sys.cwd.basename}}",
    });

    expect(result.label).toBe(
      `${basename(process.cwd())}/${basename(process.cwd())}`,
    );
  });

  test("substitutes references across multiple keys", () => {
    const result = resolveSystemValues({
      a: "{{sys.cwd.basename}}",
      b: "{{sys.cwd.basename}}",
    });

    expect(result.a).toBe(basename(process.cwd()));
    expect(result.b).toBe(basename(process.cwd()));
  });

  test("leaves non-system references untouched", () => {
    const values = {
      identity: "You work on {{values.project}}.",
      template: "{{#if workflow}}\nsteps\n{{/if}}",
      prose: "use {{this}} syntax",
    };

    const result = resolveSystemValues(values);

    expect(result.identity).toBe(values.identity);
    expect(result.template).toBe(values.template);
    expect(result.prose).toBe(values.prose);
  });

  test("leaves strings without references untouched", () => {
    const values = {
      scopeRule: "Never modify files outside the reviewed diff.",
    };

    expect(resolveSystemValues(values).scopeRule).toBe(values.scopeRule);
  });

  test("passes non-string values through unchanged", () => {
    const values = { count: 42, flag: true, nested: { x: 1 } };

    expect(resolveSystemValues(values)).toEqual(values);
  });

  test("handles an empty values map", () => {
    expect(Object.keys(resolveSystemValues({}))).toEqual([]);
  });

  test("does not mutate the input map", () => {
    const values = { project: "{{sys.cwd.basename}}" };
    const before = JSON.stringify(values);

    resolveSystemValues(values);

    expect(JSON.stringify(values)).toBe(before);
  });

  test("rejects unknown system variables", () => {
    const values = { project: "{{sys.nonexistent}}" };

    expect(() => resolveSystemValues(values)).toThrow(
      UnknownSystemVariableError,
    );
    expect(() => resolveSystemValues(values)).toThrow(
      'unknown system variable "{{sys.nonexistent}}"',
    );
  });

  test("rejects inherited resolver properties without throwing", () => {
    for (const key of ["constructor", "toString", "__proto__"]) {
      expect(() => resolveSystemValues({ value: `{{sys.${key}}}` })).toThrow(
        new UnknownSystemVariableError(key),
      );
    }
  });
});

describe("SYSTEM_RESOLVERS", () => {
  test("cwd.basename uses process.cwd()", () => {
    const resolver = SYSTEM_RESOLVERS["cwd.basename"];
    if (!resolver) throw new Error("cwd.basename resolver missing");

    expect(resolver()).toBe(basename(process.cwd()));
  });
});
