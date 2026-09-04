import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePackLocator } from "../src/commands/pack-locator.js";
import {
  discoverPackPresets,
  selectPackPreset,
} from "../src/commands/pack-presets.js";
import {
  detectPackageManager,
  packageManagerAddArgs,
  packageManagerCommand,
  packageManagerInstallArgs,
  packageManagerLockfiles,
  resolveDependencyRoot,
} from "../src/commands/package-manager.js";

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-pack-init-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("parsePackLocator", () => {
  test("parses a pack name without a preset", () => {
    expect(parsePackLocator("@acme/review-pack")).toEqual({
      packageName: "@acme/review-pack",
    });
  });

  test("parses a named preset from the locator subpath", () => {
    expect(parsePackLocator("@acme/review-pack/strict")).toEqual({
      packageName: "@acme/review-pack",
      presetName: "strict",
    });
  });

  test("parses a multi-segment named preset", () => {
    expect(parsePackLocator("@acme/review-pack/team/strict")).toEqual({
      packageName: "@acme/review-pack",
      presetName: "team/strict",
    });
  });

  test("treats a bare package name as a normal pack locator instead of an alias", () => {
    expect(parsePackLocator("starter")).toEqual({ packageName: "starter" });
  });

  test.each(["./local", "../local", "@acme//pack", "@acme/"])(
    "rejects %s as a pack locator",
    (raw) => {
      const parsed = parsePackLocator(raw);
      expect("error" in parsed).toBe(true);
      if ("error" in parsed) {
        expect(parsed.error).toContain("invalid-pack-locator");
      }
    },
  );
});

describe("detectPackageManager", () => {
  test.each([
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
  ] as const)("%s selects %s", (lockfile, manager) => {
    const dir = tempDir();
    writeFileSync(join(dir, lockfile), "");
    expect(detectPackageManager(dir)).toBe(manager);
  });

  test("prefers earlier-detected managers when multiple lockfiles exist", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    writeFileSync(join(dir, "package-lock.json"), "");
    expect(detectPackageManager(dir)).toBe("pnpm");
  });

  test("defaults to npm without a lockfile", () => {
    expect(detectPackageManager(tempDir())).toBe("npm");
  });

  test("prefers an explicit packageManager hint over lockfiles", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(dir, undefined, "bun@1.2.0")).toBe("bun");
  });

  test("resolves the manager from a packageManager hint without a lockfile", () => {
    expect(detectPackageManager(tempDir(), undefined, "yarn@4.0.0")).toBe(
      "yarn",
    );
  });

  test("ignores unknown or malformed packageManager hints", () => {
    const dir = tempDir();
    expect(detectPackageManager(dir, undefined, "deno@2.0.0")).toBe("npm");
    expect(detectPackageManager(dir, undefined, "not-a-version")).toBe("npm");
    expect(detectPackageManager(dir, undefined, "")).toBe("npm");
  });
});

describe("resolveDependencyRoot", () => {
  test("returns the directory itself when it holds the lockfile", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "pnpm-lock.yaml"), "");
    expect(resolveDependencyRoot(dir)).toBe(dir);
  });

  test("walks up to the nearest ancestor lockfile", () => {
    const root = tempDir();
    const app = join(root, "packages", "app");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(root, "pnpm-lock.yaml"), "");
    expect(resolveDependencyRoot(app)).toBe(root);
  });

  test("prefers the nearest ancestor over a farther lockfile", () => {
    const root = tempDir();
    const workspace = join(root, "packages", "outer", "inner");
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(root, "package-lock.json"), "");
    writeFileSync(join(root, "packages", "outer", "yarn.lock"), "");
    expect(resolveDependencyRoot(workspace)).toBe(
      join(root, "packages", "outer"),
    );
  });

  test("returns the directory itself without any lockfile up the tree", () => {
    const root = tempDir();
    const app = join(root, "packages", "app");
    mkdirSync(app, { recursive: true });
    expect(resolveDependencyRoot(app)).toBe(app);
  });
});

