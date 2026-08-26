import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ResourceFailureCode } from "../src/index.js";
import {
  createProjectResourcePack,
  loadTemplateFacet,
  parseResourceLocator,
  ResourceResolutionError,
  resolveResourceLocator,
} from "../src/index.js";

const created: string[] = [];

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-locator-"));
  created.push(root);
  return root;
}

function authoringFile(root: string, relative = "config/source.jsonc"): string {
  const file = join(root, relative);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "{}\n");
  return file;
}

function expectFailure(
  action: () => unknown,
  code: ResourceFailureCode,
): ResourceResolutionError {
  try {
    action();
    throw new Error("expected resource resolution to fail");
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

describe("resource locator resolution", () => {
  test("resolves ./child and ../sibling from the containing file, not cwd", () => {
    const root = projectRoot();
    const containing = authoringFile(root, "config/nested/source.jsonc");
    mkdirSync(join(root, "config", "nested", "child"));
    mkdirSync(join(root, "config", "sibling"));
    const pack = createProjectResourcePack(root);

    expect(resolveResourceLocator(pack, "./child", containing).directory).toBe(
      join(pack.root, "config", "nested", "child"),
    );
    expect(
      resolveResourceLocator(pack, "../sibling", containing).directory,
    ).toBe(join(pack.root, "config", "sibling"));
  });

  test("accepts legacy locators as ordinary package locators", () => {
    expect(parseResourceLocator("@atlante/pack/agent")).toMatchObject({
      kind: "package",
      packageName: "@atlante/pack",
      subpath: "agent",
    });
    for (const [locator, subpath] of [
      ["atlante/starter", "starter"],
      ["atlante/agent", "agent"],
      ["atlante/skill", "skill"],
      ["atlante/one/two", "one/two"],
    ] as const)
      expect(parseResourceLocator(locator)).toMatchObject({
        kind: "package",
        packageName: "atlante",
        subpath,
      });
    expectFailure(() => parseResourceLocator("atlante/"), "invalid-locator");
  });

  test("resolves relative references within the project root", () => {
    const root = projectRoot();
    const containing = authoringFile(root, "one/source.jsonc");
    mkdirSync(join(root, "one", "child"), { recursive: true });
    mkdirSync(join(root, "sibling"));
    const pack = createProjectResourcePack(root);

    expect(resolveResourceLocator(pack, "./child", containing).directory).toBe(
      join(pack.root, "one", "child"),
    );
    expect(
      resolveResourceLocator(pack, "../sibling", containing).directory,
    ).toBe(join(pack.root, "sibling"));
  });

  test("allows facet-named packages but rejects facet-file locators", () => {
    expect(parseResourceLocator("template.md")).toMatchObject({
      kind: "package",
      packageName: "template.md",
      subpath: undefined,
    });

    for (const locator of ["./resource/template.md", "pkg/template.md"])
      expectFailure(() => parseResourceLocator(locator), "invalid-locator");
  });

  test("rejects absolute, URL, home, backslash, lexical traversal, and symlink escape locators", () => {
    const root = projectRoot();
    const containing = authoringFile(root, "source.jsonc");
    const pack = createProjectResourcePack(root);

    for (const locator of [
      "/tmp/resource",
      "~/resource",
      "https://example.test/resource",
      "file:///tmp/resource",
      ".\\resource",
      "./resource\\child",
      "./resource\u0000child",
      "atlante/",
      "./resource/template.jsonc",
      "./resource/instance.jsonc",
    ]) {
      expectFailure(
        () => resolveResourceLocator(pack, locator, containing),
        "invalid-locator",
      );
    }

    expectFailure(
      () => resolveResourceLocator(pack, "resource", containing),
      "package-not-declared",
    );

    mkdirSync(join(root, "nested"));
    expectFailure(
      () =>
        resolveResourceLocator(
          pack,
          "../../outside",
          join(root, "nested", "source.jsonc"),
        ),
      "unsafe-path",
    );

    mkdirSync(join(root, "parent"));
    const nestedSource = authoringFile(root, "parent/nested/source.jsonc");
    expect(resolveResourceLocator(pack, "../", nestedSource).directory).toBe(
      join(pack.root, "parent"),
    );
    expect(resolveResourceLocator(pack, "./", nestedSource).directory).toBe(
      join(pack.root, "parent", "nested"),
    );
  });

  test("allows internal symlinks but rejects external symlink targets", () => {
    const root = projectRoot();
    const containing = authoringFile(root, "source.jsonc");
    const inside = join(root, "inside");
    const outside = projectRoot();
    mkdirSync(inside);
    mkdirSync(join(outside, "resource"));
    symlinkSync(inside, join(root, "internal"), "dir");
    symlinkSync(outside, join(root, "external"), "dir");
    const pack = createProjectResourcePack(root);

    expect(
      resolveResourceLocator(pack, "./internal", containing).directory,
    ).toBe(join(pack.root, "inside"));
    const externalFailure = expectFailure(
      () => resolveResourceLocator(pack, "./external", containing),
      "unsafe-path",
    );
    expect(externalFailure.dependencies).toEqual(
      [join(root, "external"), root].sort(),
    );
    expect(externalFailure.unresolvedParents).toEqual([pack.root]);
    expectFailure(
      () => resolveResourceLocator(pack, "./external/missing", containing),
      "unsafe-path",
    );
  });

  test("preserves authoring-directory failures without requiring a source file", () => {
    const root = projectRoot();
    const resource = join(root, "resource");
    mkdirSync(resource);
    const pack = createProjectResourcePack(root);

    expect(
      resolveResourceLocator(pack, "./resource", join(root, "missing.jsonc"))
        .directory,
    ).toBe(join(pack.root, "resource"));
    expectFailure(
      () =>
        resolveResourceLocator(
          pack,
          "./resource",
          join(root, "missing", "source.jsonc"),
        ),
      "missing-target",
    );

    const authoringDirectory = join(root, "authoring-directory");
    mkdirSync(authoringDirectory);
    expectFailure(
      () => resolveResourceLocator(pack, "./resource", authoringDirectory),
      "wrong-target-type",
    );
  });

  test("rejects a cyclic in-root symlink target", () => {
    const root = projectRoot();
    const containing = authoringFile(root, "source.jsonc");
    symlinkSync("second", join(root, "first"), "dir");
    symlinkSync("first", join(root, "second"), "dir");
    const pack = createProjectResourcePack(root);

    expectFailure(
      () => resolveResourceLocator(pack, "./first", containing),
      "unsafe-path",
    );
  });

  test("resolves relative symlink targets from their canonical parent", () => {
    const root = projectRoot();
    const containing = authoringFile(root, "source.jsonc");
    const target = join(root, "target");
    mkdirSync(target);
    const canonicalParent = join(root, "actual", "nested");
    mkdirSync(canonicalParent, { recursive: true });
    symlinkSync(canonicalParent, join(root, "nested-alias"), "dir");
    symlinkSync("../../target", join(canonicalParent, "resource"), "dir");
    const pack = createProjectResourcePack(root);

    expect(
      resolveResourceLocator(pack, "./nested-alias/resource", containing)
        .directory,
    ).toBe(join(pack.root, "target"));
  });

  test("rejects an external relative symlink hop that re-enters the root", () => {
    const root = projectRoot();
    const containing = authoringFile(root, "source.jsonc");
    const safe = join(root, "safe");
    mkdirSync(safe);
    const outside = projectRoot();
    const externalBack = join(outside, "back");
    symlinkSync(root, externalBack, "dir");
    symlinkSync(
      relative(root, externalBack),
      join(root, "resource-link"),
      "dir",
    );
    symlinkSync(root, join(root, "in-root-alias"), "dir");
    const pack = createProjectResourcePack(root);

    expectFailure(
      () =>
        resolveResourceLocator(
          pack,
          "./in-root-alias/resource-link/safe",
          containing,
        ),
      "unsafe-path",
    );
  });

  test("rejects an external symlink hop before an in-root re-entry", () => {
    const root = projectRoot();
    const containing = authoringFile(root, "source.jsonc");
    const safe = join(root, "safe");
    mkdirSync(safe);
    const outside = projectRoot();
    const external = join(root, "external");
    symlinkSync(outside, external, "dir");
    symlinkSync(safe, join(outside, "back"), "dir");
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () => resolveResourceLocator(pack, "./external/back", containing),
      "unsafe-path",
    );

    expect(failure.dependencies).toEqual([root, external].sort());
    expect(failure.unresolvedParents).toEqual([pack.root]);
    expect(failure.dependencies).not.toContain(join(root, "external", "back"));
    expect(failure.dependencies).not.toContain(outside);
    expect(failure.dependencies).not.toContain(safe);
  });

  test("rejects a lexically out-of-root locator that re-enters through an external symlink", () => {
    const root = projectRoot();
    const containing = authoringFile(root, "config/source.jsonc");
    const safe = join(root, "safe");
    mkdirSync(safe);

    const outside = projectRoot();
    const externalBack = join(outside, "back");
    symlinkSync(root, externalBack, "dir");
    const lexicalTarget = join(externalBack, "safe");
    const locator = relative(join(root, "config"), lexicalTarget);
    const pack = createProjectResourcePack(root);

    expect(locator.startsWith("../")).toBe(true);
    expect(relative(pack.root, lexicalTarget).startsWith(`..${sep}`)).toBe(
      true,
    );

    const failure = expectFailure(
      () => resolveResourceLocator(pack, locator, containing),
      "unsafe-path",
    );
    const exposedPaths = [
      ...failure.dependencies,
      ...failure.unresolvedParents,
    ];
    expect(exposedPaths).not.toContain(outside);
    expect(exposedPaths).not.toContain(externalBack);
    expect(
      exposedPaths.every((path) => {
        const fromRoot = relative(pack.root, path);
        return (
          fromRoot === "" ||
          (fromRoot !== ".." &&
            !fromRoot.startsWith(`..${sep}`) &&
            !isAbsolute(fromRoot))
        );
      }),
    ).toBe(true);
  });

  test("captures an immutable canonical root and isolated stable source data", () => {
    const root = projectRoot();
    const alias = `${root}-alias`;
    symlinkSync(root, alias, "dir");
    const pack = createProjectResourcePack(alias);

    expect(pack.root).not.toBe(alias);
    expect(Object.isFrozen(pack)).toBe(true);
  });

  test("rejects an authoring file reached through an external lexical alias", () => {
    const root = projectRoot();
    authoringFile(root);
    const alias = mkdtempSync(join(tmpdir(), "atlante-authoring-alias-"));
    rmSync(alias, { recursive: true, force: true });
    symlinkSync(root, alias, "dir");
    created.push(alias);
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () =>
        resolveResourceLocator(pack, "./resource", join(alias, "source.jsonc")),
      "unsafe-path",
    );

    expect(failure.dependencies).toEqual([]);
    expect(failure.unresolvedParents).toEqual([]);
    expect(failure.message).not.toContain(alias);
  });

  test("revalidates the captured lexical-root chain on every resolution and read", () => {
    const root = projectRoot();
    authoringFile(root, "source.jsonc");
    const resource = join(root, "resource");
    mkdirSync(resource);
    writeFileSync(
      join(resource, "template.jsonc"),
      '{ "$schema": "https://json-schema.org/draft/2020-12/schema" }\n',
    );
    writeFileSync(join(resource, "template.md"), "safe\n");

    const aliasParent = projectRoot();
    const bridge = join(aliasParent, "bridge");
    const alias = join(aliasParent, "root-alias");
    symlinkSync(root, bridge, "dir");
    symlinkSync("bridge", alias, "dir");
    const pack = createProjectResourcePack(alias);
    const aliasedContaining = join(alias, "source.jsonc");

    const outside = projectRoot();
    const externalBack = join(outside, "back");
    symlinkSync(root, externalBack, "dir");

    expect(
      loadTemplateFacet(pack, "./resource", aliasedContaining).facet.source,
    ).toBe("safe\n");

    expectFailure(
      () =>
        loadTemplateFacet(pack, "./resource", aliasedContaining, {
          beforeRead: () => {
            rmSync(bridge);
            symlinkSync(externalBack, bridge, "dir");
          },
        }),
      "unsafe-path",
    );
    expectFailure(
      () => loadTemplateFacet(pack, "./resource", aliasedContaining),
      "unsafe-path",
    );
  });
});
