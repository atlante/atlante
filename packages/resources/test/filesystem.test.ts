import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
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
const schema =
  '{\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "type": "object"\n}\n';

function rootOf(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-filesystem-"));
  created.push(root);
  return root;
}

function sourceFile(root: string): string {
  const source = join(root, "source.jsonc");
  writeFileSync(source, "{}\n");
  return source;
}

function resource(root: string, name = "resource"): string {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function expectFailure(
  action: () => unknown,
  code: ResourceFailureCode,
): ResourceResolutionError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceResolutionError);
    if (error instanceof ResourceResolutionError) {
      expect(error.failure.code).toBe(code);
      return error;
    }
  }
  throw new Error("expected resource loading to fail");
}

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("resource filesystem", () => {
  test("requires one directory target and the exact facet files", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const directory = resource(root);
    writeFileSync(join(directory, "template.jsonc"), schema);
    writeFileSync(join(directory, "template.md"), "Hello.\n");
    writeFileSync(join(directory, "instance.jsonc"), '{ "value": true }\n');
    writeFileSync(join(root, "not-a-directory"), "file\n");
    const pack = createProjectResourcePack(root);

    expect(loadTemplateFacet(pack, "./resource", source).facet.kind).toBe(
      "template",
    );
    expect(loadInstanceFacet(pack, "./resource", source).facet.kind).toBe(
      "instance",
    );
    expectFailure(
      () => loadTemplateFacet(pack, "./not-a-directory", source),
      "wrong-target-type",
    );

    const missing = resource(root, "missing");
    writeFileSync(join(missing, "template.jsonc"), schema);
    const missingFailure = expectFailure(
      () => loadTemplateFacet(pack, "./missing", source),
      "missing-target",
    );
    expect(missingFailure.dependencies).toContain(
      join(pack.root, "missing", "template.jsonc"),
    );

    const preset = resource(root, "preset");
    writeFileSync(join(preset, "atlante.jsonc"), "{}\n");
    writeFileSync(join(preset, "atlante.json"), "{}\n");
    const ambiguous = expectFailure(
      () => loadPresetFacet(pack, "./preset", source),
      "ambiguous-facet",
    );
    expect(ambiguous.dependencies).toEqual(
      [
        join(pack.root, "preset", "atlante.json"),
        join(pack.root, "preset", "atlante.jsonc"),
        join(pack.root, "preset"),
      ].sort(),
    );
  });

  test("rejects FIFOs and other non-regular facet files without blocking", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const directory = resource(root);
    writeFileSync(join(directory, "template.jsonc"), schema);
    const fifo = join(directory, "template.md");
    const result = spawnSync("mkfifo", [fifo]);
    expect(result.status).toBe(0);
    expect(lstatSync(fifo).isFIFO()).toBe(true);
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () => loadTemplateFacet(pack, "./resource", source),
      "wrong-target-type",
    );
    expect(failure.dependencies).toEqual(
      [
        fifo,
        join(pack.root, "resource"),
        join(pack.root, "resource", "template.jsonc"),
      ].sort(),
    );
  });

  test("rejects an ancestor symlink swap between preflight and read", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const directory = resource(root);
    writeFileSync(join(directory, "template.jsonc"), schema);
    writeFileSync(join(directory, "template.md"), "safe\n");
    const outside = rootOf();
    const outsideDirectory = resource(outside);
    writeFileSync(join(outsideDirectory, "template.jsonc"), schema);
    writeFileSync(join(outsideDirectory, "template.md"), "outside\n");
    const pack = createProjectResourcePack(root);

    expectFailure(
      () =>
        loadTemplateFacet(pack, "./resource", source, {
          beforeRead: () => {
            const moved = join(root, "resource-original");
            renameSync(directory, moved);
            symlinkSync(outsideDirectory, directory, "dir");
          },
        }),
      "unsafe-path",
    );
  });

  test("does not let an escaped lexical spelling reject an in-root canonical target", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const canonicalTarget = join(root, "actual", "sibling");
    mkdirSync(canonicalTarget, { recursive: true });
    writeFileSync(join(canonicalTarget, "template.jsonc"), schema);
    writeFileSync(join(canonicalTarget, "template.md"), "canonical target\n");

    const canonicalParent = join(root, "actual", "nested");
    const outside = rootOf();
    const lexicalAlias = join(root, "nested-alias");
    mkdirSync(canonicalParent, { recursive: true });
    symlinkSync(canonicalParent, lexicalAlias, "dir");
    symlinkSync(outside, join(root, "sibling"), "dir");
    symlinkSync("../sibling", join(canonicalParent, "resource"), "dir");

    const pack = createProjectResourcePack(root);
    const loaded = loadTemplateFacet(pack, "./nested-alias/resource", source);

    expect(loaded.facet.source).toBe("canonical target\n");
    expect(loaded.dependencies).not.toContain(outside);
  });

  test("returns dependency files and unresolved target parent directories", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const directory = resource(root);
    writeFileSync(join(directory, "template.jsonc"), schema);
    writeFileSync(join(directory, "template.md"), "safe\n");
    const pack = createProjectResourcePack(root);
    const loaded = loadTemplateFacet(pack, "./resource", source);

    expect(loaded.dependencies).toEqual([
      join(pack.root, "resource", "template.jsonc"),
      join(pack.root, "resource", "template.md"),
    ]);
    const failure = expectFailure(
      () => loadTemplateFacet(pack, "./missing/resource", source),
      "missing-target",
    );
    expect(failure.unresolvedParents).toContain(pack.root);
  });

  test("reports lexical directory symlink entries and follows an in-root retarget", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const first = resource(root, "first");
    const second = resource(root, "second");
    writeFileSync(join(first, "template.jsonc"), schema);
    writeFileSync(join(first, "template.md"), "first\n");
    writeFileSync(join(second, "template.jsonc"), schema);
    writeFileSync(join(second, "template.md"), "second\n");
    const link = join(root, "linked-resource");
    symlinkSync(first, link, "dir");
    const pack = createProjectResourcePack(root);

    const firstLoad = loadTemplateFacet(pack, "./linked-resource", source);
    expect(firstLoad.facet.source).toBe("first\n");
    expect(firstLoad.dependencies).toContain(link);
    expect(firstLoad.dependencies).toContain(root);
    expect(firstLoad.dependencies).toContain(
      join(pack.root, "first", "template.jsonc"),
    );

    rmSync(link);
    symlinkSync(second, link, "dir");
    const secondLoad = loadTemplateFacet(pack, "./linked-resource", source);
    expect(secondLoad.facet.source).toBe("second\n");
    expect(secondLoad.dependencies).toContain(link);
    expect(secondLoad.dependencies).toContain(
      join(pack.root, "second", "template.md"),
    );
  });

  test("reports lexical final facet symlink entries and follows an in-root retarget", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const directory = resource(root);
    writeFileSync(join(directory, "template.jsonc"), schema);
    const first = join(root, "first.md");
    const second = join(root, "second.md");
    writeFileSync(first, "first\n");
    writeFileSync(second, "second\n");
    const link = join(directory, "template.md");
    symlinkSync(first, link, "file");
    const pack = createProjectResourcePack(root);

    const firstLoad = loadTemplateFacet(pack, "./resource", source);
    expect(firstLoad.facet.source).toBe("first\n");
    expect(firstLoad.dependencies).toContain(link);
    expect(firstLoad.dependencies).toContain(directory);
    expect(firstLoad.dependencies).toContain(join(pack.root, "first.md"));

    rmSync(link);
    symlinkSync(second, link, "file");
    const secondLoad = loadTemplateFacet(pack, "./resource", source);
    expect(secondLoad.facet.source).toBe("second\n");
    expect(secondLoad.dependencies).toContain(link);
    expect(secondLoad.dependencies).toContain(join(pack.root, "second.md"));
  });

  test("reports pack-root and chained lexical symlinks with stable dependencies", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const target = resource(root, "target");
    writeFileSync(join(target, "template.jsonc"), schema);
    writeFileSync(join(target, "template.md"), "target\n");
    const secondLink = join(root, "second-link");
    const firstLink = join(root, "first-link");
    const rootLink = join(root, "root-link");
    symlinkSync(target, secondLink, "dir");
    symlinkSync(secondLink, firstLink, "dir");
    symlinkSync(root, rootLink, "dir");
    const pack = createProjectResourcePack(root);

    const loaded = loadTemplateFacet(pack, "./root-link/first-link", source);

    expect(loaded.dependencies).toEqual(
      [
        join(pack.root, "target", "template.jsonc"),
        join(pack.root, "target", "template.md"),
        root,
        rootLink,
        join(rootLink, "first-link"),
        secondLink,
      ].sort(),
    );
  });

  test("includes captured lexical-root chain entries on successful and failed loads", () => {
    const root = rootOf();
    sourceFile(root);
    const target = resource(root, "target");
    writeFileSync(join(target, "template.jsonc"), schema);
    writeFileSync(join(target, "template.md"), "target\n");

    const aliasParent = rootOf();
    const bridge = join(aliasParent, "bridge");
    const alias = join(aliasParent, "alias");
    symlinkSync(root, bridge, "dir");
    symlinkSync("bridge", alias, "dir");
    const pack = createProjectResourcePack(alias);
    const aliasedSource = join(alias, "source.jsonc");

    const loaded = loadTemplateFacet(pack, "./target", aliasedSource);
    for (const path of [alias, realpathSync(bridge), pack.root]) {
      expect(loaded.dependencies).toContain(path);
    }

    rmSync(join(target, "template.md"));
    const failure = expectFailure(
      () => loadTemplateFacet(pack, "./target", aliasedSource),
      "missing-target",
    );
    for (const path of [alias, realpathSync(bridge), pack.root]) {
      expect(failure.dependencies).toContain(path);
    }
  });

  test("reports missing targets and facets beneath in-root symlink directories", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const target = resource(root, "target");
    writeFileSync(join(target, "template.jsonc"), schema);
    const link = join(root, "linked");
    symlinkSync(target, link, "dir");
    const pack = createProjectResourcePack(root);

    const missingFacet = expectFailure(
      () => loadTemplateFacet(pack, "./linked", source),
      "missing-target",
    );
    expect(missingFacet.dependencies).toEqual(
      [
        join(pack.root, "target", "template.jsonc"),
        join(root, "linked", "template.md"),
        link,
        root,
      ].sort(),
    );
    expect(missingFacet.unresolvedParents).toEqual([join(pack.root, "target")]);

    const missingTarget = expectFailure(
      () => loadTemplateFacet(pack, "./linked/missing", source),
      "missing-target",
    );
    expect(missingTarget.dependencies).toEqual(
      [join(root, "linked", "missing"), link, root].sort(),
    );
    expect(missingTarget.unresolvedParents).toEqual([
      pack.root,
      join(pack.root, "target"),
    ]);
  });

  test("collects existing parents for broken in-root symlink chains", () => {
    const root = rootOf();
    const source = sourceFile(root);
    mkdirSync(join(root, "dir"));
    const secondLink = join(root, "second-link");
    const firstLink = join(root, "first-link");
    symlinkSync("dir/missing/deeper", secondLink, "dir");
    symlinkSync("second-link", firstLink, "dir");
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () => loadTemplateFacet(pack, "./first-link", source),
      "missing-target",
    );

    expect(failure.dependencies).toEqual(
      [root, join(root, "dir"), firstLink, secondLink].sort(),
    );
    expect(failure.unresolvedParents).toEqual(
      [pack.root, join(pack.root, "dir")].sort(),
    );
  });

  test("retains safe canonical parents when a missing facet is a dangling symlink", () => {
    const root = rootOf();
    const source = sourceFile(root);
    const directory = resource(root);
    writeFileSync(join(directory, "template.jsonc"), schema);
    symlinkSync("missing.md", join(directory, "template.md"), "file");
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () => loadTemplateFacet(pack, "./resource", source),
      "missing-target",
    );

    expect(failure.unresolvedParents).toEqual(
      [pack.root, realpathSync(directory)].sort(),
    );
    expect(failure.unresolvedParents).not.toContain(join(root, ".."));
  });
});
