import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BuildResult } from "@atlante/builder";
import { buildProject } from "@atlante/builder";
import { openCodeMaterializer } from "@atlante/opencode";
import { SCHEMA_URI } from "@atlante/schema";
import {
  type InitDependencies,
  runInitWithDependencies,
} from "../src/commands/init-internal.js";
import type { PackageManagerRunner } from "../src/commands/package-manager.js";
import { firstPartyProjectContext } from "../src/first-party-pack.js";
import { runInit, runValidate } from "../src/main.js";
import { installStubPack } from "./stub-pack.js";

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-init-"));
  created.push(dir);
  // A minimal valid pack under the name init extends by default. The real
  // first-party pack is exercised by the dedicated bundled-pack tests below;
  // these tests target the init flow, not pack content.
  installStubPack(dir, { name: "@atlante/pack" });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "atlante-init-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  return dir;
}

function tempDirWithoutUserPack(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-init-no-pack-"));
  created.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "atlante-init-no-pack-fixture",
      version: "1.0.0",
    })}\n`,
  );
  return dir;
}

const EXTERNAL_PACK = "@acme/review-pack";

type ExternalPackFixture = {
  /** Dependency group the pack is declared in; false leaves it undeclared. */
  declared?: false | "dependencies" | "devDependencies" | "peerDependencies";
  installed?: boolean;
  /** Named preset directories below the pack root. */
  presets?: string[];
  /** Replacement pack manifest for malformed or unsupported fixtures. */
  manifest?: string;
};

function externalPackFixture(
  directory: string,
  options: ExternalPackFixture = {},
): string {
  const manifest: Record<string, unknown> = {
    name: "atlante-init-fixture",
    version: "1.0.0",
  };
  if (options.declared === "dependencies") {
    manifest.dependencies = { [EXTERNAL_PACK]: "1.2.3" };
  } else if (options.declared === "peerDependencies") {
    manifest.peerDependencies = { [EXTERNAL_PACK]: "1.2.3" };
  } else if (options.declared !== false) {
    manifest.devDependencies = { [EXTERNAL_PACK]: "1.2.3" };
  }
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  if (options.installed === false) return join(directory, "node_modules");
  const packageRoot = join(directory, "node_modules", "@acme", "review-pack");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, "package.json"),
    options.manifest ??
      `${JSON.stringify({
        name: EXTERNAL_PACK,
        version: "1.2.3",
        atlante: { format: 1 },
      })}\n`,
  );
  writeFileSync(join(packageRoot, "atlante.jsonc"), "{}\n");
  for (const preset of options.presets ?? []) {
    const presetRoot = join(packageRoot, preset);
    mkdirSync(presetRoot, { recursive: true });
    writeFileSync(join(presetRoot, "atlante.jsonc"), "{}\n");
  }
  return packageRoot;
}

type FakePackSpec = {
  version?: string;
  /** Named preset directories below the pack root. */
  presets?: string[];
  /** Replacement pack manifest for invalid-pack fixtures. */
  manifest?: string;
  /** Writes no root preset manifest, so discovery finds zero presets. */
  rootPreset?: false;
  /** Semver range written into devDependencies by the fake add. */
  declaredRange?: string;
};

type FakePackageManagerOptions = {
  failAdd?: boolean;
  failPlainInstall?: boolean;
  /** Installs packages into another root's node_modules (npm-style hoisting). */
  hoistNodeModulesTo?: string;
};

type FakePackageManager = {
  runner: PackageManagerRunner;
  runs: Array<{ manager: string; args: string[]; cwd: string }>;
};

/**
 * Simulates the package manager surface init depends on: an add installs the
 * registry pack, declares it as a devDependency, updates package-lock.json,
 * and creates node_modules; a plain install reconciles node_modules with the
 * manifest (installing declared packs, removing undeclared ones).
 */
function fakePackageManager(
  directory: string,
  registry: Record<string, FakePackSpec>,
  options: FakePackageManagerOptions = {},
): FakePackageManager {
  const runs: FakePackageManager["runs"] = [];

  const writePack = (name: string, spec: FakePackSpec): void => {
    const nodeModulesRoot = options.hoistNodeModulesTo ?? directory;
    const root = join(nodeModulesRoot, "node_modules", ...name.split("/"));
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      spec.manifest ??
        `${JSON.stringify({
          name,
          version: spec.version ?? "1.2.3",
          atlante: { format: 1 },
        })}\n`,
    );
    if (spec.rootPreset !== false)
      writeFileSync(join(root, "atlante.jsonc"), "{}\n");
    for (const preset of spec.presets ?? []) {
      const presetRoot = join(root, preset);
      mkdirSync(presetRoot, { recursive: true });
      writeFileSync(join(presetRoot, "atlante.jsonc"), "{}\n");
    }
  };

  const isDeclared = (name: string): boolean => {
    const manifest = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    for (const group of [
      "dependencies",
      "optionalDependencies",
      "devDependencies",
    ])
      if (manifest[group] && name in manifest[group]) return true;
    return false;
  };

  const declareDevDependency = (name: string, range: string): void => {
    const manifest = JSON.parse(
      readFileSync(join(directory, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    manifest.devDependencies = {
      ...(typeof manifest.devDependencies === "object" &&
      manifest.devDependencies !== null
        ? manifest.devDependencies
        : {}),
      [name]: range,
    };
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    writeFileSync(
      join(directory, "package-lock.json"),
      `${JSON.stringify({ lockfileVersion: 3, name: "fixture" }, null, 2)}\n`,
    );
  };

  /** Handles `npm install --save-dev <pkg>` and `add --dev <pkg>`. */
  const handleAdd = (name: string): PackageManagerRun => {
    if (options.failAdd) return { ok: false, status: 1 };
    const spec = registry[name];
    if (!spec) return { ok: false, status: 1 };
    declareDevDependency(name, spec.declaredRange ?? "1.2.3");
    writePack(name, spec);
    return { ok: true, status: 0 };
  };

  /** Removes undeclared registry packs, installs declared ones. */
  const handlePlainInstall = (): PackageManagerRun => {
    if (options.failPlainInstall) return { ok: false, status: 1 };
    for (const [name, spec] of Object.entries(registry)) {
      const root = join(directory, "node_modules", ...name.split("/"));
      if (isDeclared(name)) writePack(name, spec);
      else {
        rmSync(root, { recursive: true, force: true });
        const scopeRoot = name.split("/")[0];
        const scope = scopeRoot
          ? join(directory, "node_modules", scopeRoot)
          : root;
        try {
          if (readdirSync(scope).length === 0)
            rmSync(scope, { recursive: true, force: true });
        } catch {
          // The scope directory is already gone.
        }
      }
    }
    return { ok: true, status: 0 };
  };

  const runner: PackageManagerRunner = (manager, args, cwd) => {
    runs.push({ manager, args: [...args], cwd });
    const [verb, second, third] = args;
    // npm: install --save-dev <pkg>; pnpm: add --save-dev <pkg>;
    // yarn/bun: add --dev <pkg>.
    const isAdd =
      (verb === "install" && second === "--save-dev") || verb === "add";
    if (isAdd) return handleAdd(third as string);
    if (verb === "install") return handlePlainInstall();
    return { ok: true, status: 0 };
  };

  return { runner, runs };
}

async function captureErrors<T>(callback: () => Promise<T>): Promise<{
  result: T;
  errors: string[];
}> {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  try {
    return { result: await callback(), errors };
  } finally {
    console.error = original;
  }
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("runInit", () => {
  test("writes a bare config that validates", async () => {
    const dir = tempDirWithoutUserPack();
    writeFileSync(
      join(dir, "opencode.jsonc"),
      '{ "model": "anthropic/claude-sonnet-5" }',
    );
    expect(await runInit(dir, {})).toBe(0);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    const config = readFileSync(join(dir, "atlante.jsonc"), "utf8");
    expect(config).toContain('"extends": "@atlante/pack"');
    expect(config).not.toContain("node_modules");
    expect(config).not.toContain("package.json");
    expect(existsSync(join(dir, "resources"))).toBe(false);
    expect(existsSync(join(dir, "templates"))).toBe(false);
    expect(existsSync(join(dir, "presets"))).toBe(false);
    expect(existsSync(join(dir, ".opencode", "agents", "architect.md"))).toBe(
      true,
    );
    expect(existsSync(join(dir, ".atlante", "opencode-native.json"))).toBe(
      true,
    );
    expect(await runValidate(dir)).toBe(0);
    const opencode = JSON.parse(
      readFileSync(join(dir, "opencode.jsonc"), "utf8"),
    );
    expect(opencode.model).toBe("anthropic/claude-sonnet-5");
    expect(opencode.plugin).toBeUndefined();
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(
      ".opencode/agents/\n.opencode/skills/\n.atlante/\n",
    );
  });

  test("rejects a symlinked project root before changing init targets", async () => {
    const realRoot = tempDir();
    const linkParent = tempDir();
    const linkedRoot = join(linkParent, "linked-project");
    const target = join(realRoot, "atlante.jsonc");
    const opencode = join(realRoot, "opencode.jsonc");
    const originalTarget = '{ "existing": "config" }';
    const originalOpenCode = '{ "plugin": ["existing-plugin"] }';
    writeFileSync(target, originalTarget);
    writeFileSync(opencode, originalOpenCode);
    symlinkSync(realRoot, linkedRoot);

    const result = await captureErrors(() =>
      runInitWithDependencies(
        linkedRoot,
        { force: true },
        {
          buildProject: () => {
            throw new Error("builder should not run");
          },
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain(
      "project root must not be a symlink",
    );
    expect(readFileSync(target, "utf8")).toBe(originalTarget);
    expect(readFileSync(opencode, "utf8")).toBe(originalOpenCode);
  });

  test("builds before reporting successful initialization", async () => {
    const dir = tempDir();
    const calls: string[] = [];
    const buildProject = (target: string): BuildResult => {
      calls.push(target);
      return {
        projectRoot: dir,
        diagnostics: [],
        materializations: [],
      };
    };

    expect(await runInitWithDependencies(dir, {}, { buildProject })).toBe(0);
    expect(calls).toEqual([dir]);
  });

  test("reports a materializer failure after initialization and rolls back", async () => {
    const dir = tempDir();
    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        {},
        {
          buildProject: (projectRoot) =>
            buildProject(
              projectRoot,
              {},
              {
                materializers: [
                  {
                    host: "opencode",
                    materialize: () => ({
                      diagnostics: [
                        {
                          severity: "error",
                          code: "materialization-collision",
                          message: "injected materialization failure",
                        },
                      ],
                      writtenPaths: [],
                      removedPaths: [],
                    }),
                  },
                ],
              },
            ),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("materialization-collision");
    expect(result.errors.join("\n")).toContain(
      "injected materialization failure",
    );
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
    expect(existsSync(join(dir, ".opencode"))).toBe(false);
  });

  test("rolls back init-managed files when the build reports diagnostics", async () => {
    const dir = tempDir();
    const target = join(dir, "atlante.jsonc");
    const alternate = join(dir, "atlante.json");
    const opencode = join(dir, "opencode.jsonc");
    const originalAlternate = '{ "legacy": true }';
    const originalOpenCode = '{ "model": "demo" }';
    writeFileSync(alternate, originalAlternate);
    writeFileSync(opencode, originalOpenCode);

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { force: true },
        {
          buildProject: () => ({
            projectRoot: dir,
            diagnostics: [
              {
                severity: "error",
                code: "injected-build-failure",
                message: "build failed",
              },
            ],
            materializations: [],
          }),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("injected-build-failure");
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(alternate, "utf8")).toBe(originalAlternate);
    expect(readFileSync(opencode, "utf8")).toBe(originalOpenCode);
  });

  test("restores init state and existing native outputs after a preparation diagnostic", async () => {
    const dir = tempDir();
    const target = join(dir, "atlante.jsonc");
    const alternate = join(dir, "atlante.json");
    const opencode = join(dir, "opencode.jsonc");
    const originalAlternate = '{ "legacy": true }';
    const originalOpenCode = '{ "model": "demo" }';

    writeFileSync(
      target,
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          existing: {
            description: "Existing description",
            identity: "Existing prompt.",
            mission: "Do the work.",
          },
        },
      }),
    );
    buildProject(dir, {}, { materializers: [openCodeMaterializer] });
    const nativeManifest = join(dir, ".atlante", "opencode-native.json");
    const originalManifest = readFileSync(nativeManifest, "utf8");
    const originalAgent = readFileSync(
      join(dir, ".opencode", "agents", "existing.md"),
      "utf8",
    );
    unlinkSync(target);
    writeFileSync(alternate, originalAlternate);
    writeFileSync(opencode, originalOpenCode);

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { force: true },
        {
          buildProject: () => ({
            projectRoot: dir,
            diagnostics: [
              {
                severity: "error",
                code: "preparation-failed",
                message: "injected preparation diagnostic",
              },
            ],
            materializations: [],
          }),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("preparation-failed");
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(alternate, "utf8")).toBe(originalAlternate);
    expect(readFileSync(opencode, "utf8")).toBe(originalOpenCode);
    expect(readFileSync(nativeManifest, "utf8")).toBe(originalManifest);
    expect(
      readFileSync(join(dir, ".opencode", "agents", "existing.md"), "utf8"),
    ).toBe(originalAgent);
  });

  test("rolls back before a throwing diagnostic reporter runs", async () => {
    const dir = tempDir();
    const target = join(dir, "atlante.jsonc");
    const alternate = join(dir, "atlante.json");
    const opencode = join(dir, "opencode.jsonc");
    const originalAlternate = '{ "legacy": true }';
    const originalOpenCode = '{ "plugin": ["existing-plugin"] }';
    writeFileSync(
      target,
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          existing: {
            description: "Existing description",
            identity: "Existing prompt.",
            mission: "Do the work.",
          },
        },
      }),
    );
    buildProject(dir, {}, { materializers: [openCodeMaterializer] });
    const nativeManifest = join(dir, ".atlante", "opencode-native.json");
    const originalManifest = readFileSync(nativeManifest, "utf8");
    unlinkSync(target);
    writeFileSync(alternate, originalAlternate);
    writeFileSync(opencode, originalOpenCode);

    const originalError = console.error;
    console.error = () => {
      throw new Error("throwing diagnostic reporter");
    };
    try {
      await expect(
        runInitWithDependencies(
          dir,
          { force: true },
          {
            buildProject: () => ({
              projectRoot: dir,
              diagnostics: [
                {
                  severity: "error",
                  code: "injected-build-failure",
                  message: "build failed",
                },
              ],
              materializations: [],
            }),
          },
        ),
      ).rejects.toThrow("throwing diagnostic reporter");
    } finally {
      console.error = originalError;
    }

    expect(existsSync(target)).toBe(false);
    expect(readFileSync(alternate, "utf8")).toBe(originalAlternate);
    expect(readFileSync(opencode, "utf8")).toBe(originalOpenCode);
    expect(readFileSync(nativeManifest, "utf8")).toBe(originalManifest);
  });

  test("preserves the previous native outputs when materialization fails", async () => {
    const dir = tempDir();
    const target = join(dir, "atlante.jsonc");
    const originalConfig = `{ "$schema": "${SCHEMA_URI}" }`;
    writeFileSync(target, originalConfig);
    buildProject(dir, {}, { materializers: [openCodeMaterializer] });
    const nativeManifest = join(dir, ".atlante", "opencode-native.json");
    const originalManifest = readFileSync(nativeManifest, "utf8");

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { force: true },
        {
          buildProject: (projectRoot) =>
            buildProject(
              projectRoot,
              {},
              {
                materializers: [
                  {
                    host: "opencode",
                    materialize: () => ({
                      diagnostics: [
                        {
                          severity: "error",
                          code: "materialization-publication-failed",
                          message: "injected build materialization failure",
                        },
                      ],
                      writtenPaths: [],
                      removedPaths: [],
                    }),
                  },
                ],
              },
            ),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain(
      "injected build materialization failure",
    );
    expect(readFileSync(target, "utf8")).toBe(originalConfig);
    expect(readFileSync(nativeManifest, "utf8")).toBe(originalManifest);
    expect(existsSync(join(dir, "opencode.jsonc"))).toBe(false);
  });

  test("the bare config has no workflow slot", async () => {
    const dir = tempDir();
    await runInitWithDependencies(dir, {}, {});
    const text = readFileSync(join(dir, "atlante.jsonc"), "utf8");
    expect(text).not.toContain("workflow");
  });

  test("--pack installs an undeclared pack, declares it as a devDependency, and selects its default preset", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, { [EXTERNAL_PACK]: {} });

    expect(
      await runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        { runPackageManager: packManager.runner },
      ),
    ).toBe(0);
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      `"extends": "${EXTERNAL_PACK}"`,
    );
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    expect(manifest.devDependencies?.[EXTERNAL_PACK]).toBe("1.2.3");
    expect(existsSync(join(dir, ".atlante", "opencode-native.json"))).toBe(
      true,
    );
    expect(await runValidate(dir)).toBe(0);
    expect(packManager.runs).toEqual([
      {
        manager: "npm",
        args: ["install", "--save-dev", EXTERNAL_PACK],
        cwd: dir,
      },
    ]);
  });

  test("--pack supports a named preset locator without prompting", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, {
      [EXTERNAL_PACK]: { presets: ["strict"] },
    });

    expect(
      await runInitWithDependencies(
        dir,
        { pack: `${EXTERNAL_PACK}/strict` },
        { runPackageManager: packManager.runner },
      ),
    ).toBe(0);
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      '"extends": "@acme/review-pack/strict"',
    );
    expect(await runValidate(dir)).toBe(0);
  });

  test("--pack auto-selects the single preset of a pack without prompting", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, { [EXTERNAL_PACK]: {} });
    let prompted = false;

    expect(
      await runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
          isInteractive: () => false,
          prompt: async () => {
            prompted = true;
            return "1";
          },
        },
      ),
    ).toBe(0);
    expect(prompted).toBe(false);
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      `"extends": "${EXTERNAL_PACK}"`,
    );
  });

  test("--pack prompts to select among multiple presets on an interactive terminal", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, {
      [EXTERNAL_PACK]: { presets: ["minimal", "strict"] },
    });

    expect(
      await runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
          isInteractive: () => true,
          prompt: async () => "2",
        },
      ),
    ).toBe(0);
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      '"extends": "@acme/review-pack/minimal"',
    );
  });

  test("--pack fails with an actionable error and full rollback for multiple presets in a non-interactive terminal", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, {
      [EXTERNAL_PACK]: { presets: ["minimal", "strict"] },
    });
    const opencodePath = join(dir, "opencode.jsonc");
    const originalOpenCode = '{ "model": "demo" }';
    writeFileSync(opencodePath, originalOpenCode);

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
          isInteractive: () => false,
        },
      ),
    );

    expect(result.result).toBe(1);
    const errors = result.errors.join("\n");
    expect(errors).toContain("pack-prompt-required");
    expect(errors).toContain(`${EXTERNAL_PACK}, ${EXTERNAL_PACK}/minimal`);
    expect(errors).toContain("atlante init --pack @acme/review-pack/<preset>");
    expect(readFileSync(opencodePath, "utf8")).toBe(originalOpenCode);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
    // The dependency mutation is rolled back: the manifest and node_modules
    // are reconciled with the pre-init state.
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    expect(manifest.devDependencies).toBeUndefined();
    expect(existsSync(join(dir, "node_modules", "@acme"))).toBe(false);
    expect(packManager.runs.length).toBe(2);
    expect(packManager.runs[1]?.args).toEqual(["install"]);
  });

  test("an aborted preset prompt rolls back the dependency mutation", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, {
      [EXTERNAL_PACK]: { presets: ["minimal", "strict"] },
    });

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
          isInteractive: () => true,
          prompt: async () => {
            throw new Error("stdin closed");
          },
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("pack-prompt-aborted");
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    expect(manifest.devDependencies).toBeUndefined();
    expect(existsSync(join(dir, "node_modules", "@acme"))).toBe(false);
  });

  test("skips installation for a declared and installed pack and never moves its declaration", async () => {
    const dir = tempDirWithoutUserPack();
    externalPackFixture(dir, { declared: "dependencies" });
    const before = readFileSync(join(dir, "package.json"), "utf8");
    const packManager = fakePackageManager(dir, {});

    expect(
      await runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        { runPackageManager: packManager.runner },
      ),
    ).toBe(0);
    expect(packManager.runs).toEqual([]);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      `"extends": "${EXTERNAL_PACK}"`,
    );
  });

  test("installs a pack declared only in peerDependencies, because peer-only declarations do not resolve", async () => {
    const dir = tempDirWithoutUserPack();
    externalPackFixture(dir, { declared: "peerDependencies" });
    const packManager = fakePackageManager(dir, { [EXTERNAL_PACK]: {} });

    expect(
      await runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        { runPackageManager: packManager.runner },
      ),
    ).toBe(0);
    expect(packManager.runs).toEqual([
      {
        manager: "npm",
        args: ["install", "--save-dev", EXTERNAL_PACK],
        cwd: dir,
      },
    ]);
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    // The existing peer declaration is preserved, not moved or replaced.
    expect(manifest.peerDependencies?.[EXTERNAL_PACK]).toBe("1.2.3");
    expect(manifest.devDependencies?.[EXTERNAL_PACK]).toBe("1.2.3");
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      `"extends": "${EXTERNAL_PACK}"`,
    );
  });

  test("reconciles a declared but not installed pack with a plain install", async () => {
    const dir = tempDirWithoutUserPack();
    externalPackFixture(dir, { declared: "devDependencies", installed: false });
    const packManager = fakePackageManager(dir, { [EXTERNAL_PACK]: {} });

    expect(
      await runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        { runPackageManager: packManager.runner },
      ),
    ).toBe(0);
    expect(packManager.runs).toEqual([
      { manager: "npm", args: ["install"], cwd: dir },
    ]);
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    expect(manifest.devDependencies?.[EXTERNAL_PACK]).toBe("1.2.3");
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      `"extends": "${EXTERNAL_PACK}"`,
    );
  });

  test("reports a failed installation with the package manager command and restores the manifest", async () => {
    const dir = tempDirWithoutUserPack();
    const before = readFileSync(join(dir, "package.json"), "utf8");
    const packManager = fakePackageManager(dir, {});

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
        },
      ),
    );

    expect(result.result).toBe(1);
    const errors = result.errors.join("\n");
    expect(errors).toContain("pack-installation-failed");
    expect(errors).toContain("install --save-dev");
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test("rejects a malformed pack locator before touching the project", async () => {
    const dir = tempDirWithoutUserPack();
    const before = readFileSync(join(dir, "package.json"), "utf8");
    const packManager = fakePackageManager(dir, {});

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: "@acme//review-pack" },
        {
          runPackageManager: packManager.runner,
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("invalid-pack-locator");
    expect(packManager.runs).toEqual([]);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test("treats a bare package name as a pack locator instead of an alias", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, {});

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: "starter" },
        {
          runPackageManager: packManager.runner,
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("pack-installation-failed");
    // A failed add never mutated the manifest, so no post-rollback
    // reconciliation install runs.
    expect(packManager.runs).toEqual([
      {
        manager: "npm",
        args: ["install", "--save-dev", "starter"],
        cwd: dir,
      },
    ]);
  });

  test("detects the manager from the nearest ancestor lockfile", async () => {
    // A pnpm workspace: the shared lockfile lives at the root, while the
    // project init runs in is the `app` workspace member.
    const workspace = tempDirWithoutUserPack();
    const app = join(workspace, "packages", "app");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9'\n");
    writeFileSync(
      join(app, "package.json"),
      `${JSON.stringify({ name: "app", version: "1.0.0" }, null, 2)}\n`,
    );
    const packManager = fakePackageManager(app, { [EXTERNAL_PACK]: {} });

    const result = await captureErrors(() =>
      runInitWithDependencies(
        app,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
          isInteractive: () => false,
        },
      ),
    );

    expect(result.result).toBe(0);
    // The manager is detected from the ancestor lockfile, but the package
    // manager still runs in the project directory, where the declaration
    // belongs.
    expect(packManager.runs).toEqual([
      {
        manager: "pnpm",
        args: ["add", "--save-dev", EXTERNAL_PACK],
        cwd: app,
      },
    ]);
    const manifest = JSON.parse(
      readFileSync(join(app, "package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    expect(manifest.devDependencies?.[EXTERNAL_PACK]).toBe("1.2.3");
    expect(readFileSync(join(app, "atlante.jsonc"), "utf8")).toContain(
      `"extends": "${EXTERNAL_PACK}"`,
    );
  });

  test("restores the workspace root lockfile when init fails after the install", async () => {
    const workspace = tempDirWithoutUserPack();
    const app = join(workspace, "packages", "app");
    mkdirSync(app, { recursive: true });
    const rootLockfile = join(workspace, "pnpm-lock.yaml");
    const originalLockfile = "lockfileVersion: '9'\n";
    writeFileSync(rootLockfile, originalLockfile);
    writeFileSync(
      join(app, "package.json"),
      `${JSON.stringify({ name: "app", version: "1.0.0" }, null, 2)}\n`,
    );
    const packManager = fakePackageManager(app, {
      [EXTERNAL_PACK]: { presets: ["minimal", "strict"] },
    });

    const result = await captureErrors(() =>
      runInitWithDependencies(
        app,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: (manager, args, cwd) => {
            const run = packManager.runner(manager, args, cwd);
            // Model the package manager rewriting the shared root lockfile
            // on the add; the post-rollback reconcile must not re-mutate it.
            if (run.ok && args.includes("--save-dev"))
              writeFileSync(
                rootLockfile,
                "lockfileVersion: '9.0'\n\nnew: true\n",
              );
            return run;
          },
          isInteractive: () => false,
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("pack-prompt-required");
    // The rollback restores the root lockfile and the member manifest.
    expect(readFileSync(rootLockfile, "utf8")).toBe(originalLockfile);
    const manifest = JSON.parse(
      readFileSync(join(app, "package.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    expect(manifest.devDependencies).toBeUndefined();
    expect(existsSync(join(app, "atlante.jsonc"))).toBe(false);
  });

  test("rejects an install hoisted above the project's node_modules and rolls it back", async () => {
    // A pack resolves only from the project root's own node_modules, matching
    // @atlante/resources. npm/bun workspace hoisting to a shared root is not
    // resolvable from a member, so init fails honestly and restores state.
    const workspace = tempDirWithoutUserPack();
    const app = join(workspace, "packages", "app");
    mkdirSync(app, { recursive: true });
    const rootLockfile = join(workspace, "pnpm-lock.yaml");
    const originalLockfile = "lockfileVersion: '9'\n";
    writeFileSync(rootLockfile, originalLockfile);
    writeFileSync(
      join(app, "package.json"),
      `${JSON.stringify({ name: "app", version: "1.0.0" }, null, 2)}\n`,
    );
    const packManager = fakePackageManager(
      app,
      { [EXTERNAL_PACK]: {} },
      { hoistNodeModulesTo: workspace },
    );

    const result = await captureErrors(() =>
      runInitWithDependencies(
        app,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
          isInteractive: () => false,
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("pack-not-installed");
    // The hoisting is explained: the install resolved at the workspace root,
    // so the generic install hint would be a dead end.
    expect(result.errors.join("\n")).toContain(`workspace root ${workspace}`);
    expect(result.errors.join("\n")).not.toContain("`pnpm install` manually");
    // The hoisted install is not accepted, and the transaction still restores
    // the member manifest and the shared root lockfile.
    const manifest = JSON.parse(
      readFileSync(join(app, "package.json"), "utf8"),
    ) as Record<string, Record<string, unknown>>;
    expect(manifest.devDependencies).toBeUndefined();
    expect(readFileSync(rootLockfile, "utf8")).toBe(originalLockfile);
    expect(existsSync(join(app, "atlante.jsonc"))).toBe(false);
  });

  test("keeps the generic install hint without a hoisting dependency root", async () => {
    // With no ancestor lockfile the dependency root is the project itself, so
    // a missing entry is an ordinary install failure and the generic hint is
    // still the right recovery.
    const dir = tempDirWithoutUserPack();

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          // The add "succeeds" but places nothing in the project's own
          // node_modules, so the entry check fails with no hoisting involved.
          runPackageManager: () => ({ ok: true, status: 0 }),
          isInteractive: () => false,
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("pack-not-installed");
    expect(result.errors.join("\n")).toContain("manually");
    expect(result.errors.join("\n")).not.toContain("workspace root");
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test("surfaces the spawn error when the package manager binary is missing", async () => {
    const dir = tempDirWithoutUserPack();

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: () => ({
            ok: false,
            status: null,
            error: "spawn npm ENOENT",
          }),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("spawn npm ENOENT");
  });

  test("requires a package.json manifest for pack selection", async () => {
    const dir = tempDirWithoutUserPack();
    rmSync(join(dir, "package.json"));

    const result = await captureErrors(() =>
      runInitWithDependencies(dir, { pack: EXTERNAL_PACK }, {}),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("pack-manifest-required");
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test("rejects a malformed package.json before installing", async () => {
    const dir = tempDirWithoutUserPack();
    writeFileSync(join(dir, "package.json"), "{ malformed");
    const packManager = fakePackageManager(dir, { [EXTERNAL_PACK]: {} });

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("invalid-pack-manifest");
    expect(packManager.runs).toEqual([]);
  });

  test("reports an installed pack that is not a valid Atlante pack and rolls back", async () => {
    const dir = tempDirWithoutUserPack();
    const before = readFileSync(join(dir, "package.json"), "utf8");
    const packManager = fakePackageManager(dir, {
      [EXTERNAL_PACK]: {
        manifest: `${JSON.stringify({
          name: EXTERNAL_PACK,
          version: "1.2.3",
          atlante: { format: 2 },
        })}\n`,
      },
    });

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("invalid-pack");
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
    expect(existsSync(join(dir, "node_modules", "@acme"))).toBe(false);
  });

  test("reports a pack that provides no presets", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, {
      [EXTERNAL_PACK]: { rootPreset: false },
    });

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("provides no presets");
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    expect(manifest.devDependencies).toBeUndefined();
  });

  test("reports an unknown named preset with the available presets", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, {
      [EXTERNAL_PACK]: { presets: ["strict"] },
    });

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: `${EXTERNAL_PACK}/missing` },
        { runPackageManager: packManager.runner },
      ),
    );

    expect(result.result).toBe(1);
    const errors = result.errors.join("\n");
    expect(errors).toContain("pack-preset-not-found");
    expect(errors).toContain(`${EXTERNAL_PACK}/missing`);
    expect(errors).toContain(`${EXTERNAL_PACK}/strict`);
  });

  test.each([
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
    [undefined, "npm"],
  ] as const)(
    "detects %s as the %s package manager for installation",
    async (lockfile, manager) => {
      const dir = tempDirWithoutUserPack();
      if (lockfile) writeFileSync(join(dir, lockfile), "");
      const packManager = fakePackageManager(dir, { [EXTERNAL_PACK]: {} });

      expect(
        await runInitWithDependencies(
          dir,
          { pack: EXTERNAL_PACK },
          { runPackageManager: packManager.runner },
        ),
      ).toBe(0);
      expect(packManager.runs[0]?.manager).toBe(manager);
      expect(packManager.runs[0]?.args).toContain(EXTERNAL_PACK);
    },
  );

  test("rolls back the dependency mutation when the build fails", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(dir, { [EXTERNAL_PACK]: {} });
    const originalOpenCode = '{ "model": "demo" }';
    const originalLockfile = "{}";
    writeFileSync(join(dir, "opencode.jsonc"), originalOpenCode);
    writeFileSync(join(dir, "package-lock.json"), originalLockfile);

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK, force: true },
        {
          runPackageManager: packManager.runner,
          buildProject: () => ({
            projectRoot: dir,
            diagnostics: [
              {
                severity: "error",
                code: "injected-build-failure",
                message: "build failed",
              },
            ],
            materializations: [],
          }),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("injected-build-failure");
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
    expect(readFileSync(join(dir, "opencode.jsonc"), "utf8")).toBe(
      originalOpenCode,
    );
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    expect(manifest.devDependencies).toBeUndefined();
    expect(readFileSync(join(dir, "package-lock.json"), "utf8")).toBe(
      originalLockfile,
    );
    expect(existsSync(join(dir, "node_modules", "@acme"))).toBe(false);
    expect(packManager.runs.length).toBe(2);
  });

  test("reports a rollback-failed error when dependency reconciliation fails", async () => {
    const dir = tempDirWithoutUserPack();
    const packManager = fakePackageManager(
      dir,
      { [EXTERNAL_PACK]: {} },
      { failPlainInstall: true },
    );

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        {
          runPackageManager: packManager.runner,
          buildProject: () => ({
            projectRoot: dir,
            diagnostics: [
              {
                severity: "error",
                code: "injected-build-failure",
                message: "build failed",
              },
            ],
            materializations: [],
          }),
        },
      ),
    );

    expect(result.result).toBe(1);
    const errors = result.errors.join("\n");
    expect(errors).toContain("rollback-failed");
    expect(errors).toContain("run `npm install` in the project root");
  });

  test("--pack @atlante/pack uses the bundled first-party pack without installing", async () => {
    const dir = tempDirWithoutUserPack();
    const before = readFileSync(join(dir, "package.json"), "utf8");

    expect(
      await runInitWithDependencies(
        dir,
        { pack: "@atlante/pack" },
        {
          context: firstPartyProjectContext(),
          runPackageManager: () => {
            throw new Error(
              "package manager must not run for the first-party pack",
            );
          },
        },
      ),
    ).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      '"extends": "@atlante/pack"',
    );
    expect(existsSync(join(dir, ".atlante", "opencode-native.json"))).toBe(
      true,
    );
  });

  test("rolls back external pack init after a build failure and preserves native outputs", async () => {
    const dir = tempDirWithoutUserPack();
    externalPackFixture(dir);
    const target = join(dir, "atlante.jsonc");
    const opencode = join(dir, "opencode.jsonc");
    const originalConfig = `{ "$schema": "${SCHEMA_URI}", "values": { "old": "yes" } }`;
    const originalOpenCode = '{ "model": "demo" }';
    writeFileSync(target, originalConfig);
    writeFileSync(opencode, originalOpenCode);
    buildProject(dir, {}, { materializers: [openCodeMaterializer] });
    const nativeManifest = join(dir, ".atlante", "opencode-native.json");
    const originalManifest = readFileSync(nativeManifest, "utf8");

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { force: true, pack: EXTERNAL_PACK },
        {
          buildProject: () => ({
            projectRoot: dir,
            diagnostics: [
              {
                severity: "error",
                code: "injected-build-failure",
                message: "build failed",
              },
            ],
            materializations: [],
          }),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(originalConfig);
    expect(readFileSync(opencode, "utf8")).toBe(originalOpenCode);
    expect(readFileSync(nativeManifest, "utf8")).toBe(originalManifest);
  });

  test("does not create an OpenCode configuration", async () => {
    const dir = tempDir();
    await runInitWithDependencies(dir, {}, {});
    expect(existsSync(join(dir, "opencode.jsonc"))).toBe(false);
    expect(existsSync(join(dir, "opencode.json"))).toBe(false);
  });

  test("creates .gitignore with the ignore policy entries on a fresh init", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toBe(
      ".opencode/agents/\n.opencode/skills/\n.atlante/\n",
    );
    expect(existsSync(join(dir, ".opencode", "agents", "architect.md"))).toBe(
      true,
    );
    expect(
      existsSync(join(dir, ".opencode", "skills", "plan", "SKILL.md")),
    ).toBe(true);
    expect(existsSync(join(dir, ".atlante", "opencode-native.json"))).toBe(
      true,
    );
  });

  test("preserves an existing opencode.jsonc without a registration", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    const original = `{ "model": "anthropic/claude-sonnet-5" }`;
    writeFileSync(path, original);
    await runInitWithDependencies(dir, {}, {});
    const opencode = JSON.parse(readFileSync(path, "utf8"));
    expect(opencode.model).toBe("anthropic/claude-sonnet-5");
    expect(opencode.plugin).toBeUndefined();
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  test("preserves an existing host configuration with a stale Atlante plugin", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.json");
    const original = `{ "model": "anthropic/claude-sonnet-5", "plugin": ["@atlante/opencode"] }`;
    writeFileSync(path, original);

    expect(await runInitWithDependencies(dir, {}, {})).toBe(0);

    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(join(dir, "opencode.jsonc"))).toBe(false);
  });

  test("preserves malformed existing OpenCode configuration", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    const original = '{ "model": "demo",';
    writeFileSync(path, original);

    expect(await runInit(dir, {})).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  test("appends only missing .gitignore entries without touching existing content", async () => {
    const dir = tempDir();
    const gitignore = join(dir, ".gitignore");
    const original = "# Generated outputs\nnode_modules/\n.opencode/agents/\n";
    writeFileSync(gitignore, original);

    expect(await runInitWithDependencies(dir, {}, {})).toBe(0);
    expect(readFileSync(gitignore, "utf8")).toBe(
      `${original}\n.opencode/skills/\n.atlante/\n`,
    );

    // A second init run is idempotent: nothing is rewritten or duplicated.
    const afterFirst = readFileSync(gitignore, "utf8");
    expect(await runInitWithDependencies(dir, { force: true }, {})).toBe(0);
    expect(readFileSync(gitignore, "utf8")).toBe(afterFirst);
  });

  test("leaves a .gitignore that already has every policy entry untouched", async () => {
    const dir = tempDir();
    const gitignore = join(dir, ".gitignore");
    const original =
      ".opencode/agents/\n.opencode/skills/\n.atlante/\n# keep\n";
    writeFileSync(gitignore, original);

    expect(await runInitWithDependencies(dir, {}, {})).toBe(0);
    expect(readFileSync(gitignore, "utf8")).toBe(original);
  });

  test("turns target write failures into an exit code", async () => {
    const dir = tempDir();
    const target = join(dir, "atlante.jsonc");
    const dependencies: InitDependencies = {
      writeFileSync: (path) => {
        if (path === target) throw new Error("injected target write failure");
        writeFileSync(path, "{}");
      },
    };

    const result = await captureErrors(() =>
      runInitWithDependencies(dir, {}, dependencies),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("injected target write failure");
    expect(existsSync(target)).toBe(false);
  });

  test("restores a preexisting target after a partial forced write failure", async () => {
    const dir = tempDir();
    const target = join(dir, "atlante.jsonc");
    const originalTarget = "preexisting target";
    writeFileSync(target, originalTarget);
    let failed = false;
    const dependencies: InitDependencies = {
      writeFileSync: (path, contents) => {
        if (path === target && !failed) {
          failed = true;
          writeFileSync(path, "partially written target");
          throw new Error("injected partial target write failure");
        }
        writeFileSync(path, contents);
      },
    };

    const result = await captureErrors(() =>
      runInitWithDependencies(dir, { force: true }, dependencies),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain(
      "injected partial target write failure",
    );
    expect(readFileSync(target, "utf8")).toBe(originalTarget);
  });

  test("turns alternate unlink failures into an exit code without removing it", async () => {
    const dir = tempDir();
    const alternate = join(dir, "atlante.json");
    writeFileSync(alternate, "{}");
    const dependencies: InitDependencies = {
      unlinkSync: (path) => {
        if (path === alternate) throw new Error("injected unlink failure");
        unlinkSync(path);
      },
    };

    const result = await captureErrors(() =>
      runInitWithDependencies(dir, { force: true }, dependencies),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("injected unlink failure");
    expect(existsSync(alternate)).toBe(true);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
    expect(existsSync(join(dir, "opencode.jsonc"))).toBe(false);
  });

  test("--force overwrites altered configuration contents", async () => {
    const dir = tempDir();
    await runInitWithDependencies(dir, {}, {});
    const target = join(dir, "atlante.jsonc");
    writeFileSync(target, "altered contents");

    expect(await runInitWithDependencies(dir, { force: true }, {})).toBe(0);
    const contents = readFileSync(target, "utf8");
    expect(contents).not.toBe("altered contents");
    expect(contents).toContain('"$schema"');
    expect(contents).toContain('"extends"');
  });

  test("refuses to overwrite an existing config without --force", async () => {
    const dir = tempDir();
    await runInitWithDependencies(dir, {}, {});
    expect(await runInitWithDependencies(dir, {}, {})).toBe(1);
  });

  test("refuses when only atlante.json already exists", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "atlante.json"),
      JSON.stringify({
        $schema: "https://atlante.sh/schema/v0.1/schema.json",
        agents: {},
      }),
    );
    expect(await runInit(dir, {})).toBe(1);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test("refuses an ambiguous pre-state without --force", async () => {
    const dir = tempDir();
    await runInitWithDependencies(dir, {}, {});
    writeFileSync(join(dir, "atlante.json"), "{}");

    expect(await runInitWithDependencies(dir, {}, {})).toBe(1);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "atlante.json"))).toBe(true);
  });

  test("--force writes the default file and removes an alternate config", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "atlante.json"),
      JSON.stringify({
        $schema: "https://atlante.sh/schema/v0.1/schema.json",
        agents: {},
      }),
    );

    expect(await runInitWithDependencies(dir, { force: true }, {})).toBe(0);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "atlante.json"))).toBe(false);
    expect(await runValidate(dir, {})).toBe(0);
  });

  test("--force resolves an ambiguous pre-state without leaving both files", async () => {
    const dir = tempDir();
    await runInitWithDependencies(dir, {}, {});
    writeFileSync(
      join(dir, "atlante.json"),
      JSON.stringify({
        $schema: "https://atlante.sh/schema/v0.1/schema.json",
        agents: {},
      }),
    );

    expect(await runInitWithDependencies(dir, { force: true }, {})).toBe(0);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "atlante.json"))).toBe(false);
  });

  test("runs the configuration preflight before any pack installation", async () => {
    const dir = tempDir();
    await runInitWithDependencies(dir, {}, {});
    const packManager = fakePackageManager(dir, {});
    const before = readFileSync(join(dir, "package.json"), "utf8");

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { pack: EXTERNAL_PACK },
        { runPackageManager: packManager.runner },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("configuration-exists");
    expect(packManager.runs).toEqual([]);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
  });
});
