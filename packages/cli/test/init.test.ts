import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
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
import { readArtifacts } from "@atlante/builder/artifacts";
import { SCHEMA_URI } from "@atlante/schema";
import {
  type InitDependencies,
  runInitWithDependencies,
} from "../src/commands/init-internal.js";
import { runInit, runValidate } from "../src/main.js";

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-init-"));
  created.push(dir);
  return dir;
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
    const dir = tempDir();
    expect(await runInit(dir, {})).toBe(0);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(
      existsSync(join(dir, ".atlante", "artifacts", "manifest.json")),
    ).toBe(true);
    expect(await runValidate(dir)).toBe(0);
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
      "warning: unable to sync published artifact directory: injected publication warning",
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

  test("--preset starter is an alias for the default", async () => {
    const dir = tempDir();
    expect(await runInit(dir, { preset: "starter" })).toBe(0);
    const text = readFileSync(join(dir, "atlante.jsonc"), "utf8");
    expect(text).toContain("atlante/starter");
    expect(text).toContain("extends");
    expect(await runValidate(dir)).toBe(0);
  });

  test("registers the plugin in opencode.jsonc", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    const opencode = JSON.parse(
      readFileSync(join(dir, "opencode.jsonc"), "utf8"),
    );
    expect(opencode.plugin).toContain("@atlante/opencode-plugin");
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
    expect(opencode.plugin).toContain("@atlante/opencode-plugin");
  });

  test("rejects malformed opencode JSONC without modifying it", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    const original = '{ "model": "demo",';
    writeFileSync(path, original);

    const result = await captureErrors(() => runInit(dir, {}));

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("malformed JSONC");
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test("rejects a string plugin value without spreading it", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    const original = '{ "plugin": "existing-plugin" }';
    writeFileSync(path, original);

    const result = await captureErrors(() => runInit(dir, {}));

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("array of strings");
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test("rejects an object plugin value without modifying it", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    const original = '{ "plugin": { "name": "existing-plugin" } }';
    writeFileSync(path, original);

    const result = await captureErrors(() => runInit(dir, {}));

    expect(result.result).toBe(1);
    expect(result.errors.join("\n")).toContain("array of strings");
    expect(readFileSync(path, "utf8")).toBe(original);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

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
      "@atlante/opencode-plugin",
    ]);
  });

  test("recognizes a tuple form of the Atlante plugin", async () => {
    const dir = tempDir();
    const path = join(dir, "opencode.jsonc");
    const original = JSON.stringify({
      plugin: [["@atlante/opencode-plugin", { enabled: true }]],
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
    expect(written.join("\n")).toContain("registered @atlante/opencode-plugin");
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
