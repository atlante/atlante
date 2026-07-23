import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import {
  resolveSystemValues,
  SYSTEM_RESOLVERS,
  UnknownSystemVariableError,
} from "@atlante/templates";

describe("resolveSystemValues", () => {
  test("substitutes {{sys.cwd.basename}} with the actual cwd basename", () => {
    const values = { project: "{{sys.cwd.basename}}" };
    const result = resolveSystemValues(values);
    expect(result.project).toBe(basename(process.cwd()));
  });

  test("substitutes multiple {{sys.*}} references in a single value", () => {
    const values = { label: "{{sys.cwd.basename}}/{{sys.cwd.basename}}" };
    const result = resolveSystemValues(values);
    const expected = `${basename(process.cwd())}/${basename(process.cwd())}`;
    expect(result.label).toBe(expected);
  });

  test("substitutes references across multiple keys", () => {
    const values = { a: "{{sys.cwd.basename}}", b: "{{sys.cwd.basename}}" };
    const result = resolveSystemValues(values);
    expect(result.a).toBe(basename(process.cwd()));
    expect(result.b).toBe(basename(process.cwd()));
  });

  test("leaves non-sys {{...}} references untouched", () => {
    const values = {
      identity: "You work on {{values.project}}.",
      template: "{{#if workflow}}\nsteps\n{{/if}}",
      prose: "use {{this}} syntax",
    };
    const result = resolveSystemValues(values);
    expect(result.identity).toBe("You work on {{values.project}}.");
    expect(result.template).toBe("{{#if workflow}}\nsteps\n{{/if}}");
    expect(result.prose).toBe("use {{this}} syntax");
  });

  test("leaves strings without references untouched", () => {
    const values = {
      scopeRule: "Never modify files outside the reviewed diff.",
    };
    const result = resolveSystemValues(values);
    expect(result.scopeRule).toBe(values.scopeRule);
  });

  test("passes non-string values through unchanged", () => {
    const values = { count: 42, flag: true, nested: { x: 1 } };
    const result = resolveSystemValues(values);
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
    expect(result.nested).toEqual({ x: 1 });
  });

  test("handles an empty values map", () => {
    const result = resolveSystemValues({});
    expect(Object.keys(result)).toEqual([]);
  });

  test("does not mutate the input map", () => {
    const values: Record<string, unknown> = { project: "{{sys.cwd.basename}}" };
    const snapshot = JSON.stringify(values);
    resolveSystemValues(values);
    expect(JSON.stringify(values)).toBe(snapshot);
  });

  test("throws UnknownSystemVariableError for an unknown key", () => {
    const values = { project: "{{sys.nonexistent}}" };
    expect(() => resolveSystemValues(values)).toThrow(
      UnknownSystemVariableError,
    );
    expect(() => resolveSystemValues(values)).toThrow(
      'unknown system variable "{{sys.nonexistent}}"',
    );
  });
});

describe("SYSTEM_RESOLVERS", () => {
  test("cwd.basename uses process.cwd()", () => {
    const real = basename(process.cwd());
    const resolver = SYSTEM_RESOLVERS["cwd.basename"];
    if (!resolver) throw new Error("cwd.basename resolver missing");
    expect(resolver()).toBe(real);
  });
});