describe("package manager commands", () => {
  test("adds the pack as a dev dependency with manager-specific flags", () => {
    expect(packageManagerAddArgs("npm", "@acme/pack")).toEqual([
      "install",
      "--save-dev",
      "@acme/pack",
    ]);
    expect(packageManagerAddArgs("pnpm", "@acme/pack")).toEqual([
      "add",
      "--save-dev",
      "@acme/pack",
    ]);
    expect(packageManagerAddArgs("yarn", "@acme/pack")).toEqual([
      "add",
      "--dev",
      "@acme/pack",
    ]);
    expect(packageManagerAddArgs("bun", "@acme/pack")).toEqual([
      "add",
      "--dev",
      "@acme/pack",
    ]);
  });

  test("reconciles with a plain install for every manager", () => {
    for (const manager of ["npm", "pnpm", "yarn", "bun"] as const) {
      expect(packageManagerInstallArgs(manager)).toEqual(["install"]);
    }
  });

  test("snapshots every lockfile the manager may read or create", () => {
    const dir = tempDir();
    expect(packageManagerLockfiles("bun", dir)).toEqual([
      join(dir, "bun.lockb"),
      join(dir, "bun.lock"),
    ]);
    expect(packageManagerLockfiles("pnpm", dir)).toEqual([
      join(dir, "pnpm-lock.yaml"),
    ]);
    expect(packageManagerLockfiles("yarn", dir)).toEqual([
      join(dir, "yarn.lock"),
    ]);
    expect(packageManagerLockfiles("npm", dir)).toEqual([
      join(dir, "package-lock.json"),
    ]);
  });

  test("formats the command for diagnostics", () => {
    expect(packageManagerCommand("bun", ["add", "--dev", "@acme/pack"])).toBe(
      "bun add --dev @acme/pack",
    );
  });
});

describe("discoverPackPresets", () => {
  test("reports the pack root as the default preset", () => {
    const packRoot = tempDir();
    writeFileSync(join(packRoot, "atlante.jsonc"), "{}\n");
    expect(discoverPackPresets("@acme/pack", packRoot)).toEqual([
      { locator: "@acme/pack", relpath: "" },
    ]);
  });

  test("accepts atlante.json as the preset manifest", () => {
    const packRoot = tempDir();
    writeFileSync(join(packRoot, "atlante.json"), "{}\n");
    expect(discoverPackPresets("@acme/pack", packRoot)).toEqual([
      { locator: "@acme/pack", relpath: "" },
    ]);
  });

  test("reports subdirectories as named presets in a deterministic order", () => {
    const packRoot = tempDir();
    writeFileSync(join(packRoot, "atlante.jsonc"), "{}\n");
    mkdirSync(join(packRoot, "minimal"));
    writeFileSync(join(packRoot, "minimal", "atlante.jsonc"), "{}\n");
    mkdirSync(join(packRoot, "strict"));
    writeFileSync(join(packRoot, "strict", "atlante.json"), "{}\n");

    expect(discoverPackPresets("@acme/pack", packRoot)).toEqual([
      { locator: "@acme/pack", relpath: "" },
      { locator: "@acme/pack/minimal", relpath: "minimal" },
      { locator: "@acme/pack/strict", relpath: "strict" },
    ]);
  });

  test("supports nested named presets", () => {
    const packRoot = tempDir();
    mkdirSync(join(packRoot, "team", "strict"), { recursive: true });
    writeFileSync(join(packRoot, "team", "strict", "atlante.jsonc"), "{}\n");
    expect(discoverPackPresets("@acme/pack", packRoot)).toEqual([
      { locator: "@acme/pack/team/strict", relpath: "team/strict" },
    ]);
  });

  test("excludes node_modules from the scan", () => {
    const packRoot = tempDir();
    writeFileSync(join(packRoot, "atlante.jsonc"), "{}\n");
    const nested = join(packRoot, "node_modules", "stray");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "atlante.jsonc"), "{}\n");

    expect(discoverPackPresets("@acme/pack", packRoot)).toEqual([
      { locator: "@acme/pack", relpath: "" },
    ]);
  });

  test("does not count a directory named like a preset manifest as a preset", () => {
    const packRoot = tempDir();
    writeFileSync(join(packRoot, "atlante.jsonc"), "{}\n");
    const decoy = join(packRoot, "weird", "atlante.jsonc");
    mkdirSync(decoy, { recursive: true });

    expect(discoverPackPresets("@acme/pack", packRoot)).toEqual([
      { locator: "@acme/pack", relpath: "" },
    ]);
  });

  test("reports no presets when the pack tree has no preset manifests", () => {
    const packRoot = tempDir();
    mkdirSync(join(packRoot, "agents"));
    expect(discoverPackPresets("@acme/pack", packRoot)).toEqual([]);
  });
});

