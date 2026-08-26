import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  createPackageResolutionCache,
  createPackageResourcePack,
  createProjectResourcePack,
  loadInstanceFacet,
  loadPresetFacet,
  loadTemplateFacet,
  parseResourceLocator,
  ResourceResolutionError,
  resolvePackageResourcePack,
  resolveResourceDocument,
  resourcePackMetadataPaths,
} from "../src/index.js";

const created: string[] = [];
const schemaUri = "https://json-schema.org/draft/2020-12/schema";
const schema = JSON.stringify({ $schema: schemaUri, type: "object" });

type PackManifestOptions = Readonly<{
  readonly version?: string;
  readonly format?: unknown;
  readonly includeFormat?: boolean;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}>;

function projectRoot(dependencies: Record<string, string> = {}): {
  root: string;
  config: string;
} {
  const root = mkdtempSync(join(tmpdir(), "atlante-package-project-"));
  created.push(root);
  const config = join(root, "atlante.jsonc");
  writeFileSync(config, "{}\n");
  writeJson(join(root, "package.json"), {
    name: "atlante-package-fixture-project",
    version: "1.0.0",
    dependencies,
  });
  return { root, config };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function installedPackage(
  root: string,
  name: string,
  options: PackManifestOptions = {},
): string {
  const directory = join(root, "node_modules", ...name.split("/"));
  mkdirSync(directory, { recursive: true });
  writePackManifest(directory, name, options);
  return directory;
}

function writePackManifest(
  directory: string,
  name: string,
  options: PackManifestOptions = {},
): void {
  const manifest: Record<string, unknown> = {
    name,
    version: options.version ?? "1.2.0",
  };
  if (options.includeFormat !== false)
    manifest.atlante = { format: options.format ?? 1 };
  for (const key of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ] as const) {
    const value = options[key];
    if (value) manifest[key] = value;
  }
  writeJson(join(directory, "package.json"), manifest);
}

function writeTemplate(directory: string, name = "agent"): string {
  const resource = join(directory, name);
  mkdirSync(resource, { recursive: true });
  writeFileSync(join(resource, "template.jsonc"), `${schema}\n`);
  writeFileSync(join(resource, "template.md"), "# package template\n");
  return resource;
}

function writePackContent(directory: string): void {
  writeJson(join(directory, "atlante.jsonc"), {
    agents: { packaged: "./reviewer" },
  });
  writeJson(join(directory, "strict", "atlante.jsonc"), {
    values: { named: "preset" },
  });
  writeTemplate(directory);
  writeJson(join(directory, "reviewer", "instance.jsonc"), {
    $template: "../agent",
    description: "Packaged reviewer",
    value: "from package",
  });
}

function packageLocator(
  value: string,
): Extract<
  ReturnType<typeof parseResourceLocator>,
  { readonly kind: "package" }
> {
  const parsed = parseResourceLocator(value);
  if (parsed.kind !== "package") throw new Error("expected package locator");
  return parsed;
}

function expectFailure(
  action: () => unknown,
  code: string,
): ResourceResolutionError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ResourceResolutionError);
    if (error instanceof ResourceResolutionError) {
      expect(String(error.failure.code)).toBe(code);
      return error;
    }
  }
  throw new Error(`expected ${code} failure`);
}

