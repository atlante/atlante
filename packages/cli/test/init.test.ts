import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildResult } from "@atlante/builder";
import { buildProject } from "@atlante/builder";
import { readArtifacts } from "@atlante/builder/artifacts";
import { SCHEMA_URI } from "@atlante/schema";
import {
  type InitDependencies,
  runInitWithDependencies,
} from "../src/commands/init-internal.js";
import { runInit, runValidate } from "../src/main.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-init-"));
  created.push(dir);
  cpSync(firstPartyPackRoot, join(dir, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
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

function installExternalPreset(
  directory: string,
  options: {
    declared?: boolean;
    manifest?: string;
    format?: number;
    named?: boolean;
    wrongFacet?: boolean;
  } = {},
): string {
  const packageRoot = join(directory, "node_modules", "@acme", "review-pack");
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({
      name: "atlante-init-external-fixture",
      version: "1.0.0",
      ...(options.declared === false
        ? {}
        : { devDependencies: { "@acme/review-pack": "1.2.3" } }),
    })}\n`,
  );
  writeFileSync(
    join(packageRoot, "package.json"),
    options.manifest ??
      `${JSON.stringify({
        name: "@acme/review-pack",
        version: "1.2.3",
        atlante: { format: options.format ?? 1 },
      })}\n`,
  );
  if (options.wrongFacet) {
    const facet = join(packageRoot, "agent");
    mkdirSync(facet);
    writeFileSync(join(facet, "template.jsonc"), '{ "$schema": "x" }\n');
    writeFileSync(join(facet, "template.md"), "Review.\n");
  } else {
    writeFileSync(join(packageRoot, "atlante.jsonc"), "{}\n");
    if (options.named) {
      const named = join(packageRoot, "strict");
      mkdirSync(named);
      writeFileSync(join(named, "atlante.jsonc"), "{}\n");
    }
  }
  return packageRoot;
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
    expect(
      existsSync(join(dir, ".atlante", "artifacts", "manifest.json")),
    ).toBe(true);
    expect(await runValidate(dir)).toBe(0);
    const opencode = JSON.parse(
      readFileSync(join(dir, "opencode.jsonc"), "utf8"),
    );
    expect(opencode.model).toBe("anthropic/claude-sonnet-5");
    expect(opencode.plugin).toContain("@atlante/opencode");
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

  test("builds artifacts before reporting successful initialization", async () => {
    const dir = tempDir();
    const calls: string[] = [];
    const buildProject = (target: string): BuildResult => {
      calls.push(target);
      return {
        projectRoot: dir,
        artifactsPath: join(dir, ".atlante", "artifacts"),
        diagnostics: [],
        warnings: [],
      };
    };

    expect(await runInitWithDependencies(dir, {}, { buildProject })).toBe(0);
    expect(calls).toEqual([dir]);
  });

  test("reports builder warnings after successful initialization", async () => {
    const dir = tempDir();
    let injected = false;
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
                fault: (operation, path) => {
                  if (
                    !injected &&
                    operation === "sync-directory" &&
                    path === join(projectRoot, ".atlante")
                  ) {
                    injected = true;
                    throw new Error("injected publication warning");
                  }
                },
              },
            ),
        },
      ),
    );

    expect(result.result).toBe(0);
    expect(result.errors.join("\n")).toContain(
      "warning [post-publication-sync-failed]: unable to sync published artifact directory: injected publication warning",
    );
    expect(
      existsSync(join(dir, ".atlante", "artifacts", "manifest.json")),
    ).toBe(true);
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
            artifactsPath: join(dir, ".atlante", "artifacts"),
            diagnostics: [
              {
                severity: "error",
                code: "injected-build-failure",
                message: "build failed",
              },
            ],
            warnings: [],
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

  test("restores init state and existing artifacts after a preparation diagnostic", async () => {
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
    buildProject(dir);
    const originalManifest = readFileSync(
      join(dir, ".atlante", "artifacts", "manifest.json"),
      "utf8",
    );
    const originalArtifacts = readArtifacts(dir);
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
            artifactsPath: join(dir, ".atlante", "artifacts"),
            diagnostics: [
              {
                severity: "error",
                code: "preparation-failed",
                message: "injected preparation diagnostic",
              },
            ],
            warnings: [],
          }),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("preparation-failed");
    expect(existsSync(target)).toBe(false);
    expect(readFileSync(alternate, "utf8")).toBe(originalAlternate);
    expect(readFileSync(opencode, "utf8")).toBe(originalOpenCode);
    expect(
      readFileSync(join(dir, ".atlante", "artifacts", "manifest.json"), "utf8"),
    ).toBe(originalManifest);
    expect(readArtifacts(dir)).toEqual(originalArtifacts);
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
    buildProject(dir);
    const originalManifest = readFileSync(
      join(dir, ".atlante", "artifacts", "manifest.json"),
      "utf8",
    );
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
              artifactsPath: join(dir, ".atlante", "artifacts"),
              diagnostics: [
                {
                  severity: "error",
                  code: "injected-build-failure",
                  message: "build failed",
                },
              ],
              warnings: [],
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
    expect(
      readFileSync(join(dir, ".atlante", "artifacts", "manifest.json"), "utf8"),
    ).toBe(originalManifest);
    expect(readArtifacts(dir)).toEqual({
      agents: [expect.objectContaining({ hostAgentId: "existing" })],
      skills: [],
    });
  });

  test("preserves the previous artifacts when automatic publication fails", async () => {
    const dir = tempDir();
    const target = join(dir, "atlante.jsonc");
    const originalConfig = `{ "$schema": "${SCHEMA_URI}" }`;
    writeFileSync(target, originalConfig);
    buildProject(dir);
    const manifestPath = join(dir, ".atlante", "artifacts", "manifest.json");
    const originalManifest = readFileSync(manifestPath, "utf8");

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
                fault: (operation) => {
                  if (operation === "rename-stage") {
                    throw new Error("injected build publication failure");
                  }
                },
              },
            ),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain(
      "injected build publication failure",
    );
    expect(readFileSync(target, "utf8")).toBe(originalConfig);
    expect(readFileSync(manifestPath, "utf8")).toBe(originalManifest);
    expect(existsSync(join(dir, "opencode.jsonc"))).toBe(false);
  });

  test("the bare config has no workflow slot", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    const text = readFileSync(join(dir, "atlante.jsonc"), "utf8");
    expect(text).not.toContain("workflow");
  });

  test("--preset uses an exact singular external package locator without mutating dependencies", async () => {
    const dir = tempDirWithoutUserPack();
    const before = readFileSync(join(dir, "package.json"), "utf8");
    installExternalPreset(dir, { named: true });
    const declared = readFileSync(join(dir, "package.json"), "utf8");

    expect(await runInit(dir, { preset: "@acme/review-pack" })).toBe(0);
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      '"extends": "@acme/review-pack"',
    );
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(declared);
    expect(readFileSync(join(dir, "package.json"), "utf8")).not.toBe(before);
    expect(
      existsSync(join(dir, ".atlante", "artifacts", "manifest.json")),
    ).toBe(true);
  });

  test("--preset supports a named external package locator without composing an array", async () => {
    const dir = tempDirWithoutUserPack();
    installExternalPreset(dir, { named: true });

    expect(await runInit(dir, { preset: "@acme/review-pack/strict" })).toBe(0);
    expect(readFileSync(join(dir, "atlante.jsonc"), "utf8")).toContain(
      '"extends": "@acme/review-pack/strict"',
    );
    expect(await runValidate(dir)).toBe(0);
  });

  test.each([
    ["missing", "@acme/missing-pack", undefined],
    ["malformed locator", "@acme//review-pack", undefined],
    ["undeclared", "@acme/review-pack", { declared: false }],
    ["malformed", "@acme/review-pack", { manifest: "{ malformed" }],
    ["unsupported", "@acme/review-pack", { format: 2 }],
    ["wrong facet", "@acme/review-pack/agent", { wrongFacet: true }],
  ] as const)(
    "rejects %s presets before mutating init state",
    async (_name, preset, options) => {
      const dir = tempDirWithoutUserPack();
      if (preset !== "@acme/missing-pack")
        installExternalPreset(dir, options ?? {});
      const opencodePath = join(dir, "opencode.jsonc");
      const originalOpenCode = '{ "model": "demo" }';
      writeFileSync(opencodePath, originalOpenCode);

      const result = await captureErrors(() => runInit(dir, { preset }));

      expect(result.result).toBe(1);
      expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
      expect(readFileSync(opencodePath, "utf8")).toBe(originalOpenCode);
      expect(existsSync(join(dir, ".atlante", "artifacts"))).toBe(false);
    },
  );

  test("treats starter as a normal package locator instead of an alias", async () => {
    const dir = tempDirWithoutUserPack();

    expect(await runInit(dir, { preset: "starter" })).toBe(1);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test("rolls back external preset init after a build failure and preserves artifacts", async () => {
    const dir = tempDirWithoutUserPack();
    installExternalPreset(dir);
    const target = join(dir, "atlante.jsonc");
    const opencode = join(dir, "opencode.jsonc");
    const originalConfig = `{ "$schema": "${SCHEMA_URI}", "values": { "old": "yes" } }`;
    const originalOpenCode = '{ "model": "demo" }';
    writeFileSync(target, originalConfig);
    writeFileSync(opencode, originalOpenCode);
    buildProject(dir);
    const manifest = readFileSync(
      join(dir, ".atlante", "artifacts", "manifest.json"),
      "utf8",
    );

    const result = await captureErrors(() =>
      runInitWithDependencies(
        dir,
        { force: true, preset: "@acme/review-pack" },
        {
          buildProject: () => ({
            projectRoot: dir,
            artifactsPath: join(dir, ".atlante", "artifacts"),
            diagnostics: [
              {
                severity: "error",
                code: "injected-build-failure",
                message: "build failed",
              },
            ],
            warnings: [],
          }),
        },
      ),
    );

    expect(result.result).toBe(1);
    expect(readFileSync(target, "utf8")).toBe(originalConfig);
    expect(readFileSync(opencode, "utf8")).toBe(originalOpenCode);
    expect(
      readFileSync(join(dir, ".atlante", "artifacts", "manifest.json"), "utf8"),
    ).toBe(manifest);
  });

  test("registers the plugin in opencode.jsonc", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    const opencode = JSON.parse(
      readFileSync(join(dir, "opencode.jsonc"), "utf8"),
    );
    expect(opencode.plugin).toContain("@atlante/opencode");
  });

  test("adds the OpenCode schema to a new opencode.jsonc", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    const opencode = JSON.parse(
      readFileSync(join(dir, "opencode.jsonc"), "utf8"),
    );
    expect(opencode.$schema).toBe("https://opencode.ai/config.json");
  });

  test("preserves an existing opencode.jsonc", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "opencode.jsonc"),
      `{ "model": "anthropic/claude-sonnet-5" }`,
    );
    await runInit(dir, {});
    const opencode = JSON.parse(
      readFileSync(join(dir, "opencode.jsonc"), "utf8"),
    );
    expect(opencode.model).toBe("anthropic/claude-sonnet-5");
    expect(opencode.plugin).toContain("@atlante/opencode");
  });

  test("registers the plugin in an existing opencode.json", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.json");
    writeFileSync(path, `{ "model": "anthropic/claude-sonnet-5" }`);

    expect(await runInit(dir, {})).toBe(0);

    const opencode = JSON.parse(readFileSync(path, "utf8"));
    expect(opencode.model).toBe("anthropic/claude-sonnet-5");
    expect(opencode.plugin).toContain("@atlante/opencode");
    expect(existsSync(join(dir, "opencode.jsonc"))).toBe(false);
  });

  test("prefers opencode.jsonc when both config files exist", async () => {
    const dir = tempDir();
    const jsonc = join(dir, "opencode.jsonc");
    writeFileSync(jsonc, `{ "model": "anthropic/claude-sonnet-5" }`);
    const json = join(dir, "opencode.json");
    writeFileSync(json, `{ "model": "google/gemini-3-pro" }`);

    expect(await runInit(dir, {})).toBe(0);

    expect(JSON.parse(readFileSync(jsonc, "utf8")).plugin).toContain(
      "@atlante/opencode",
    );
    expect(readFileSync(json, "utf8")).toBe(
      `{ "model": "google/gemini-3-pro" }`,
    );
  });

  test("rejects malformed opencode JSONC without modifying it", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    const original = '{ "model": "demo",';
    writeFileSync(path, original);

    const result = await captureErrors(() => runInit(dir, {}));

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain(
      "invalid-opencode-configuration",
    );
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test.each([
    ["string-valued", "existing-plugin"],
    ["object-valued", { name: "existing-plugin" }],
  ] as const)(
    "rejects %s plugin values without modifying them",
    async (_kind, plugin) => {
      const dir = tempDir();
      const path = join(dir, "opencode.jsonc");
      const original = JSON.stringify({ plugin });
      writeFileSync(path, original);

      const result = await captureErrors(() => runInit(dir, {}));

      expect(result.result).toBe(1);
      expect(result.errors.join("\n")).toContain("array of strings");
      expect(readFileSync(path, "utf8")).toBe(original);
      expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
    },
  );

  test("preserves tuple plugin entries while registering the plugin", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    writeFileSync(
      path,
      JSON.stringify({ plugin: [["other-plugin", { enabled: true }]] }),
    );

    expect(await runInit(dir, {})).toBe(0);

    const opencode = JSON.parse(readFileSync(path, "utf8"));
    expect(opencode.plugin).toEqual([
      ["other-plugin", { enabled: true }],
      "@atlante/opencode",
    ]);
  });

  test("recognizes a tuple form of the Atlante plugin", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    const original = JSON.stringify({
      plugin: [["@atlante/opencode", { enabled: true }]],
    });
    writeFileSync(path, original);

    expect(await runInit(dir, {})).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  test("rejects malformed plugin tuples without changing the target", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    const original = JSON.stringify({ plugin: [["other-plugin"]] });
    writeFileSync(path, original);

    const result = await captureErrors(() => runInit(dir, {}));

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("options-object");
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
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

  test("turns opencode read failures into an exit code", async () => {
    const dir = tempDir();
    const target = join(dir, "atlante.jsonc");
    const opencode = join(dir, "opencode.jsonc");
    const originalTarget = "preexisting target";
    writeFileSync(target, originalTarget);
    writeFileSync(opencode, "{}");
    const dependencies: InitDependencies = {
      readFileSync: (path) => {
        if (path === opencode)
          throw new Error("injected opencode read failure");
        return readFileSync(path, "utf8");
      },
    };

    const result = await captureErrors(() =>
      runInitWithDependencies(dir, { force: true }, dependencies),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain(
      "injected opencode read failure",
    );
    expect(readFileSync(target, "utf8")).toBe(originalTarget);
  });

  test("turns plugin write failures into an exit code", async () => {
    const dir = tempDir();
    const target = join(dir, "atlante.jsonc");
    const opencode = join(dir, "opencode.jsonc");
    const originalTarget = "preexisting target";
    writeFileSync(target, originalTarget);
    const dependencies: InitDependencies = {
      writeFileSync: (path, contents) => {
        if (path === opencode) throw new Error("injected plugin write failure");
        writeFileSync(path, contents);
      },
    };

    const result = await captureErrors(() =>
      runInitWithDependencies(dir, { force: true }, dependencies),
    );

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("injected plugin write failure");
    expect(readFileSync(target, "utf8")).toBe(originalTarget);
    expect(existsSync(opencode)).toBe(false);
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

  test("reports a fresh plugin registration", async () => {
    const dir = tempDir();
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      await runInit(dir, {});
    } finally {
      console.log = original;
    }
    expect(written.join("\n")).toContain("registered @atlante/opencode");
    expect(written.join("\n")).toContain(
      `created ${join(dir, "atlante.jsonc")}`,
    );
    expect(written.join("\n")).toContain(join(dir, ".atlante", "artifacts"));
  });

  test("reports that the plugin was already registered, rather than claiming a fresh registration", async () => {
    const dir = tempDir();
    await runInit(dir, {});

    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      await runInit(dir, { force: true });
    } finally {
      console.log = original;
    }
    expect(written.join("\n")).toContain("already registered");
  });

  test("--force overwrites altered configuration contents", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    const target = join(dir, "atlante.jsonc");
    writeFileSync(target, "altered contents");

    expect(await runInit(dir, { force: true })).toBe(0);
    const contents = readFileSync(target, "utf8");
    expect(contents).not.toBe("altered contents");
    expect(contents).toContain('"$schema"');
    expect(contents).toContain('"extends"');
  });

  test("refuses to overwrite an existing config without --force", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    expect(await runInit(dir, {})).toBe(1);
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
    await runInit(dir, {});
    writeFileSync(join(dir, "atlante.json"), "{}");

    expect(await runInit(dir, {})).toBe(1);
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

    expect(await runInit(dir, { force: true })).toBe(0);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "atlante.json"))).toBe(false);
    expect(await runValidate(dir)).toBe(0);
  });

  test("--force resolves an ambiguous pre-state without leaving both files", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    writeFileSync(
      join(dir, "atlante.json"),
      JSON.stringify({
        $schema: "https://atlante.sh/schema/v0.1/schema.json",
        agents: {},
      }),
    );

    expect(await runInit(dir, { force: true })).toBe(0);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "atlante.json"))).toBe(false);
  });

  test("rejects an unknown preset name", async () => {
    expect(await runInit(tempDir(), { preset: "nope" })).toBe(1);
  });
});
