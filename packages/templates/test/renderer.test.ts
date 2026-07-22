import { describe, expect, test } from "bun:test";
import {
  InvalidValueReferenceError,
  interpolateValues,
  loadTemplates,
  MissingValueError,
  NonStringValueError,
  renderTemplate,
} from "../src/index.ts";
import type { TemplateRegistry } from "../src/loader.ts";
import type { TemplateManifest } from "../src/manifest.ts";

const root = new URL("./fixtures/composed", import.meta.url).pathname;
const cyclicRoot = new URL("./fixtures/cyclic", import.meta.url).pathname;

function render(input: Record<string, unknown>): string {
  const { registry } = loadTemplates(root);
  return renderTemplate({
    registry,
    templateId: "test/outer",
    input,
  });
}

/** Builds a one-off in-memory registry for a single inline template source. */
function registryOf(source: string): TemplateRegistry {
  const manifest: TemplateManifest = {
    $schema: "https://atlante.sh/schema/template/v0.1/schema.json",
    id: "test/probe",
    inputSchema: { type: "object", properties: {} },
  };
  return {
    get: (id) =>
      id === "test/probe"
        ? { manifest, source, directory: "<memory>" }
        : undefined,
    ids: () => ["test/probe"],
  };
}

describe("renderTemplate", () => {
  test("renders template input into the output", () => {
    const output = render({ title: "Report" });
    expect(output).toContain("# Report");
  });

  test("renders a slot's child with the slot's own input", () => {
    const output = render({ title: "Report", detail: { body: "ok" } });
    expect(output).toContain("Detail: ok");
  });

  test("omits the slot section when the slot input is absent", () => {
    const output = render({ title: "Report" });
    expect(output).not.toContain("Detail:");
  });

  test("does not HTML-escape prompt content", () => {
    const output = render({ title: `He said "no" & left` });
    expect(output).toContain(`He said "no" & left`);
  });

  test("is deterministic across repeated renders", () => {
    const input = { title: "Report", detail: { body: "ok" } };
    expect(render(input)).toBe(render(input));
  });

  test("throws a clear error instead of a RangeError on a cyclic composition", () => {
    const { registry } = loadTemplates(cyclicRoot);
    const input = { child: { child: {} } };
    expect(() =>
      renderTemplate({ registry, templateId: "test/a", input }),
    ).toThrow("circular template composition: test/a -> test/b -> test/a");
  });

  test("does not give templates access to the values dictionary", () => {
    const registry = registryOf("[{{values.project}}]");
    const output = renderTemplate({
      registry,
      templateId: "test/probe",
      input: {},
    });
    expect(output).toBe("[]");
  });
});

describe("interpolateValues", () => {
  const values = { project: "atlante", lang: "it" };

  test("resolves a values reference inside a string", () => {
    expect(interpolateValues("for {{values.project}}", values)).toBe(
      "for atlante",
    );
  });

  test("resolves a hyphenated flat value key", () => {
    expect(
      interpolateValues("for {{values.project-name}}", {
        "project-name": "atlante",
      }),
    ).toBe("for atlante");
  });

  test("walks nested objects and arrays", () => {
    expect(
      interpolateValues(
        { a: ["{{values.project}}"], b: { c: "{{values.lang}}" } },
        values,
      ),
    ).toEqual({ a: ["atlante"], b: { c: "it" } });
  });

  test("leaves strings without references untouched", () => {
    expect(interpolateValues("plain", values)).toBe("plain");
  });

  test("leaves non-string leaves untouched", () => {
    expect(interpolateValues({ n: 1, b: true, z: null }, values)).toEqual({
      n: 1,
      b: true,
      z: null,
    });
  });

  test("rejects an unknown key instead of silently using an empty string", () => {
    expect(() => interpolateValues("[{{values.nope}}]", values)).toThrow(
      MissingValueError,
    );
    expect(() => interpolateValues("[{{values.nope}}]", values)).toThrow(
      /values\.nope/,
    );
    expect(() => interpolateValues("{{values.toString}}", values)).toThrow(
      MissingValueError,
    );
    expect(() => interpolateValues("{{values.project.name}}", values)).toThrow(
      InvalidValueReferenceError,
    );
  });

  test("preserves values-dictionary enumeration syntax verbatim, without leaking values", () => {
    const secrets = { project: "atlante", apiKey: "sk-SECRET-123" };
    const source = "{{#each values}}{{@key}}={{this}} {{/each}}";
    expect(interpolateValues(source, secrets)).toBe(source);
  });

  test("preserves unrelated {{variableName}} prose verbatim", () => {
    const source = "Use {{variableName}} to format.";
    expect(interpolateValues(source, values)).toBe(source);
  });

  test("preserves an unbalanced {{#if}} block verbatim without throwing", () => {
    const source = "Docs: {{#if x}} opens a block";
    expect(() => interpolateValues(source, values)).not.toThrow();
    expect(interpolateValues(source, values)).toBe(source);
  });

  // @atlante/schema restricts `values` to strings (SPECIFICATION.md §4.2), so
  // an array or object here can only occur in a document assembled by hand
  // that bypassed that validation. This guard is defence-in-depth for that
  // case, exactly like the cycle guard in `renderTemplate`.
  test("throws NonStringValueError instead of comma-joining an array value", () => {
    const withArray = { list: ["one", "two"] };
    expect(() => interpolateValues("{{values.list}}", withArray)).toThrow(
      NonStringValueError,
    );
  });

  test("throws NonStringValueError instead of stringifying an object value", () => {
    const withObject = { config: { a: 1 } };
    expect(() => interpolateValues("{{values.config}}", withObject)).toThrow(
      NonStringValueError,
    );
  });

  test("NonStringValueError names the offending path and resolved type", () => {
    const withArray = { list: ["one", "two"] };
    expect(() => interpolateValues("{{values.list}}", withArray)).toThrow(
      /values\.list.*object/,
    );
  });
});