afterEach(() => {
  for (const root of created.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("package locators", () => {
  test("parses scoped and unscoped package locators with optional subpaths", () => {
    expect(parseResourceLocator("@acme/review-pack")).toMatchObject({
      kind: "package",
      packageName: "@acme/review-pack",
      subpath: undefined,
    });
    expect(parseResourceLocator("@acme/review-pack/strict/base")).toMatchObject(
      {
        kind: "package",
        packageName: "@acme/review-pack",
        subpath: "strict/base",
      },
    );
    expect(parseResourceLocator("acme-review-pack/reviewer")).toMatchObject({
      kind: "package",
      packageName: "acme-review-pack",
      subpath: "reviewer",
    });
  });

  test("rejects malformed package names and unsafe package paths", () => {
    for (const locator of [
      "@acme",
      "@acme/",
      "@acme/review-pack/",
      "@acme/review-pack//strict",
      "@acme/review-pack/./strict",
      "@acme/review-pack/../strict",
      "acme-review-pack/agent/template.jsonc",
      "acme-review-pack/agent/template.md",
      "/acme-review-pack",
      "~/acme-review-pack",
      "https://example.test/acme-review-pack",
      "acme-review-pack\\strict",
      "acme-review-pack\u0000strict",
    ]) {
      expect(() => parseResourceLocator(locator)).toThrow(
        ResourceResolutionError,
      );
      try {
        parseResourceLocator(locator);
      } catch (error) {
        expect(error).toBeInstanceOf(ResourceResolutionError);
        if (error instanceof ResourceResolutionError)
          expect(error.failure.code).toBe("invalid-locator");
      }
    }
  });
});

describe("package resource loading", () => {
  test("loads default and named presets, templates, and instances lazily", () => {
    const { root, config } = projectRoot({ "@acme/review-pack": "1.2.0" });
    const packageRoot = installedPackage(root, "@acme/review-pack");
    writePackContent(packageRoot);
    const unrelated = join(packageRoot, "unrelated");
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, "template.jsonc"), "{ not JSONC");

    const pack = createProjectResourcePack(root);
    const preset = loadPresetFacet(pack, "@acme/review-pack", config);
    const named = loadPresetFacet(pack, "@acme/review-pack/strict", config);
    const template = loadTemplateFacet(pack, "@acme/review-pack/agent", config);
    const instance = loadInstanceFacet(
      pack,
      "@acme/review-pack/reviewer",
      config,
    );

    expect(preset.facet.document).toHaveProperty("agents.packaged");
    expect(named.facet.document).toEqual({ values: { named: "preset" } });
    expect(template.facet.source).toBe("# package template\n");
    expect(instance.facet.input).toMatchObject({ value: "from package" });
    expect({
      kind: template.facet.origin.kind,
      path: String(template.facet.origin.path),
    }).toEqual({
      kind: "package",
      path: "@acme/review-pack@1.2.0/agent/template.jsonc",
    });
    expect({
      kind: instance.facet.origin.kind,
      path: String(instance.facet.origin.path),
    }).toEqual({
      kind: "package",
      path: "@acme/review-pack@1.2.0/reviewer/instance.jsonc",
    });
    expect(template.dependencies).toContain(join(packageRoot, "package.json"));
    expect(
      template.dependencies.some((path) => path.includes("unrelated")),
    ).toBe(false);
  });

  test("resolves package default presets and contextual template and instance facets", () => {
    const { root, config } = projectRoot({ "@acme/review-pack": "1.2.0" });
    const packageRoot = installedPackage(root, "@acme/review-pack");
    writePackContent(packageRoot);
    writeJson(join(config), {
      extends: "@acme/review-pack/strict",
      agents: {
        direct: {
          $template: "@acme/review-pack/agent",
          description: "Direct package template",
        },
        shorthand: "@acme/review-pack/reviewer",
      },
    });

    const result = resolveResourceDocument({
      pack: createProjectResourcePack(root),
      rootFile: config,
    });

    expect(result.normalized.values).toEqual({ named: "preset" });
    expect({
      kind: result.bindings.agents.direct?.template.origin.kind,
      path: String(result.bindings.agents.direct?.template.origin.path),
    }).toEqual({
      kind: "package",
      path: "@acme/review-pack@1.2.0/agent/template.jsonc",
    });
    expect(result.bindings.agents.shorthand?.input).toMatchObject({
      value: "from package",
    });
    expect({
      kind: result.bindings.agents.shorthand?.template.origin.kind,
      path: String(result.bindings.agents.shorthand?.template.origin.path),
    }).toEqual({
      kind: "package",
      path: "@acme/review-pack@1.2.0/agent/template.jsonc",
    });
  });

  test("rejects undeclared, absent, unreadable, missing-format, and unsupported packages", () => {
    const undeclared = projectRoot();
    installedPackage(undeclared.root, "acme-pack");
    expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(undeclared.root),
          "acme-pack",
          undeclared.config,
        ),
      "package-not-declared",
    );

    const absent = projectRoot({ "acme-pack": "1.0.0" });
    expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(absent.root),
          "acme-pack",
          absent.config,
        ),
      "package-not-installed",
    );

    const unreadable = projectRoot({ "acme-pack": "1.0.0" });
    const unreadableRoot = installedPackage(unreadable.root, "acme-pack");
    writeFileSync(join(unreadableRoot, "package.json"), "{ not JSON");
    expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(unreadable.root),
          "acme-pack",
          unreadable.config,
        ),
      "package-metadata-unreadable",
    );

    const missingFormat = projectRoot({ "acme-pack": "1.0.0" });
    installedPackage(missingFormat.root, "acme-pack", {
      includeFormat: false,
    });
    expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(missingFormat.root),
          "acme-pack",
          missingFormat.config,
        ),
      "missing-pack-format",
    );

    const unsupportedFormat = projectRoot({ "acme-pack": "1.0.0" });
    installedPackage(unsupportedFormat.root, "acme-pack", { format: 2 });
    expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(unsupportedFormat.root),
          "acme-pack",
          unsupportedFormat.config,
        ),
      "unsupported-pack-format",
    );

    const stringFormat = projectRoot({ "acme-pack": "1.0.0" });
    installedPackage(stringFormat.root, "acme-pack", { format: "1" });
    expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(stringFormat.root),
          "acme-pack",
          stringFormat.config,
        ),
      "unsupported-pack-format",
    );

    const missingSubpath = projectRoot({ "acme-pack": "1.0.0" });
    installedPackage(missingSubpath.root, "acme-pack");
    expectFailure(
      () =>
        loadTemplateFacet(
          createProjectResourcePack(missingSubpath.root),
          "acme-pack/missing",
          missingSubpath.config,
        ),
      "missing-package-subpath",
    );
  });

  test("retains selected package metadata for target and facet failures", () => {
    const fixture = projectRoot({ "acme-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "acme-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "acme-pack");

    const installed = join(fixture.root, "node_modules", "acme-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");

    const selectedManifestPaths = [
      realpathSync(join(packageRoot, "package.json")),
      join(installed, "package.json"),
    ];
    const expectSelectedManifestPaths = (
      failure: ResourceResolutionError,
    ): void => {
      for (const path of selectedManifestPaths)
        expect(failure.dependencies).toContain(path);
    };
    const pack = createProjectResourcePack(fixture.root);

    const missingSubpath = expectFailure(
      () => loadTemplateFacet(pack, "acme-pack/missing", fixture.config),
      "missing-package-subpath",
    );
    expectSelectedManifestPaths(missingSubpath);

    const outside = mkdtempSync(join(tmpdir(), "atlante-package-outside-"));
    created.push(outside);
    symlinkSync(outside, join(packageRoot, "unsafe"), "dir");
    const unsafeChild = expectFailure(
      () => loadPresetFacet(pack, "acme-pack/unsafe", fixture.config),
      "unsafe-path",
    );
    expectSelectedManifestPaths(unsafeChild);

    const resource = writeTemplate(packageRoot);
    const outsideFacet = join(outside, "template.md");
    writeFileSync(outsideFacet, "outside\n");
    unlinkSync(join(resource, "template.md"));
    symlinkSync(outsideFacet, join(resource, "template.md"), "file");
    const unsafeFacet = expectFailure(
      () => loadTemplateFacet(pack, "acme-pack/agent", fixture.config),
      "unsafe-path",
    );
    expectSelectedManifestPaths(unsafeFacet);

    unlinkSync(join(resource, "template.md"));
    mkdirSync(join(resource, "template.md"));
    const wrongFacetTarget = expectFailure(
      () => loadTemplateFacet(pack, "acme-pack/agent", fixture.config),
      "wrong-target-type",
    );
    expectSelectedManifestPaths(wrongFacetTarget);

    rmdirSync(join(resource, "template.md"));
    writeFileSync(join(resource, "template.md"), "readable\n");
    const readFailure = expectFailure(
      () =>
        loadTemplateFacet(pack, "acme-pack/agent", fixture.config, {
          beforeRead: (path) => {
            if (path === realpathSync(join(resource, "template.md")))
              throw new Error("injected read failure");
          },
        }),
      "wrong-target-type",
    );
    expectSelectedManifestPaths(readFailure);
  });

  test("rejects invalid package versions before constructing package origins", () => {
    for (const version of [
      "/tmp/package.json",
      "../../outside",
      "1.2.3/extra",
      "1.2.3\\extra",
      "1.2.3#fragment",
      " 1.2.3",
      "1.2.3 ",
      "1.2.3\n",
      "",
      "latest",
      "1.2",
      "1.2.3.4",
    ]) {
      const fixture = projectRoot({ "acme-pack": "1.0.0" });
      const packageRoot = installedPackage(fixture.root, "acme-pack", {
        version,
      });
      const resource = writeTemplate(packageRoot);
      writeFileSync(join(resource, "template.jsonc"), "{ not JSONC");
      const reads: string[] = [];

      const failure = expectFailure(
        () =>
          loadTemplateFacet(
            createProjectResourcePack(fixture.root),
            "acme-pack/agent",
            fixture.config,
            { beforeRead: (path) => reads.push(path) },
          ),
        "package-metadata-unreadable",
      );

      expect(failure.failure.message).toBe(
        "package metadata version must be a strict semver value",
      );
      expect(failure.failure.source).toBeUndefined();
      expect(failure.dependencies).toContain(join(packageRoot, "package.json"));
      expect(reads).not.toContain(join(resource, "template.jsonc"));
    }
  });

  test("accepts prerelease and build metadata in version-qualified origins", () => {
    const version = "2.4.0-rc.1+build.9";
    const fixture = projectRoot({ "acme-pack": "1.0.0" });
    const packageRoot = installedPackage(fixture.root, "acme-pack", {
      version,
    });
    writeTemplate(packageRoot);

    const template = loadTemplateFacet(
      createProjectResourcePack(fixture.root),
      "acme-pack/agent",
      fixture.config,
    );

    expect({
      kind: template.facet.origin.kind,
      path: String(template.facet.origin.path),
    }).toEqual({
      kind: "package",
      path: `acme-pack@${version}/agent/template.jsonc`,
    });
    expect(template.facet.source).toBe("# package template\n");
  });

  test("rejects relative package authoring files before package lookup", () => {
    const fixture = projectRoot({ "acme-pack": "1.0.0" });
    const packageRoot = installedPackage(fixture.root, "acme-pack");
    writeJson(join(packageRoot, "atlante.jsonc"), {});
    const reads: string[] = [];

    const failure = expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(fixture.root),
          "acme-pack",
          "./relative-authoring.jsonc",
          { beforeRead: (path) => reads.push(path) },
        ),
      "invalid-locator",
    );

    expect(reads).toEqual([]);
    expect(failure.dependencies).toEqual([]);
    expect(failure.unresolvedParents).toEqual([]);
  });

  test("rejects an absolute out-of-pack authoring file before unrelated lookup", () => {
    const fixture = projectRoot({ "unrelated-pack": "1.0.0" });
    const outside = mkdtempSync(join(tmpdir(), "atlante-package-outside-"));
    created.push(outside);
    const authoringFile = join(outside, "authoring.jsonc");
    writeJson(authoringFile, {});
    const unrelatedRoot = installedPackage(outside, "unrelated-pack");
    writeJson(join(unrelatedRoot, "atlante.jsonc"), {});
    const reads: string[] = [];

    const failure = expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(fixture.root),
          "unrelated-pack",
          authoringFile,
          { beforeRead: (path) => reads.push(path) },
        ),
      "unsafe-path",
    );

    expect(reads).toEqual([]);
    expect(failure.dependencies).toEqual([]);
    expect(failure.unresolvedParents).toEqual([]);
  });

  test("does not let package lookup escape above the authoring pack root", () => {
    const container = mkdtempSync(join(tmpdir(), "atlante-package-container-"));
    created.push(container);
    const root = join(container, "project");
    mkdirSync(root, { recursive: true });
    const config = join(root, "atlante.jsonc");
    writeFileSync(config, "{}\n");
    writeJson(join(root, "package.json"), {
      name: "atlante-package-fixture-project",
      version: "1.0.0",
      dependencies: { "upward-pack": "1.0.0" },
    });
    const upwardRoot = installedPackage(container, "upward-pack");
    writeJson(join(upwardRoot, "atlante.jsonc"), {});
    const pack = createProjectResourcePack(root);

    const failure = expectFailure(
      () => loadPresetFacet(pack, "upward-pack", config),
      "package-not-installed",
    );

    expect(failure.unresolvedParents).toEqual([pack.root]);
    expect(failure.dependencies).not.toContain(join(container, "node_modules"));
  });

  test("retains the nearest safe in-root node_modules retry parent", () => {
    const fixture = projectRoot({ "missing-pack": "1.0.0" });
    const authoringFile = join(
      fixture.root,
      "source",
      "deep",
      "authoring.jsonc",
    );
    writeJson(authoringFile, {});
    mkdirSync(join(fixture.root, "node_modules"), { recursive: true });
    const nearestNodeModules = join(fixture.root, "source", "node_modules");
    mkdirSync(nearestNodeModules, { recursive: true });
    const pack = createProjectResourcePack(fixture.root);

    const failure = expectFailure(
      () => loadPresetFacet(pack, "missing-pack", authoringFile),
      "package-not-installed",
    );

    expect(failure.unresolvedParents).toEqual([
      join(pack.root, "node_modules"),
      join(pack.root, "source", "node_modules"),
    ]);
    expect(failure.unresolvedParents).not.toContain(join(pack.root, ".."));
  });

  test("uses the same safe retry parent when a package entry cannot become a pack", () => {
    const fixture = projectRoot({ "broken-pack": "1.0.0" });
    const nodeModules = join(fixture.root, "node_modules");
    mkdirSync(nodeModules, { recursive: true });
    symlinkSync(
      join(fixture.root, "missing-package-target"),
      join(nodeModules, "broken-pack"),
      "dir",
    );
    const pack = createProjectResourcePack(fixture.root);

    const failure = expectFailure(
      () => loadPresetFacet(pack, "broken-pack", fixture.config),
      "package-not-installed",
    );

    expect(failure.unresolvedParents).toEqual([
      join(pack.root, "node_modules"),
    ]);
  });

  test("falls back to the pack root when no node_modules directory exists", () => {
    const fixture = projectRoot({ "missing-pack": "1.0.0" });
    const authoringFile = join(fixture.root, "source", "authoring.jsonc");
    writeJson(authoringFile, {});
    const pack = createProjectResourcePack(fixture.root);

    const failure = expectFailure(
      () => loadPresetFacet(pack, "missing-pack", authoringFile),
      "package-not-installed",
    );

    expect(failure.unresolvedParents).toEqual([pack.root]);
  });

  test("accepts project dependencies, devDependencies, and optionalDependencies", () => {
    const fixture = projectRoot({ "dependency-pack": "1.0.0" });
    writeJson(join(fixture.root, "package.json"), {
      name: "atlante-package-fixture-project",
      version: "1.0.0",
      dependencies: { "dependency-pack": "1.0.0" },
      devDependencies: { "dev-pack": "1.0.0" },
      optionalDependencies: { "optional-pack": "1.0.0" },
    });
    for (const name of ["dependency-pack", "dev-pack", "optional-pack"]) {
      const packageRoot = installedPackage(fixture.root, name);
      writeJson(join(packageRoot, "atlante.jsonc"), {});
      expect(
        loadPresetFacet(
          createProjectResourcePack(fixture.root),
          name,
          fixture.config,
        ).facet.kind,
      ).toBe("preset");
    }
  });

  test("allows a pack to use declared runtime dependencies and explicit self references", () => {
    const { root, config } = projectRoot({ "author-pack": "1.0.0" });
    const dependencyRoot = installedPackage(root, "dependency-pack");
    writeJson(join(dependencyRoot, "atlante.jsonc"), {
      values: { transitive: "loaded" },
    });
    const optionalRoot = installedPackage(root, "optional-pack");
    writeJson(join(optionalRoot, "atlante.jsonc"), {
      values: { optional: "loaded" },
    });
    const authorRoot = installedPackage(root, "author-pack", {
      dependencies: { "dependency-pack": "1.0.0" },
      optionalDependencies: { "optional-pack": "1.0.0" },
    });
    writeJson(join(authorRoot, "atlante.jsonc"), {
      extends: "dependency-pack",
    });

    writeJson(join(authorRoot, "strict", "atlante.jsonc"), {
      values: { self: "loaded" },
    });
    writeJson(join(authorRoot, "optional", "atlante.jsonc"), {
      extends: "optional-pack",
    });
    writeJson(join(config), { extends: "author-pack" });
    expect(
      resolveResourceDocument({
        pack: createProjectResourcePack(root),
        rootFile: config,
      }).normalized.values,
    ).toEqual({ transitive: "loaded" });

    writeJson(join(config), { extends: "author-pack/strict" });
    expect(
      resolveResourceDocument({
        pack: createProjectResourcePack(root),
        rootFile: config,
      }).normalized.values,
    ).toEqual({ self: "loaded" });

    writeJson(join(config), { extends: "author-pack/optional" });
    expect(
      resolveResourceDocument({
        pack: createProjectResourcePack(root),
        rootFile: config,
      }).normalized.values,
    ).toEqual({ optional: "loaded" });
  });

  test("rejects undeclared, hoisted, and dev-only pack dependencies", () => {
    for (const options of [
      {},
      { devDependencies: { "dependency-pack": "1.0.0" } },
    ]) {
      const { root, config } = projectRoot({ "author-pack": "1.0.0" });
      installedPackage(root, "dependency-pack");
      const authorRoot = installedPackage(root, "author-pack", options);
      writeJson(join(authorRoot, "atlante.jsonc"), {
        extends: "dependency-pack",
      });
      writeJson(join(config), { extends: "author-pack" });

      expectFailure(
        () =>
          resolveResourceDocument({
            pack: createProjectResourcePack(root),
            rootFile: config,
          }),
        "package-not-declared",
      );
    }
  });

  test("allows a workspace/file package root symlink but rejects escaping child symlinks", () => {
    const { root, config } = projectRoot({
      "@acme/review-pack": "file:workspace",
    });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "review-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "@acme/review-pack");
    const resource = writeTemplate(packageRoot);
    const internalSource = join(packageRoot, "internal.md");
    writeFileSync(internalSource, "inside\n");
    rmSync(join(resource, "template.md"));
    symlinkSync(internalSource, join(resource, "template.md"), "file");
    const installed = join(root, "node_modules", "@acme", "review-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");

    const pack = createProjectResourcePack(root);
    expect(
      loadTemplateFacet(pack, "@acme/review-pack/agent", config).facet.source,
    ).toBe("inside\n");

    const outside = mkdtempSync(join(tmpdir(), "atlante-package-outside-"));
    created.push(outside);
    const outsideSource = join(outside, "outside.md");
    writeFileSync(outsideSource, "outside\n");
    rmSync(join(resource, "template.md"));
    symlinkSync(outsideSource, join(resource, "template.md"), "file");
    const failure = expectFailure(
      () => loadTemplateFacet(pack, "@acme/review-pack/agent", config),
      "unsafe-path",
    );
    expect(failure.dependencies).not.toContain(outsideSource);
    expect(failure.failure.source).toBeUndefined();
  });

  test("rejects a package root that leaves through an external bridge and re-enters", () => {
    const fixture = projectRoot({ "@acme/review-pack": "file:workspace" });
    const canonicalPackage = join(fixture.root, "real-pkg");
    mkdirSync(canonicalPackage, { recursive: true });
    writePackManifest(canonicalPackage, "@acme/review-pack");
    writePackContent(canonicalPackage);

    const external = mkdtempSync(join(tmpdir(), "atlante-package-bridge-"));
    created.push(external);
    const bridge = join(external, "bridge");
    mkdirSync(bridge, { recursive: true });
    const reentry = join(bridge, "reentry");
    symlinkSync(canonicalPackage, reentry, "dir");

    const installed = join(
      fixture.root,
      "node_modules",
      "@acme",
      "review-pack",
    );
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(reentry, installed, "dir");

    const selectedMetadata = join(canonicalPackage, "package.json");
    const reads: string[] = [];
    const failure = expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(fixture.root),
          "@acme/review-pack",
          fixture.config,
          { beforeRead: (path) => reads.push(path) },
        ),
      "unsafe-path",
    );

    expect(reads).not.toContain(selectedMetadata);
    expect(failure.dependencies).not.toContain(external);
    expect(failure.dependencies).not.toContain(bridge);
    expect(failure.dependencies).not.toContain(reentry);
    expect(failure.unresolvedParents).not.toContain(external);
    expect(failure.unresolvedParents).not.toContain(bridge);
    expect(failure.unresolvedParents).not.toContain(reentry);
  });

  test("rejects selected metadata that leaves and re-enters before reading or caching", () => {
    const fixture = projectRoot({ "acme-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "acme-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "acme-pack");
    writePackContent(packageRoot);

    const metadataRoot = join(packageRoot, "metadata");
    mkdirSync(metadataRoot, { recursive: true });
    writeJson(join(metadataRoot, "package.json"), {
      name: "acme-pack",
      version: "1.2.0",
      atlante: { format: 1 },
    });
    const outside = mkdtempSync(join(tmpdir(), "atlante-package-bridge-"));
    created.push(outside);
    const bridge = join(outside, "bridge");
    mkdirSync(bridge, { recursive: true });
    symlinkSync(metadataRoot, join(bridge, "reentry"), "dir");
    unlinkSync(join(packageRoot, "package.json"));
    symlinkSync(
      join(bridge, "reentry", "package.json"),
      join(packageRoot, "package.json"),
      "file",
    );

    const installed = join(fixture.root, "node_modules", "acme-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");

    const reads: string[] = [];
    const cache = createPackageResolutionCache();
    const failure = expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(fixture.root),
          "acme-pack",
          fixture.config,
          {
            packageCache: cache,
            beforeRead: (path) => reads.push(path),
          },
        ),
      "unsafe-path",
    );

    expect(reads).toContain(realpathSync(join(fixture.root, "package.json")));
    expect(reads).not.toContain(
      realpathSync(join(metadataRoot, "package.json")),
    );
    expect(cache.packageMetadata).toHaveLength(0);
    expect(failure.dependencies).toContain(
      realpathSync(join(fixture.root, "package.json")),
    );
    expect(failure.dependencies).not.toContain(outside);
    expect(failure.unresolvedParents).not.toContain(outside);
  });

  test("rejects a project declaration that leaves and re-enters before reading or caching", () => {
    const fixture = projectRoot({ "acme-pack": "1.0.0" });
    const declarationRoot = join(fixture.root, "declaration");
    writeJson(join(declarationRoot, "package.json"), {
      name: "atlante-package-fixture-project",
      version: "1.0.0",
      dependencies: { "acme-pack": "1.0.0" },
    });
    const outside = mkdtempSync(join(tmpdir(), "atlante-package-bridge-"));
    created.push(outside);
    const bridge = join(outside, "bridge");
    mkdirSync(bridge, { recursive: true });
    symlinkSync(declarationRoot, join(bridge, "reentry"), "dir");
    unlinkSync(join(fixture.root, "package.json"));
    symlinkSync(
      join(bridge, "reentry", "package.json"),
      join(fixture.root, "package.json"),
      "file",
    );

    const reads: string[] = [];
    const cache = createPackageResolutionCache();
    const failure = expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(fixture.root),
          "acme-pack",
          fixture.config,
          {
            packageCache: cache,
            beforeRead: (path) => reads.push(path),
          },
        ),
      "unsafe-path",
    );

    expect(reads).toEqual([]);
    expect(cache.projectManifests).toHaveLength(0);
    expect(cache.packageMetadata).toHaveLength(0);
    expect(failure.dependencies).not.toContain(outside);
    expect(failure.unresolvedParents).toEqual([realpathSync(fixture.root)]);
  });

  test("fails closed for a bridged node_modules probe without exposing the decoy", () => {
    const fixture = projectRoot({ "decoy-pack": "1.0.0" });
    const trustedNodeModules = join(fixture.root, "trusted-node_modules");
    const decoy = installedPackage(trustedNodeModules, "decoy-pack");
    writePackContent(decoy);

    const outside = mkdtempSync(join(tmpdir(), "atlante-package-bridge-"));
    created.push(outside);
    const bridge = join(outside, "bridge");
    mkdirSync(bridge, { recursive: true });
    symlinkSync(trustedNodeModules, join(bridge, "reentry"), "dir");
    symlinkSync(
      join(bridge, "reentry"),
      join(fixture.root, "node_modules"),
      "dir",
    );

    const reads: string[] = [];
    const failure = expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(fixture.root),
          "decoy-pack",
          fixture.config,
          { beforeRead: (path) => reads.push(path) },
        ),
      "unsafe-path",
    );

    expect(reads).toEqual([realpathSync(join(fixture.root, "package.json"))]);
    expect(failure.dependencies).toContain(join(fixture.root, "package.json"));
    expect(failure.dependencies).not.toContain(decoy);
    expect(failure.dependencies).not.toContain(outside);
    expect(failure.unresolvedParents).toEqual([realpathSync(fixture.root)]);
    expect(failure.unresolvedParents).not.toContain(outside);
  });

  test("fails closed for a bridged canonical ancestor node_modules probe", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "missing-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {
      extends: "missing-pack",
    });

    const outside = mkdtempSync(join(tmpdir(), "atlante-package-ancestor-"));
    created.push(outside);
    const outsideNodeModules = join(outside, "node_modules");
    const decoy = installedPackage(outside, "missing-pack");
    writeJson(join(decoy, "atlante.jsonc"), {
      values: { from: "outside" },
    });
    const workspaceNodeModules = join(workspace, "node_modules");
    symlinkSync(outsideNodeModules, workspaceNodeModules, "dir");

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    writeJson(join(fixture.config), { extends: "author-pack" });

    const failure = expectFailure(
      () =>
        resolveResourceDocument({
          pack: createProjectResourcePack(fixture.root),
          rootFile: fixture.config,
        }),
      "unsafe-path",
    );

    expect(failure.failure.message).toBe(
      "package lookup leaves the resource root",
    );
    expect(failure.dependencies).not.toContain(outside);
    expect(failure.dependencies).not.toContain(decoy);
    expect(failure.unresolvedParents).not.toContain(outside);
    expect(failure.trustedRoots).not.toContainEqual({
      canonical: realpathSync(outsideNodeModules),
      lexical: workspaceNodeModules,
    });
    expect(JSON.stringify(failure.failure)).not.toContain(outside);
  });

  test("rejects a bridged scoped parent while retaining the direct final package alias", () => {
    const fixture = projectRoot({ "@scope/pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "@scope/pack");
    writePackContent(packageRoot);

    const trustedScope = join(fixture.root, "trusted-scope");
    mkdirSync(trustedScope, { recursive: true });
    const finalEntry = join(trustedScope, "pack");
    symlinkSync(packageRoot, finalEntry, "dir");

    const outside = mkdtempSync(join(tmpdir(), "atlante-package-bridge-"));
    created.push(outside);
    const bridge = join(outside, "bridge");
    mkdirSync(bridge, { recursive: true });
    symlinkSync(trustedScope, join(bridge, "reentry"), "dir");
    mkdirSync(join(fixture.root, "node_modules"), { recursive: true });
    symlinkSync(
      join(bridge, "reentry"),
      join(fixture.root, "node_modules", "@scope"),
      "dir",
    );

    const reads: string[] = [];
    const failure = expectFailure(
      () =>
        loadPresetFacet(
          createProjectResourcePack(fixture.root),
          "@scope/pack",
          fixture.config,
          { beforeRead: (path) => reads.push(path) },
        ),
      "unsafe-path",
    );

    expect(reads).toEqual([realpathSync(join(fixture.root, "package.json"))]);
    expect(failure.dependencies).toContain(
      realpathSync(join(fixture.root, "package.json")),
    );
    expect(failure.dependencies).not.toContain(outside);
    expect(failure.unresolvedParents).toEqual([
      realpathSync(join(fixture.root, "node_modules")),
    ]);
    expect(failure.unresolvedParents).not.toContain(outside);
  });

  test("resolves transitive dependencies from a symlinked pack's canonical workspace root", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "dependency-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {
      extends: "dependency-pack",
    });

    const canonicalDependency = installedPackage(
      packageRoot,
      "dependency-pack",
    );
    writeJson(join(canonicalDependency, "atlante.jsonc"), {
      values: { from: "canonical workspace dependency" },
    });
    const hoistedDecoy = installedPackage(fixture.root, "dependency-pack");
    writeJson(join(hoistedDecoy, "atlante.jsonc"), {
      values: { from: "hoisted decoy" },
    });
    const workspaceAncestorDecoy = installedPackage(
      workspace,
      "dependency-pack",
    );
    writeJson(join(workspaceAncestorDecoy, "atlante.jsonc"), {
      values: { from: "workspace ancestor decoy" },
    });

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    writeJson(join(fixture.config), { extends: "author-pack" });

    const result = resolveResourceDocument({
      pack: createProjectResourcePack(fixture.root),
      rootFile: fixture.config,
    });

    expect(result.normalized.values).toEqual({
      from: "canonical workspace dependency",
    });
    expect(result.dependencies).toContain(installed);
    expect(result.dependencies).toContain(join(installed, "package.json"));
    expect(result.dependencies).toContain(
      realpathSync(join(packageRoot, "package.json")),
    );
    expect(result.dependencies).toContain(
      realpathSync(join(canonicalDependency, "package.json")),
    );
    expect(result.dependencies).not.toContain(
      join(hoistedDecoy, "package.json"),
    );
    expect(result.dependencies).not.toContain(
      join(workspaceAncestorDecoy, "package.json"),
    );
    expect(result.unresolvedParents).not.toContain(
      join(workspace, "node_modules"),
    );

    rmSync(canonicalDependency, { recursive: true, force: true });
    const ancestorResult = resolveResourceDocument({
      pack: createProjectResourcePack(fixture.root),
      rootFile: fixture.config,
    });
    expect(ancestorResult.normalized.values).toEqual({
      from: "workspace ancestor decoy",
    });
    expect(ancestorResult.dependencies).toContain(
      realpathSync(join(workspaceAncestorDecoy, "package.json")),
    );
    expect(ancestorResult.dependencies).not.toContain(
      join(hoistedDecoy, "package.json"),
    );
    expect(ancestorResult.trustedRoots).toContainEqual({
      canonical: realpathSync(workspaceAncestorDecoy),
      lexical: workspaceAncestorDecoy,
    });
    expect(ancestorResult.unresolvedParents).not.toContain(
      join(workspace, "node_modules"),
    );
  });

  test("resolves a symlinked pack dependency from a canonical workspace ancestor", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "dependency-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {
      extends: "dependency-pack",
    });

    const workspaceDependency = installedPackage(workspace, "dependency-pack");
    writeJson(join(workspaceDependency, "atlante.jsonc"), {
      values: { from: "workspace ancestor dependency" },
    });
    const projectDecoy = installedPackage(fixture.root, "dependency-pack");
    writeJson(join(projectDecoy, "atlante.jsonc"), {
      values: { from: "project decoy" },
    });

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    writeJson(join(fixture.config), { extends: "author-pack" });

    const result = resolveResourceDocument({
      pack: createProjectResourcePack(fixture.root),
      rootFile: fixture.config,
    });

    expect(result.normalized.values).toEqual({
      from: "workspace ancestor dependency",
    });
    expect(result.dependencies).toContain(
      realpathSync(join(workspaceDependency, "package.json")),
    );
    expect(result.dependencies).not.toContain(
      join(projectDecoy, "package.json"),
    );
  });

  test("reports the canonical workspace ancestor for a missing symlinked pack dependency", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "missing-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {
      extends: "missing-pack",
    });
    const workspaceNodeModules = join(workspace, "node_modules");
    mkdirSync(workspaceNodeModules);
    const localNodeModules = join(packageRoot, "node_modules");
    mkdirSync(localNodeModules);

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    writeJson(join(fixture.config), { extends: "author-pack" });

    const failure = expectFailure(
      () =>
        resolveResourceDocument({
          pack: createProjectResourcePack(fixture.root),
          rootFile: fixture.config,
        }),
      "package-not-installed",
    );
    const expectedRoot = {
      canonical: realpathSync(workspaceNodeModules),
      lexical: workspaceNodeModules,
    };

    expect(failure.unresolvedParents).toEqual(
      expect.arrayContaining([
        realpathSync(localNodeModules),
        expectedRoot.canonical,
      ]),
    );
    expect(failure.unresolvedParents).not.toContain(workspace);
    expect(failure.trustedRoots).toContainEqual(expectedRoot);
    expect(failure.trustedRoots).not.toContainEqual({
      canonical: realpathSync(localNodeModules),
      lexical: localNodeModules,
    });
    expect(failure.trustedRoots).not.toContainEqual({
      canonical: workspace,
      lexical: workspace,
    });
  });

  test("fails closed when the selected package root is retargeted before reconstruction", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "dependency-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {});
    const localNodeModules = join(packageRoot, "node_modules");
    mkdirSync(localNodeModules);
    const workspaceNodeModules = join(workspace, "node_modules");
    const dependencyRoot = installedPackage(workspace, "dependency-pack");
    writeJson(join(dependencyRoot, "atlante.jsonc"), {});

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    writeJson(join(fixture.config), { extends: "author-pack" });

    const authoringPack = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("author-pack"),
      fixture.config,
    ).pack;
    const outside = mkdtempSync(
      join(tmpdir(), "atlante-package-reconstruction-"),
    );
    created.push(outside);
    const replacement = join(outside, "replacement-pack");
    mkdirSync(replacement, { recursive: true });
    writePackManifest(replacement, "dependency-pack", { version: "9.9.9" });
    writeJson(join(replacement, "atlante.jsonc"), {});
    let retargeted = false;
    const options = {
      beforePackageRootReconstruction: (path: string) => {
        retargeted = true;
        rmSync(path, { recursive: true, force: true });
        symlinkSync(replacement, path, "dir");
      },
    };

    const failure = expectFailure(
      () =>
        resolvePackageResourcePack(
          authoringPack,
          packageLocator("dependency-pack"),
          join(installed, "atlante.jsonc"),
          options,
        ),
      "unsafe-path",
    );

    expect(retargeted).toBe(true);
    expect(failure.failure.message).toBe(
      "package root changed during resolution",
    );
    expect(failure.unresolvedParents).toEqual(
      expect.arrayContaining([
        authoringPack.root,
        realpathSync(localNodeModules),
        realpathSync(workspaceNodeModules),
      ]),
    );
    expect(failure.trustedRoots).toContainEqual({
      canonical: realpathSync(workspaceNodeModules),
      lexical: workspaceNodeModules,
    });
    expect(failure.trustedRoots).not.toContainEqual({
      canonical: realpathSync(localNodeModules),
      lexical: localNodeModules,
    });
    expect(failure.dependencies).not.toContain(outside);
    expect(failure.unresolvedParents).not.toContain(outside);
    expect(JSON.stringify(failure.failure)).not.toContain(outside);
  });

  test("fails closed when a cached package root is retargeted to an existing replacement", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "dependency-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {});
    const dependencyRoot = installedPackage(workspace, "dependency-pack");
    writeJson(join(dependencyRoot, "atlante.jsonc"), {});

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");

    const cache = createPackageResolutionCache();
    const projectPack = createProjectResourcePack(fixture.root);
    const authoringPack = resolvePackageResourcePack(
      projectPack,
      packageLocator("author-pack"),
      fixture.config,
      { cache },
    ).pack;
    const authoringFile = join(installed, "atlante.jsonc");
    const dependency = packageLocator("dependency-pack");
    const first = resolvePackageResourcePack(
      authoringPack,
      dependency,
      authoringFile,
      { cache },
    );
    expect(first.pack.root).toBe(realpathSync(dependencyRoot));

    const outside = mkdtempSync(join(tmpdir(), "atlante-package-cache-race-"));
    created.push(outside);
    const replacement = join(outside, "replacement-pack");
    mkdirSync(replacement, { recursive: true });
    writePackManifest(replacement, "dependency-pack", { version: "9.9.9" });
    writeJson(join(replacement, "atlante.jsonc"), {});
    let retargeted = false;

    const failure = expectFailure(
      () =>
        resolvePackageResourcePack(authoringPack, dependency, authoringFile, {
          cache,
          beforePackageRootReconstruction: (path: string) => {
            retargeted = true;
            rmSync(path, { recursive: true, force: true });
            symlinkSync(replacement, path, "dir");
          },
        }),
      "unsafe-path",
    );

    expect(retargeted).toBe(true);
    expect(failure.failure.message).toBe(
      "package root changed during resolution",
    );
    expect(failure.dependencies).not.toContain(outside);
    expect(failure.unresolvedParents).not.toContain(outside);
    expect(JSON.stringify(failure.failure)).not.toContain(outside);
  });

  test("treats an absent scoped parent as a missing external dependency", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "@scope/missing-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {
      extends: "@scope/missing-pack",
    });
    const localNodeModules = join(packageRoot, "node_modules");
    mkdirSync(localNodeModules);
    const workspaceNodeModules = join(workspace, "node_modules");
    mkdirSync(workspaceNodeModules);

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    writeJson(join(fixture.config), { extends: "author-pack" });

    const authoringPack = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("author-pack"),
      fixture.config,
    ).pack;
    const failure = expectFailure(
      () =>
        resolvePackageResourcePack(
          authoringPack,
          packageLocator("@scope/missing-pack"),
          join(installed, "atlante.jsonc"),
        ),
      "package-not-installed",
    );
    const expectedRoot = {
      canonical: realpathSync(workspaceNodeModules),
      lexical: workspaceNodeModules,
    };

    expect(failure.unresolvedParents).toEqual(
      expect.arrayContaining([
        realpathSync(localNodeModules),
        expectedRoot.canonical,
      ]),
    );
    expect(failure.unresolvedParents).not.toContain(workspace);
    expect(failure.trustedRoots).toContainEqual(expectedRoot);
    expect(failure.trustedRoots).not.toContainEqual({
      canonical: realpathSync(localNodeModules),
      lexical: localNodeModules,
    });
    expect(failure.trustedRoots).not.toContainEqual({
      canonical: workspace,
      lexical: workspace,
    });

    const dependencyRoot = installedPackage(workspace, "@scope/missing-pack");
    writeJson(join(dependencyRoot, "atlante.jsonc"), {
      values: { from: "scoped workspace dependency" },
    });
    const resolved = resolveResourceDocument({
      pack: createProjectResourcePack(fixture.root),
      rootFile: fixture.config,
    });
    expect(resolved.normalized.values).toEqual({
      from: "scoped workspace dependency",
    });
  });

  test("reports an existing external scoped parent as the nearest retry path", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "@scope/missing-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {
      extends: "@scope/missing-pack",
    });
    const localNodeModules = join(packageRoot, "node_modules");
    mkdirSync(localNodeModules);
    const workspaceNodeModules = join(workspace, "node_modules");
    const scopeRoot = join(workspaceNodeModules, "@scope");
    mkdirSync(scopeRoot, { recursive: true });

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    writeJson(join(fixture.config), { extends: "author-pack" });

    const failure = expectFailure(
      () =>
        resolveResourceDocument({
          pack: createProjectResourcePack(fixture.root),
          rootFile: fixture.config,
        }),
      "package-not-installed",
    );
    const expectedRoot = {
      canonical: realpathSync(workspaceNodeModules),
      lexical: workspaceNodeModules,
    };

    expect(failure.unresolvedParents).toEqual(
      expect.arrayContaining([
        realpathSync(localNodeModules),
        realpathSync(scopeRoot),
      ]),
    );
    expect(failure.unresolvedParents).not.toContain(
      realpathSync(workspaceNodeModules),
    );
    expect(failure.trustedRoots).toContainEqual(expectedRoot);
    expect(failure.trustedRoots).not.toContainEqual({
      canonical: realpathSync(scopeRoot),
      lexical: scopeRoot,
    });
  });

  test("validates resolvePackageResourcePack authoring files before lookup", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "dependency-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {});
    const dependencyRoot = installedPackage(packageRoot, "dependency-pack");
    writePackManifest(dependencyRoot, "dependency-pack");

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    const projectPack = createProjectResourcePack(fixture.root);
    const authoringPack = resolvePackageResourcePack(
      projectPack,
      packageLocator("author-pack"),
      fixture.config,
    ).pack;
    expect(authoringPack.lexicalRoot).toBe(installed);
    expect(authoringPack.package?.lexicalManifestPath).toBe(
      join(installed, "package.json"),
    );
    const dependency = packageLocator("dependency-pack");

    const relativeReads: string[] = [];
    const relativeFailure = expectFailure(
      () =>
        resolvePackageResourcePack(
          projectPack,
          packageLocator("author-pack"),
          "relative.jsonc",
          { beforeRead: (path) => relativeReads.push(path) },
        ),
      "invalid-locator",
    );
    expect(relativeReads).toEqual([]);
    expect(relativeFailure.dependencies).toEqual([]);
    expect(relativeFailure.unresolvedParents).toEqual([]);

    const outside = mkdtempSync(join(tmpdir(), "atlante-package-outside-"));
    created.push(outside);
    writeJson(join(outside, "authoring.jsonc"), {});
    const absoluteReads: string[] = [];
    const absoluteFailure = expectFailure(
      () =>
        resolvePackageResourcePack(
          authoringPack,
          dependency,
          join(outside, "authoring.jsonc"),
          { beforeRead: (path) => absoluteReads.push(path) },
        ),
      "unsafe-path",
    );
    expect(absoluteReads).toEqual([]);
    expect(absoluteFailure.dependencies).toEqual([]);
    expect(absoluteFailure.unresolvedParents).toEqual([]);

    const lexical = resolvePackageResourcePack(
      authoringPack,
      dependency,
      join(installed, "atlante.jsonc"),
    );
    const canonical = resolvePackageResourcePack(
      authoringPack,
      dependency,
      join(realpathSync(packageRoot), "atlante.jsonc"),
    );
    expect(lexical.pack.root).toBe(canonical.pack.root);
    expect(lexical.pack.root).toBe(realpathSync(dependencyRoot));
  });

  test("rejects an external symlink ancestor that re-enters the authoring pack before lookup", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "dependency-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {});
    installedPackage(packageRoot, "dependency-pack");

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");

    const outside = mkdtempSync(join(tmpdir(), "atlante-package-outside-"));
    created.push(outside);
    const externalBridge = join(outside, "bridge");
    mkdirSync(externalBridge, { recursive: true });
    symlinkSync(packageRoot, join(externalBridge, "reentry"), "dir");
    symlinkSync(externalBridge, join(installed, "external"), "dir");

    const authoringPack = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("author-pack"),
      fixture.config,
    ).pack;
    const reads: string[] = [];
    const failure = expectFailure(
      () =>
        resolvePackageResourcePack(
          authoringPack,
          packageLocator("dependency-pack"),
          join(installed, "external", "reentry", "atlante.jsonc"),
          { beforeRead: (path) => reads.push(path) },
        ),
      "unsafe-path",
    );

    expect(reads).toEqual([]);
    expect(failure.dependencies).toEqual([]);
    expect(failure.unresolvedParents).toEqual([]);
  });

  test("retains package metadata and safe retry context for package-authored failures", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "missing-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {});
    mkdirSync(join(packageRoot, "node_modules"), { recursive: true });

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");

    const authoringPack = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("author-pack"),
      fixture.config,
    ).pack;
    const metadataPaths = resourcePackMetadataPaths(authoringPack);
    const authoringFile = join(installed, "atlante.jsonc");

    const undeclared = expectFailure(
      () =>
        resolvePackageResourcePack(
          authoringPack,
          packageLocator("undeclared-pack"),
          authoringFile,
        ),
      "package-not-declared",
    );
    expect(undeclared.dependencies).toEqual(
      expect.arrayContaining([...metadataPaths]),
    );
    expect(undeclared.unresolvedParents).toEqual([authoringPack.root]);
    expect(undeclared.failure.source).toBeUndefined();
    expect(undeclared.failure.message).not.toContain(fixture.root);
    expect(JSON.stringify(undeclared.failure)).not.toContain(fixture.root);

    const unavailable = expectFailure(
      () =>
        resolvePackageResourcePack(
          authoringPack,
          packageLocator("missing-pack"),
          authoringFile,
        ),
      "package-not-installed",
    );
    expect(unavailable.dependencies).toEqual(
      expect.arrayContaining([...metadataPaths]),
    );
    expect(unavailable.unresolvedParents).toEqual([
      join(authoringPack.root, "node_modules"),
    ]);
    expect(unavailable.failure.source).toBeUndefined();
    expect(unavailable.failure.message).not.toContain(fixture.root);
    expect(JSON.stringify(unavailable.failure)).not.toContain(fixture.root);
  });

  test("retains declaration and authoring metadata for selected package metadata failures", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "broken-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {});
    const brokenRoot = installedPackage(packageRoot, "broken-pack");
    writeFileSync(join(brokenRoot, "package.json"), "{ not JSON");

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    const projectPack = createProjectResourcePack(fixture.root);
    const authoringPack = resolvePackageResourcePack(
      projectPack,
      packageLocator("author-pack"),
      fixture.config,
    ).pack;
    const authoringMetadata = resourcePackMetadataPaths(authoringPack);

    const failure = expectFailure(
      () =>
        resolvePackageResourcePack(
          authoringPack,
          packageLocator("broken-pack"),
          join(installed, "atlante.jsonc"),
        ),
      "package-metadata-unreadable",
    );

    expect(failure.dependencies).toEqual(
      expect.arrayContaining([
        ...authoringMetadata,
        realpathSync(join(brokenRoot, "package.json")),
      ]),
    );
    expect(failure.dependencies).toContain(
      realpathSync(join(packageRoot, "package.json")),
    );
    expect(failure.unresolvedParents).toContain(authoringPack.root);
    expect(failure.failure.source).toBeUndefined();
    expect(JSON.stringify(failure.failure)).not.toContain(workspace);
  });

  test("retains authoring metadata for every selected package metadata failure", () => {
    const cases: ReadonlyArray<{
      readonly code:
        | "package-metadata-unreadable"
        | "missing-pack-format"
        | "unsupported-pack-format";
      readonly prepare: (directory: string) => void;
      readonly readFailure?: boolean;
    }> = [
      {
        code: "package-metadata-unreadable",
        prepare: (directory) =>
          writeFileSync(join(directory, "package.json"), "{ not JSON"),
      },
      {
        code: "package-metadata-unreadable",
        prepare: () => {},
        readFailure: true,
      },
      {
        code: "missing-pack-format",
        prepare: (directory) =>
          writePackManifest(directory, "broken-pack", { includeFormat: false }),
      },
      {
        code: "unsupported-pack-format",
        prepare: (directory) =>
          writePackManifest(directory, "broken-pack", { format: 2 }),
      },
    ];

    for (const scenario of cases) {
      const fixture = projectRoot({ "author-pack": "file:workspace" });
      const workspace = mkdtempSync(
        join(tmpdir(), "atlante-package-workspace-"),
      );
      created.push(workspace);
      const packageRoot = join(workspace, "author-pack");
      mkdirSync(packageRoot, { recursive: true });
      writePackManifest(packageRoot, "author-pack", {
        dependencies: { "broken-pack": "1.0.0" },
      });
      writeJson(join(packageRoot, "atlante.jsonc"), {});
      const brokenRoot = installedPackage(packageRoot, "broken-pack");
      scenario.prepare(brokenRoot);

      const installed = join(fixture.root, "node_modules", "author-pack");
      mkdirSync(join(installed, ".."), { recursive: true });
      symlinkSync(packageRoot, installed, "dir");
      const authoringPack = resolvePackageResourcePack(
        createProjectResourcePack(fixture.root),
        packageLocator("author-pack"),
        fixture.config,
      ).pack;
      const authoringMetadata = resourcePackMetadataPaths(authoringPack);
      const selectedManifest = realpathSync(join(brokenRoot, "package.json"));

      const failure = expectFailure(
        () =>
          resolvePackageResourcePack(
            authoringPack,
            packageLocator("broken-pack"),
            join(installed, "atlante.jsonc"),
            scenario.readFailure
              ? {
                  beforeRead: (path) => {
                    if (path === selectedManifest)
                      throw new Error("injected metadata read failure");
                  },
                }
              : {},
          ),
        scenario.code,
      );

      expect(failure.dependencies).toEqual(
        expect.arrayContaining([...authoringMetadata, selectedManifest]),
      );
      expect(failure.unresolvedParents).toContain(authoringPack.root);
      expect(failure.failure.source).toBeUndefined();
      expect(JSON.stringify(failure.failure)).not.toContain(workspace);
    }
  });

  test("retains project declaration metadata for selected metadata failures", () => {
    const cases: ReadonlyArray<{
      readonly code: string;
      readonly prepare: (directory: string) => void;
      readonly unreadable?: boolean;
    }> = [
      {
        code: "package-metadata-unreadable",
        prepare: (directory) =>
          writeFileSync(join(directory, "package.json"), "{ not JSON"),
      },
      {
        code: "package-metadata-unreadable",
        prepare: () => {},
        unreadable: true,
      },
      {
        code: "missing-pack-format",
        prepare: (directory) =>
          writePackManifest(directory, "acme-pack", { includeFormat: false }),
      },
      {
        code: "unsupported-pack-format",
        prepare: (directory) =>
          writePackManifest(directory, "acme-pack", { format: 2 }),
      },
    ];

    for (const scenario of cases) {
      const fixture = projectRoot({ "acme-pack": "1.0.0" });
      const packageRoot = installedPackage(fixture.root, "acme-pack");
      scenario.prepare(packageRoot);
      const projectManifest = realpathSync(join(fixture.root, "package.json"));
      const selectedManifest = realpathSync(join(packageRoot, "package.json"));
      const failure = expectFailure(
        () =>
          loadPresetFacet(
            createProjectResourcePack(fixture.root),
            "acme-pack",
            fixture.config,
            scenario.unreadable
              ? {
                  beforeRead: (path) => {
                    if (path === selectedManifest)
                      throw new Error("injected metadata read failure");
                  },
                }
              : {},
          ),
        scenario.code,
      );

      expect(failure.dependencies).toEqual(
        expect.arrayContaining([projectManifest, selectedManifest]),
      );
      expect(failure.unresolvedParents).toContain(realpathSync(fixture.root));
      expect(failure.failure.source).toBeUndefined();
      expect(JSON.stringify(failure.failure)).not.toContain(fixture.root);
    }
  });

  test("revalidates project manifest identity before using cached declarations", () => {
    const fixture = projectRoot({ "first-pack": "1.0.0" });
    const firstRoot = installedPackage(fixture.root, "first-pack");
    const secondRoot = installedPackage(fixture.root, "second-pack");
    const alternateManifest = join(fixture.root, "alternate", "package.json");
    writeJson(alternateManifest, {
      name: "atlante-package-fixture-project",
      version: "1.0.0",
      dependencies: { "second-pack": "1.0.0" },
    });

    const pack = createProjectResourcePack(fixture.root);
    const cache = createPackageResolutionCache();
    const reads: string[] = [];
    const options = {
      cache,
      beforeRead: (path: string) => reads.push(path),
    };
    const first = resolvePackageResourcePack(
      pack,
      packageLocator("first-pack"),
      fixture.config,
      options,
    );
    const originalManifest = realpathSync(join(fixture.root, "package.json"));
    const originalCached = cache.projectManifests.get(pack.root);
    expect(first.pack.root).toBe(realpathSync(firstRoot));
    expect(originalCached).toMatchObject({
      manifestPath: originalManifest,
      dependencies: { "first-pack": "1.0.0" },
      optionalDependencies: {},
      devDependencies: {},
    });

    const readsAfterInitialResolution = reads.length;
    const unchanged = resolvePackageResourcePack(
      pack,
      packageLocator("first-pack"),
      fixture.config,
      options,
    );
    expect(unchanged.pack.root).toBe(realpathSync(firstRoot));
    expect(reads).toHaveLength(readsAfterInitialResolution);

    unlinkSync(join(fixture.root, "package.json"));
    symlinkSync(alternateManifest, join(fixture.root, "package.json"), "file");

    const current = resolvePackageResourcePack(
      pack,
      packageLocator("second-pack"),
      fixture.config,
      options,
    );
    const currentManifest = realpathSync(alternateManifest);
    const currentCached = cache.projectManifests.get(pack.root);
    expect(current.pack.root).toBe(realpathSync(secondRoot));
    expect(reads.filter((path) => path === currentManifest)).toHaveLength(1);
    expect(reads.filter((path) => path === originalManifest)).toHaveLength(1);
    expect(currentCached).toMatchObject({
      manifestPath: currentManifest,
      dependencies: { "second-pack": "1.0.0" },
      optionalDependencies: {},
      devDependencies: {},
    });
    expect(currentCached).not.toBe(originalCached);
  });

  test("fails closed when package authoring metadata is safely retargeted", () => {
    const fixture = projectRoot({ "author-pack": "file:workspace" });
    const workspace = mkdtempSync(join(tmpdir(), "atlante-package-workspace-"));
    created.push(workspace);
    const packageRoot = join(workspace, "author-pack");
    mkdirSync(packageRoot, { recursive: true });
    writePackManifest(packageRoot, "author-pack", {
      dependencies: { "dependency-pack": "1.0.0" },
    });
    writeJson(join(packageRoot, "atlante.jsonc"), {});
    const dependencyRoot = installedPackage(packageRoot, "dependency-pack");

    const installed = join(fixture.root, "node_modules", "author-pack");
    mkdirSync(join(installed, ".."), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");

    const cache = createPackageResolutionCache();
    const projectPack = createProjectResourcePack(fixture.root);
    const authoringPack = resolvePackageResourcePack(
      projectPack,
      packageLocator("author-pack"),
      fixture.config,
      { cache },
    ).pack;
    const authoringFile = join(installed, "atlante.jsonc");
    const dependency = packageLocator("dependency-pack");
    const first = resolvePackageResourcePack(
      authoringPack,
      dependency,
      authoringFile,
      { cache },
    );
    expect(first.pack.root).toBe(realpathSync(dependencyRoot));

    const alternateManifest = join(packageRoot, "alternate", "package.json");
    writeJson(alternateManifest, {
      name: "author-pack",
      version: "1.2.0",
      atlante: { format: 1 },
    });
    unlinkSync(join(packageRoot, "package.json"));
    symlinkSync(alternateManifest, join(packageRoot, "package.json"), "file");

    const failure = expectFailure(
      () =>
        resolvePackageResourcePack(authoringPack, dependency, authoringFile, {
          cache,
        }),
      "unsafe-path",
    );
    expect(failure.failure.message).toBe("package metadata identity changed");
    expect(failure.dependencies).toEqual(
      expect.arrayContaining([...resourcePackMetadataPaths(authoringPack)]),
    );
    expect(failure.dependencies).not.toContain(realpathSync(alternateManifest));
    expect(failure.unresolvedParents).toEqual([authoringPack.root]);
    expect(failure.failure.source).toBeUndefined();
  });

  test("keeps package origins stable and hides temporary roots from failures", () => {
    const { root, config } = projectRoot({ "acme-pack": "1.2.0" });
    const packageRoot = installedPackage(root, "acme-pack");
    const resource = writeTemplate(packageRoot);
    writeFileSync(join(resource, "template.jsonc"), "{ not JSONC");

    const failure = expectFailure(
      () =>
        loadTemplateFacet(
          createProjectResourcePack(root),
          "acme-pack/agent",
          config,
        ),
      "malformed-jsonc",
    );
    expect({
      kind: failure.failure.source?.kind,
      path: String(failure.failure.source?.path),
    }).toEqual({
      kind: "package",
      path: "acme-pack@1.2.0/agent/template.jsonc",
    });
    expect(failure.message).not.toContain(root);
    expect(JSON.stringify(failure.failure)).not.toContain(root);
  });

  test("caches package metadata and selected facets per request, not globally", () => {
    const { root, config } = projectRoot({ "acme-pack": "1.2.0" });
    const packageRoot = installedPackage(root, "acme-pack");
    writeTemplate(packageRoot);
    writeJson(join(config), {
      agents: {
        first: { $template: "acme-pack/agent", description: "First" },
        second: { $template: "acme-pack/agent", description: "Second" },
      },
    });
    let reads = 0;
    const request = {
      pack: createProjectResourcePack(root),
      rootFile: config,
      beforeRead: (_path: string) => {
        reads += 1;
      },
    };

    resolveResourceDocument(request);
    expect(reads).toBe(5);
    resolveResourceDocument(request);
    expect(reads).toBe(10);
  });

  test("retains lexical package aliases while caching canonical metadata and facets", () => {
    const { root, config } = projectRoot({ "acme-pack": "1.2.0" });
    const canonicalPackage = join(
      root,
      ".pnpm",
      "acme-pack@1.2.0",
      "node_modules",
      "acme-pack",
    );
    mkdirSync(canonicalPackage, { recursive: true });
    writePackManifest(canonicalPackage, "acme-pack");
    writeTemplate(canonicalPackage);

    const workspaceA = join(root, "workspace-a");
    const workspaceB = join(root, "workspace-b");
    const aliasA = join(workspaceA, "node_modules", "acme-pack");
    const aliasB = join(workspaceB, "node_modules", "acme-pack");
    mkdirSync(join(workspaceA, "node_modules"), { recursive: true });
    mkdirSync(join(workspaceB, "node_modules"), { recursive: true });
    symlinkSync(canonicalPackage, aliasA, "dir");
    symlinkSync(canonicalPackage, aliasB, "dir");
    writeJson(join(workspaceA, "instance", "instance.jsonc"), {
      $template: "acme-pack/agent",
      value: "a",
    });
    writeJson(join(workspaceB, "instance", "instance.jsonc"), {
      $template: "acme-pack/agent",
      value: "b",
    });
    writeJson(join(config), {
      agents: {
        first: {
          $instance: "./workspace-a/instance",
          description: "First",
        },
        second: {
          $instance: "./workspace-b/instance",
          description: "Second",
        },
      },
    });

    const reads: string[] = [];
    let result: ReturnType<typeof resolveResourceDocument>;
    try {
      result = resolveResourceDocument({
        pack: createProjectResourcePack(root),
        rootFile: config,
        beforeRead: (path) => reads.push(path),
      });
    } catch (error) {
      if (error instanceof ResourceResolutionError)
        throw new Error(
          JSON.stringify({
            failure: error.failure,
            dependencies: error.dependencies,
            unresolvedParents: error.unresolvedParents,
          }),
        );
      throw error;
    }

    const canonicalManifest = realpathSync(
      join(canonicalPackage, "package.json"),
    );
    const canonicalSchema = realpathSync(
      join(canonicalPackage, "agent", "template.jsonc"),
    );
    const canonicalSource = realpathSync(
      join(canonicalPackage, "agent", "template.md"),
    );
    for (const path of [canonicalManifest, canonicalSchema, canonicalSource])
      expect(reads.filter((read) => read === path)).toHaveLength(1);
    expect(reads).toHaveLength(7);

    for (const path of [
      aliasA,
      aliasB,
      join(aliasA, "package.json"),
      join(aliasB, "package.json"),
      join(aliasA, "agent"),
      join(aliasB, "agent"),
    ])
      expect(result.dependencies).toContain(path);
  });

  test("rejects a declared alias when cached canonical metadata names another package", () => {
    const fixture = projectRoot({
      "valid-pack": "1.0.0",
      "alias-pack": "1.0.0",
    });
    const canonicalPackage = join(
      fixture.root,
      ".pnpm",
      "valid-pack@1.0.0",
      "node_modules",
      "valid-pack",
    );
    mkdirSync(canonicalPackage, { recursive: true });
    writePackManifest(canonicalPackage, "valid-pack");
    writePackContent(canonicalPackage);

    const nodeModules = join(fixture.root, "node_modules");
    mkdirSync(nodeModules, { recursive: true });
    const validEntry = join(nodeModules, "valid-pack");
    const aliasEntry = join(nodeModules, "alias-pack");
    symlinkSync(canonicalPackage, validEntry, "dir");
    symlinkSync(canonicalPackage, aliasEntry, "dir");

    const projectManifest = realpathSync(join(fixture.root, "package.json"));
    const canonicalManifest = realpathSync(
      join(canonicalPackage, "package.json"),
    );
    const aliasManifest = join(aliasEntry, "package.json");
    const reads: string[] = [];
    const cache = createPackageResolutionCache();
    const pack = createProjectResourcePack(fixture.root);
    const options = {
      packageCache: cache,
      beforeRead: (path: string) => reads.push(path),
    };

    loadPresetFacet(pack, "valid-pack", fixture.config, options);
    const readsAfterValidResolution = reads.length;

    const failure = expectFailure(
      () => loadPresetFacet(pack, "alias-pack", fixture.config, options),
      "package-metadata-unreadable",
    );

    expect(failure.failure.message).toBe(
      "package metadata must declare the resolved package name and version",
    );
    expect(failure.failure.source).toBeUndefined();
    expect(failure.dependencies).toEqual(
      expect.arrayContaining([
        projectManifest,
        canonicalManifest,
        aliasManifest,
      ]),
    );
    expect(reads.slice(readsAfterValidResolution)).toEqual([canonicalManifest]);
    expect(failure.message).not.toContain(fixture.root);
    expect(JSON.stringify(failure.failure)).not.toContain(fixture.root);
  });
});

