import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ResourceFailureCode } from "../src/index.js";
import {
  createProjectResourcePack,
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
  ResourceResolutionError,
} from "../src/index.js";

const created: string[] = [];

function fixture(): { root: string; source: string; resource: string } {
  const root = mkdtempSync(join(tmpdir(), "atlante-facets-"));
  created.push(root);
  const source = join(root, "source.jsonc");
  const resource = join(root, "resource");
  mkdirSync(resource);
  writeFileSync(source, "{}\n");
  return { root, source, resource };
}

function expectFailure(
  action: () => unknown,
  code: ResourceFailureCode,
): ResourceResolutionError {
  try {
    action();
    throw new Error("expected resource loading to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceResolutionError);
    if (error instanceof ResourceResolutionError) {
      expect(error.failure.code).toBe(code);
      return error;
    }
    throw error;
  }
}

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("selected resource facets", () => {
  test("loads template.jsonc with comments and trailing commas", () => {
    const { root, source, resource } = fixture();
    writeFileSync(
      join(resource, "template.jsonc"),
      '{\n  // selected facet only\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "type": "object",\n}\n',
    );
    writeFileSync(join(resource, "template.md"), "# Hello\n");
    const loaded = loadTemplateFacet(
      createProjectResourcePack(root),
      "./resource",
      source,
    );

    expect(loaded.facet.kind).toBe("template");
    expect(loaded.facet.inputSchema).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    });
    expect(loaded.facet.source).toBe("# Hello\n");
  });

  test("loads exact instance and preset facets", () => {
    const { root, source, resource } = fixture();
    writeFileSync(
      join(resource, "instance.jsonc"),
      '{\n  "name": "value",\n}\n',
    );
    const preset = join(root, "preset");
    mkdirSync(preset);
    writeFileSync(
      join(preset, "atlante.json"),
      '{ "extends": "./resource" }\n',
    );
    const pack = createProjectResourcePack(root);

    expect(loadInstanceFacet(pack, "./resource", source).facet).toMatchObject({
      kind: "instance",
      input: { name: "value" },
    });
    expect(loadPresetFacet(pack, "./preset", source).facet).toMatchObject({
      kind: "preset",
      document: { extends: "./resource" },
    });
  });

  test("accepts JSONC only for atlante.jsonc and rejects it for atlante.json", () => {
    const { root, source } = fixture();
    const pack = createProjectResourcePack(root);
    const strictCases = [
      ["comment", '{\n  // not strict JSON\n  "value": true\n}\n'],
      ["trailing-comma", '{\n  "value": true,\n}\n'],
    ] as const;

    for (const [name, document] of strictCases) {
      const directory = join(root, `strict-${name}`);
      mkdirSync(directory);
      writeFileSync(join(directory, "atlante.json"), document);
      expectFailure(
        () => loadPresetFacet(pack, `./strict-${name}`, source),
        "malformed-jsonc",
      );
    }

    const jsoncDirectory = join(root, "jsonc-preset");
    mkdirSync(jsoncDirectory);
    writeFileSync(
      join(jsoncDirectory, "atlante.jsonc"),
      '{\n  // JSONC is allowed for this filename\n  "value": true,\n}\n',
    );
    expect(
      loadPresetFacet(pack, "./jsonc-preset", source).facet.document,
    ).toEqual({ value: true });
  });

  test("does not read malformed unrelated siblings", () => {
    const { root, source, resource } = fixture();
    writeFileSync(
      join(resource, "template.jsonc"),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema" }\n',
    );
    writeFileSync(join(resource, "template.md"), "valid\n");
    const sibling = join(root, "malformed");
    mkdirSync(sibling);
    writeFileSync(join(sibling, "template.jsonc"), "{ not JSONC");
    writeFileSync(join(sibling, "template.md"), "not selected\n");

    const loaded = loadTemplateFacet(
      createProjectResourcePack(root),
      "./resource",
      source,
    );
    expect(loaded.facet.source).toBe("valid\n");
  });

  test("isolates facet data and returns stable project-relative origins", () => {
    const { root, source, resource } = fixture();
    writeFileSync(
      join(resource, "template.jsonc"),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "properties": { "name": { "type": "string" } } }\n',
    );
    writeFileSync(join(resource, "template.md"), "Hello\n");
    const pack = createProjectResourcePack(root);
    const first = loadTemplateFacet(pack, "./resource", source).facet;
    const second = loadTemplateFacet(pack, "./resource", source).facet;

    expect(first).not.toBe(second);
    expect(first.origin.kind).toBe("project");
    expect(first.origin.path as string).toBe("resource/template.jsonc");
    expect(first.inputSchema).not.toBe(second.inputSchema);
    expect(Object.isFrozen(first.inputSchema)).toBe(true);
    expect(
      (second.inputSchema.properties as { name: { type: string } }).name.type,
    ).toBe("string");
    expect(loadTemplateFacet(pack, "./resource", source).dependencies).toEqual([
      join(pack.root, "resource", "template.jsonc"),
      join(pack.root, "resource", "template.md"),
    ]);
  });

  test("reloads changed and removed selected files", () => {
    const { root, source, resource } = fixture();
    const schemaPath = join(resource, "template.jsonc");
    const markdownPath = join(resource, "template.md");
    writeFileSync(
      schemaPath,
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "string" }\n',
    );
    writeFileSync(markdownPath, "first\n");
    const pack = createProjectResourcePack(root);

    expect(loadTemplateFacet(pack, "./resource", source).facet.source).toBe(
      "first\n",
    );
    writeFileSync(
      schemaPath,
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "number" }\n',
    );
    writeFileSync(markdownPath, "second\n");

    const reloaded = loadTemplateFacet(pack, "./resource", source).facet;
    expect(reloaded.source).toBe("second\n");
    expect(reloaded.inputSchema.type).toBe("number");

    rmSync(markdownPath);
    expectFailure(
      () => loadTemplateFacet(pack, "./resource", source),
      "missing-target",
    );
  });

  test("rechecks preset filename ambiguity after the first load", () => {
    const { root, source } = fixture();
    const preset = join(root, "preset");
    mkdirSync(preset);
    writeFileSync(join(preset, "atlante.json"), '{ "value": true }\n');
    const pack = createProjectResourcePack(root);

    expect(loadPresetFacet(pack, "./preset", source).facet.document).toEqual({
      value: true,
    });
    writeFileSync(join(preset, "atlante.jsonc"), '{ "value": false }\n');

    expectFailure(
      () => loadPresetFacet(pack, "./preset", source),
      "ambiguous-facet",
    );
  });

  test("rejects prototype-shaped template schemas and resource objects", () => {
    const { root, source, resource } = fixture();
    const pack = createProjectResourcePack(root);
    writeFileSync(
      join(resource, "template.jsonc"),
      '{ "__proto__": { "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object" } }\n',
    );
    writeFileSync(join(resource, "template.md"), "source\n");

    expectFailure(
      () => loadTemplateFacet(pack, "./resource", source),
      "invalid-template-schema",
    );

    writeFileSync(
      join(resource, "instance.jsonc"),
      '{ "constructor": { "prototype": { "polluted": true } } }\n',
    );
    expectFailure(
      () => loadInstanceFacet(pack, "./resource", source),
      "invalid-resolved-input",
    );

    const preset = join(root, "preset");
    mkdirSync(preset);
    writeFileSync(
      join(preset, "atlante.jsonc"),
      '{ "prototype": { "constructor": { "prototype": { "polluted": true } } } }\n',
    );
    expectFailure(
      () => loadPresetFacet(pack, "./preset", source),
      "invalid-resolved-input",
    );
  });

  test("reports typed malformed JSONC and invalid template schema failures", () => {
    const { root, source, resource } = fixture();
    writeFileSync(join(resource, "template.jsonc"), "{ not JSONC");
    writeFileSync(join(resource, "template.md"), "source\n");
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () => loadTemplateFacet(pack, "./resource", source),
      "malformed-jsonc",
    );
    expect(failure.dependencies).toEqual(
      [
        join(pack.root, "resource", "template.jsonc"),
        join(pack.root, "resource", "template.md"),
      ].sort(),
    );
    writeFileSync(join(resource, "template.jsonc"), '{ "type": "object" }\n');
    expectFailure(
      () => loadTemplateFacet(pack, "./resource", source),
      "invalid-template-schema",
    );
  });

  test("keeps machine paths out of normal typed failures", () => {
    const { root, source, resource } = fixture();
    writeFileSync(join(resource, "template.jsonc"), "{ not JSONC");
    writeFileSync(join(resource, "template.md"), "source\n");
    const failure = (() => {
      try {
        loadTemplateFacet(
          createProjectResourcePack(root),
          "./resource",
          source,
        );
      } catch (error) {
        if (error instanceof ResourceResolutionError) return error;
      }
      throw new Error("expected resource loading to fail");
    })();

    expect(failure.failure.code).toBe("malformed-jsonc");
    expect(failure.message).not.toContain(root);
    expect(JSON.stringify(failure.failure)).not.toContain(root);
    expect(failure.failure.source?.path as string).toBe(
      "resource/template.jsonc",
    );
  });

  test("retains selected dependencies when a read fails", () => {
    const { root, source, resource } = fixture();
    writeFileSync(
      join(resource, "template.jsonc"),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema" }\n',
    );
    writeFileSync(join(resource, "template.md"), "source\n");
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () =>
        loadTemplateFacet(pack, "./resource", source, {
          beforeRead: () => {
            throw new Error("injected read failure");
          },
        }),
      "wrong-target-type",
    );
    expect(failure.dependencies).toEqual(
      [
        join(pack.root, "resource", "template.jsonc"),
        join(pack.root, "resource", "template.md"),
      ].sort(),
    );
  });

  test("does not expose an external facet symlink target in failure dependencies", () => {
    const { root, source, resource } = fixture();
    const outside = mkdtempSync(join(tmpdir(), "atlante-facets-outside-"));
    created.push(outside);
    writeFileSync(
      join(resource, "template.jsonc"),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema" }\n',
    );
    const outsideSource = join(outside, "template.md");
    writeFileSync(outsideSource, "outside\n");
    const lexicalFile = join(resource, "template.md");
    symlinkSync(outsideSource, lexicalFile, "file");
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () => loadTemplateFacet(pack, "./resource", source),
      "unsafe-path",
    );

    expect(failure.dependencies).toEqual(
      [
        lexicalFile,
        resource,
        join(pack.root, "resource", "template.jsonc"),
      ].sort(),
    );
    expect(failure.dependencies).not.toContain(outsideSource);
    expect(failure.unresolvedParents).toEqual([join(pack.root, "resource")]);
  });

  test("watches both preset candidates when no root facet is available", () => {
    const { root, source } = fixture();
    const preset = join(root, "preset");
    mkdirSync(preset);
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () => loadPresetFacet(pack, "./preset", source),
      "missing-target",
    );

    expect(failure.dependencies).toEqual(
      [join(preset, "atlante.json"), join(preset, "atlante.jsonc")].sort(),
    );
    expect(failure.unresolvedParents).toEqual([`${pack.root}/preset`]);
  });

  test("retains the absent preset candidate when the selected root is malformed", () => {
    const { root, source } = fixture();
    const preset = join(root, "preset");
    mkdirSync(preset);
    writeFileSync(join(preset, "atlante.json"), "{ not JSON }");
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () => loadPresetFacet(pack, "./preset", source),
      "malformed-jsonc",
    );

    expect(failure.dependencies).toEqual(
      [
        join(pack.root, "preset", "atlante.json"),
        join(preset, "atlante.jsonc"),
      ].sort(),
    );
    expect(failure.unresolvedParents).toEqual([join(pack.root, "preset")]);
  });
});