describe("selectPackPreset", () => {
  const presets = [
    { locator: "@acme/pack", relpath: "" },
    { locator: "@acme/pack/strict", relpath: "strict" },
  ];
  const selection = {
    isInteractive: () => false,
    prompt: async () => "",
  };

  test("auto-selects a single preset without prompting", async () => {
    let prompted = false;
    const result = await selectPackPreset(
      "@acme/pack",
      [{ locator: "@acme/pack", relpath: "" }],
      undefined,
      {
        isInteractive: () => true,
        prompt: async () => {
          prompted = true;
          return "1";
        },
      },
    );
    expect(result).toEqual({ locator: "@acme/pack", relpath: "" });
    expect(prompted).toBe(false);
  });

  test("selects an explicit preset name without prompting", async () => {
    const result = await selectPackPreset(
      "@acme/pack",
      presets,
      "strict",
      selection,
    );
    expect(result).toEqual({ locator: "@acme/pack/strict", relpath: "strict" });
  });

  test("rejects an unknown preset name with the available presets", async () => {
    const result = await selectPackPreset(
      "@acme/pack",
      presets,
      "missing",
      selection,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("pack-preset-not-found");
      expect(result.error).toContain("@acme/pack/missing");
      expect(result.error).toContain("@acme/pack/strict");
    }
  });

  test("fails with an actionable error on multiple presets in a non-interactive terminal", async () => {
    const result = await selectPackPreset(
      "@acme/pack",
      presets,
      undefined,
      selection,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("pack-prompt-required");
      expect(result.error).toContain("@acme/pack, @acme/pack/strict");
      expect(result.error).toContain("atlante init --pack @acme/pack/<preset>");
    }
  });

  test("prompts and selects on an interactive terminal", async () => {
    const prompts: string[] = [];
    const result = await selectPackPreset("@acme/pack", presets, undefined, {
      isInteractive: () => true,
      prompt: async (query) => {
        prompts.push(query);
        return "2";
      },
    });
    expect(result).toEqual({ locator: "@acme/pack/strict", relpath: "strict" });
    expect(prompts).toEqual(["Select a preset (1-2): "]);
  });

  test("re-prompts on invalid input until a valid selection arrives", async () => {
    const answers = ["nope", "9", "1"];
    const result = await selectPackPreset("@acme/pack", presets, undefined, {
      isInteractive: () => true,
      prompt: async () => answers.shift() ?? "1",
    });
    expect(result).toEqual({ locator: "@acme/pack", relpath: "" });
    expect(answers).toEqual([]);
  });

  test("reports an aborted prompt as an actionable failure", async () => {
    const result = await selectPackPreset("@acme/pack", presets, undefined, {
      isInteractive: () => true,
      prompt: async () => {
        throw new Error("stdin closed");
      },
    });
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("pack-prompt-aborted");
      expect(result.error).toContain("atlante init --pack @acme/pack/<preset>");
    }
  });

  test("reports a pack without presets", async () => {
    const result = await selectPackPreset(
      "@acme/pack",
      [],
      undefined,
      selection,
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("provides no presets");
    }
  });
});

describe("package manager execution seam contract", () => {
  test("the default runner reports a non-zero status as a failure", async () => {
    const { runPackageManagerDefault } = await import(
      "../src/commands/package-manager.js"
    );
    const run = runPackageManagerDefault(
      "node",
      ["-e", "process.exit(3)"],
      ".",
    );
    expect(run.ok).toBe(false);
    expect(run.status).toBe(3);
    expect(existsSync(".")).toBe(true);
  });
});