describe("provided package contexts", () => {
  function trustedPack(
    name: string,
    options: PackManifestOptions = {},
  ): string {
    const root = mkdtempSync(join(tmpdir(), "atlante-package-provided-"));
    created.push(root);
    writePackManifest(root, name, options);
    return root;
  }

  test("revalidates a provided pack identity from its lexical root on every request", () => {
    const fixture = projectRoot();
    const trusted = trustedPack("acme-pack", { version: "1.0.0" });
    const captured = createPackageResourcePack(trusted, "acme-pack");
    const consulted: string[] = [];
    const options = {
      resourceContext: {
        packageProvider: (name: string) => {
          consulted.push(name);
          return name === "acme-pack" ? captured : undefined;
        },
      },
    };

    const first = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("acme-pack"),
      fixture.config,
      options,
    );
    expect(first.pack.root).toBe(realpathSync(trusted));
    expect(first.pack.package?.version).toBe("1.0.0");
    expect(first.dependencies).toContain(
      realpathSync(join(trusted, "package.json")),
    );
    expect(first.dependencies).toContain(join(trusted, "package.json"));
    expect(consulted).toEqual(["acme-pack"]);

    writePackManifest(trusted, "acme-pack", { version: "1.1.0" });
    const second = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("acme-pack"),
      fixture.config,
      options,
    );
    expect(second.pack.package?.version).toBe("1.1.0");
    expect(second.pack.package?.manifestPath).toBe(
      realpathSync(join(trusted, "package.json")),
    );
    expect(captured.package?.version).toBe("1.0.0");
    expect(consulted).toEqual(["acme-pack", "acme-pack"]);
  });

  test("picks up a repaired provided-pack manifest without mutating the captured pack", () => {
    const fixture = projectRoot();
    const trusted = trustedPack("acme-pack", { version: "1.2.3" });
    const captured = createPackageResourcePack(trusted, "acme-pack");
    const authoringPack = createProjectResourcePack(fixture.root);
    const options = {
      resourceContext: { packageProvider: () => captured },
    };

    writeFileSync(join(trusted, "package.json"), "{ not JSON\n");
    const broken = expectFailure(
      () =>
        resolvePackageResourcePack(
          authoringPack,
          packageLocator("acme-pack"),
          fixture.config,
          options,
        ),
      "package-metadata-unreadable",
    );
    expect(broken.failure.message).toBe("package metadata is not valid JSON");
    expect(broken.dependencies).toContain(join(trusted, "package.json"));

    writePackManifest(trusted, "acme-pack", { version: "2.0.0" });
    const recovered = resolvePackageResourcePack(
      authoringPack,
      packageLocator("acme-pack"),
      fixture.config,
      options,
    );
    expect(recovered.pack.package?.name).toBe("acme-pack");
    expect(recovered.pack.package?.version).toBe("2.0.0");
    expect(captured.package?.version).toBe("1.2.3");
  });

  test("fails closed when a provided pack lexical root changes", () => {
    const fixture = projectRoot();
    const trusted = trustedPack("acme-pack");
    const captured = createPackageResourcePack(trusted, "acme-pack");
    const authoringPack = createProjectResourcePack(fixture.root);
    const options = {
      resourceContext: { packageProvider: () => captured },
    };

    rmSync(trusted, { recursive: true, force: true });
    const failure = expectFailure(
      () =>
        resolvePackageResourcePack(
          authoringPack,
          packageLocator("acme-pack"),
          fixture.config,
          options,
        ),
      "unsafe-path",
    );

    expect(failure.failure.message).toBe("provided package root changed");
    expect(failure.unresolvedParents).toEqual([captured.root]);
    expect(failure.trustedRoots).toContainEqual({
      canonical: captured.root,
      lexical: captured.lexicalRoot,
    });
  });

  test("falls through to declared package resolution when the provider declines", () => {
    const fixture = projectRoot({ "declared-pack": "1.0.0" });
    const declaredRoot = installedPackage(fixture.root, "declared-pack");
    writeJson(join(declaredRoot, "atlante.jsonc"), {});
    const requested: string[] = [];
    const options = {
      resourceContext: {
        packageProvider: (name: string) => {
          requested.push(name);
          return undefined;
        },
      },
    };

    const resolved = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("declared-pack"),
      fixture.config,
      options,
    );

    expect(resolved.pack.root).toBe(realpathSync(declaredRoot));
    expect(resolved.pack.package?.name).toBe("declared-pack");
    expect(requested).toEqual(["declared-pack"]);
  });

  test("never consults the provider for package-authored packs", () => {
    const fixture = projectRoot({ "author-pack": "1.0.0" });
    const authorRoot = installedPackage(fixture.root, "author-pack", {
      dependencies: { "dependency-pack": "1.0.0" },
    });
    writeJson(join(authorRoot, "atlante.jsonc"), {});
    const dependencyRoot = installedPackage(fixture.root, "dependency-pack");
    const authoringPack = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("author-pack"),
      fixture.config,
    ).pack;
    expect(authoringPack.kind).toBe("package");

    const resolved = resolvePackageResourcePack(
      authoringPack,
      packageLocator("dependency-pack"),
      join(realpathSync(authorRoot), "atlante.jsonc"),
      {
        resourceContext: {
          packageProvider: () => {
            throw new Error("provider must not be consulted");
          },
        },
      },
    );

    expect(resolved.pack.root).toBe(realpathSync(dependencyRoot));
  });

  test("fails validation when a provider supplies a differently named pack", () => {
    const fixture = projectRoot();
    const trusted = trustedPack("acme-pack");
    const captured = createPackageResourcePack(trusted, "acme-pack");

    const failure = expectFailure(
      () =>
        resolvePackageResourcePack(
          createProjectResourcePack(fixture.root),
          packageLocator("review-pack"),
          fixture.config,
          { resourceContext: { packageProvider: () => captured } },
        ),
      "package-metadata-unreadable",
    );

    expect(failure.failure.message).toBe(
      "package metadata must declare the resolved package name and version",
    );
  });

  test("caches provided packs by root within a request and revalidates across requests", () => {
    const fixture = projectRoot();
    const trusted = trustedPack("acme-pack", { version: "1.0.0" });
    const captured = createPackageResourcePack(trusted, "acme-pack");
    const context = {
      resourceContext: {
        packageProvider: (name: string) =>
          name === "acme-pack" ? captured : undefined,
      },
    };
    const cache = createPackageResolutionCache();

    const first = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("acme-pack"),
      fixture.config,
      { ...context, cache },
    );
    writePackManifest(trusted, "acme-pack", { version: "9.9.9" });
    const second = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("acme-pack"),
      fixture.config,
      { ...context, cache },
    );
    expect(second.pack).toBe(first.pack);

    const freshRequest = resolvePackageResourcePack(
      createProjectResourcePack(fixture.root),
      packageLocator("acme-pack"),
      fixture.config,
      context,
    );
    expect(freshRequest.pack.package?.version).toBe("9.9.9");
  });
});
