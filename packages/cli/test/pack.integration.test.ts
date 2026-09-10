import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runPackInstall,
  runPackList,
  runPackUninstall,
} from "../src/commands/pack.js";
import type {
  PackageManager,
  PackageManagerRunner,
} from "../src/commands/package-manager.js";

const PACK = "@acme/review-pack";
const created: string[] = [];

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "atlante-pack-command-"));
  created.push(directory);
  return directory;
}

function writeProject(
  directory: string,
  manifest: Record<string, unknown>,
): void {
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function packageRoot(directory: string, name = PACK): string {
  return join(directory, "node_modules", ...name.split("/"));
}

function writeInstalledPack(
  directory: string,
  options: { name?: string; version?: string; format?: unknown } = {},
): void {
  const name = options.name ?? PACK;
  const root = packageRoot(directory, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name,
      version: options.version ?? "1.2.3",
      atlante: { format: options.format ?? 1 },
    })}\n`,
  );
}

function dependencyManifest(directory: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

type ManagerFixture = {
  manager: PackageManager;
  runs: Array<{ manager: PackageManager; args: string[]; cwd: string }>;
  runner: PackageManagerRunner;
};

function managerFixture(
  directory: string,
  options: { invalidInstall?: boolean; failInstall?: boolean } = {},
): ManagerFixture {
  const manager = (
    JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      packageManager: string;
    }
  ).packageManager.split("@")[0] as PackageManager;
  const runs: ManagerFixture["runs"] = [];

  const writeManifest = (manifest: Record<string, unknown>): void => {
    writeFileSync(
      join(directory, "package.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  };

  const runner: PackageManagerRunner = (runManager, args, cwd) => {
    runs.push({ manager: runManager, args: [...args], cwd });
    const manifest = dependencyManifest(directory);
    const verb = args[0];
    const name = args[args.length - 1];
    if (verb === "install" && args[1] === "--save-dev") {
      if (options.failInstall) {
        manifest.devDependencies = { [PACK]: "1.2.3" };
        writeManifest(manifest);
        return { ok: false, status: 1 };
      }
      manifest.devDependencies = { [name as string]: "1.2.3" };
      writeManifest(manifest);
      writeInstalledPack(directory, {
        format: options.invalidInstall ? 2 : 1,
      });
      return { ok: true, status: 0 };
    }
    if (verb === "add") {
      manifest.devDependencies = { [name as string]: "1.2.3" };
      writeManifest(manifest);
      writeInstalledPack(directory, {
        format: options.invalidInstall ? 2 : 1,
      });
      return { ok: true, status: 0 };
    }
    if (verb === "remove" || verb === "uninstall") {
      for (const group of [
        "dependencies",
        "optionalDependencies",
        "devDependencies",
      ]) {
        const values = manifest[group];
        if (typeof values === "object" && values !== null)
          delete (values as Record<string, unknown>)[name as string];
      }
      writeManifest(manifest);
      rmSync(packageRoot(directory, name as string), {
        recursive: true,
        force: true,
      });
      return { ok: true, status: 0 };
    }
    if (verb === "install") {
      const declared = [
        "dependencies",
        "optionalDependencies",
        "devDependencies",
      ].some((group) => {
        const values = manifest[group];
        return (
          typeof values === "object" &&
          values !== null &&
          Object.hasOwn(values, PACK)
        );
      });
      if (declared) writeInstalledPack(directory);
      else rmSync(packageRoot(directory), { recursive: true, force: true });
      return { ok: true, status: 0 };
    }
    return { ok: true, status: 0 };
  };

  return { manager, runs, runner };
}

function captureOutput<T>(callback: () => Promise<T>): Promise<{
  result: T;
  output: string[];
  errors: string[];
}> {
  const output: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args: unknown[]) => output.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  return callback()
    .then((result) => ({ result, output, errors }))
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
    });
}

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("atlante pack install", () => {
  test.each([
    ["npm", "install", "--save-dev"],
    ["pnpm", "add", "--save-dev"],
    ["yarn", "add", "--dev"],
    ["bun", "add", "--dev"],
  ] as const)(
    "uses the detected %s package manager",
    async (manager, verb, flag) => {
      const directory = tempDir();
      writeProject(directory, {
        name: "pack-command-fixture",
        version: "1.0.0",
        packageManager: `${manager}@1.0.0`,
      });
      const fixture = managerFixture(directory);

      const result = await runPackInstall(directory, PACK, {
        runPackageManager: fixture.runner,
      });

      expect(result).toBe(0);
      expect(fixture.runs[0]).toEqual({
        manager,
        args: [verb, flag, PACK],
        cwd: directory,
      });
      expect(
        (
          dependencyManifest(directory).devDependencies as Record<
            string,
            string
          >
        )[PACK],
      ).toBe("1.2.3");
      expect(existsSync(join(directory, "atlante.jsonc"))).toBe(false);
      expect(existsSync(join(directory, ".opencode"))).toBe(false);
    },
  );

  test("rolls back a failed or invalid installation", async () => {
    for (const options of [{ failInstall: true }, { invalidInstall: true }]) {
      const directory = tempDir();
      writeProject(directory, {
        name: "pack-command-fixture",
        version: "1.0.0",
        packageManager: "npm@10.0.0",
      });
      const before = readFileSync(join(directory, "package.json"), "utf8");
      const fixture = managerFixture(directory, options);
      const captured = await captureOutput(() =>
        runPackInstall(directory, PACK, { runPackageManager: fixture.runner }),
      );

      expect(captured.result).toBe(1);
      expect(captured.errors.join("\n")).toMatch(
        /pack-installation-failed|invalid-pack/,
      );
      expect(readFileSync(join(directory, "package.json"), "utf8")).toBe(
        before,
      );
      expect(existsSync(packageRoot(directory))).toBe(false);
      expect(fixture.runs.map(({ args }) => args[0])).toEqual([
        "install",
        ...(options.invalidInstall ? ["install"] : ["install"]),
      ]);
    }
  });

  test("does not install the bundled first-party pack", async () => {
    const directory = tempDir();
    const fixture = {
      runs: 0,
      runner: (() => {
        fixture.runs += 1;
        return { ok: true, status: 0 };
      }) as PackageManagerRunner,
    };

    const captured = await captureOutput(() =>
      runPackInstall(directory, "@atlante/pack", {
        runPackageManager: fixture.runner,
      }),
    );

    expect(captured.result).toBe(1);
    expect(captured.errors.join("\n")).toContain("bundled-pack");
    expect(fixture.runs).toBe(0);
  });

  test("restores the dependency when installation throws after mutation", async () => {
    const directory = tempDir();
    writeProject(directory, {
      name: "pack-command-fixture",
      version: "1.0.0",
      packageManager: "npm@10.0.0",
    });
    const before = readFileSync(join(directory, "package.json"), "utf8");
    const runs: string[] = [];
    const runner: PackageManagerRunner = (_manager, args) => {
      runs.push(args[0] ?? "");
      if (args[0] === "install" && args[1] === "--save-dev") {
        const manifest = dependencyManifest(directory);
        manifest.devDependencies = { [PACK]: "1.2.3" };
        writeProject(directory, manifest);
        writeInstalledPack(directory);
        throw new Error("runner boom");
      }
      rmSync(packageRoot(directory), { recursive: true, force: true });
      return { ok: true, status: 0 };
    };

    const captured = await captureOutput(() =>
      runPackInstall(directory, PACK, { runPackageManager: runner }),
    );

    expect(captured.result).toBe(1);
    expect(captured.errors.join("\n")).toContain("pack-installation-failed");
    expect(readFileSync(join(directory, "package.json"), "utf8")).toBe(before);
    expect(existsSync(packageRoot(directory))).toBe(false);
    expect(runs).toEqual(["install", "install"]);
  });

  test("reports a reconciliation exception after an install failure", async () => {
    const directory = tempDir();
    writeProject(directory, {
      name: "pack-command-fixture",
      version: "1.0.0",
      packageManager: "npm@10.0.0",
    });
    const before = readFileSync(join(directory, "package.json"), "utf8");
    const runner: PackageManagerRunner = (_manager, args) => {
      if (args[0] === "install" && args[1] === "--save-dev") {
        const manifest = dependencyManifest(directory);
        manifest.devDependencies = { [PACK]: "1.2.3" };
        writeProject(directory, manifest);
        writeInstalledPack(directory);
      }
      throw new Error("runner boom");
    };

    const captured = await captureOutput(() =>
      runPackInstall(directory, PACK, { runPackageManager: runner }),
    );

    expect(captured.result).toBe(1);
    expect(captured.errors.join("\n")).toContain("rollback-failed");
    expect(readFileSync(join(directory, "package.json"), "utf8")).toBe(before);
  });
});

describe("atlante pack uninstall", () => {
  test("refuses to remove a pack referenced from JSONC or JSON", async () => {
    for (const filename of ["atlante.jsonc", "atlante.json"]) {
      const directory = tempDir();
      writeProject(directory, {
        name: "pack-command-fixture",
        version: "1.0.0",
        packageManager: "npm@10.0.0",
        devDependencies: { [PACK]: "1.2.3" },
      });
      writeInstalledPack(directory);
      const config = `{\n  "extends": "${PACK}/strict"\n}\n`;
      writeFileSync(join(directory, filename), config);
      const fixture = managerFixture(directory);
      const before = readFileSync(join(directory, "package.json"), "utf8");

      const captured = await captureOutput(() =>
        runPackUninstall(directory, PACK, {
          runPackageManager: fixture.runner,
        }),
      );

      expect(captured.result).toBe(1);
      expect(captured.errors.join("\n")).toContain("pack-in-use");
      expect(fixture.runs).toEqual([]);
      expect(readFileSync(join(directory, "package.json"), "utf8")).toBe(
        before,
      );
    }
  });

  test.each([
    ["npm", "uninstall"],
    ["pnpm", "remove"],
    ["yarn", "remove"],
    ["bun", "remove"],
  ] as const)(
    "removes an unreferenced direct pack with %s without touching configuration",
    async (manager, verb) => {
      const directory = tempDir();
      writeProject(directory, {
        name: "pack-command-fixture",
        version: "1.0.0",
        packageManager: `${manager}@1.0.0`,
        devDependencies: { [PACK]: "1.2.3" },
      });
      writeInstalledPack(directory);
      const config = '{\n  "values": { "project": "demo" }\n}\n';
      writeFileSync(join(directory, "atlante.jsonc"), config);
      const fixture = managerFixture(directory);

      const result = await runPackUninstall(directory, PACK, {
        runPackageManager: fixture.runner,
      });

      expect(result).toBe(0);
      expect(fixture.runs[0]).toEqual({
        manager,
        args: [verb, PACK],
        cwd: directory,
      });
      expect(dependencyManifest(directory).devDependencies).toEqual({});
      expect(existsSync(packageRoot(directory))).toBe(false);
      expect(readFileSync(join(directory, "atlante.jsonc"), "utf8")).toBe(
        config,
      );
    },
  );

  test.each([
    ["agents", `{"agents":{"reviewer":"${PACK}/reviewer"}}`],
    ["skills", `{"skills":{"lint":{"$instance":"${PACK}/lint"}}}`],
  ] as const)(
    "refuses a pack referenced by a %s source",
    async (_kind, config) => {
      const directory = tempDir();
      writeProject(directory, {
        name: "pack-command-fixture",
        version: "1.0.0",
        packageManager: "npm@10.0.0",
        devDependencies: { [PACK]: "1.2.3" },
      });
      writeInstalledPack(directory);
      writeFileSync(join(directory, "atlante.json"), config);
      const fixture = managerFixture(directory);

      const captured = await captureOutput(() =>
        runPackUninstall(directory, PACK, {
          runPackageManager: fixture.runner,
        }),
      );

      expect(captured.result).toBe(1);
      expect(captured.errors.join("\n")).toContain("pack-in-use");
      expect(fixture.runs).toEqual([]);
    },
  );

  test("does not treat arbitrary fields as pack references", async () => {
    const directory = tempDir();
    writeProject(directory, {
      name: "pack-command-fixture",
      version: "1.0.0",
      packageManager: "npm@10.0.0",
      devDependencies: { [PACK]: "1.2.3" },
    });
    writeInstalledPack(directory);
    writeFileSync(
      join(directory, "atlante.json"),
      `{"values":{"extends":"${PACK}"}}`,
    );
    const fixture = managerFixture(directory);

    const result = await runPackUninstall(directory, PACK, {
      runPackageManager: fixture.runner,
    });

    expect(result).toBe(0);
    expect(fixture.runs[0]?.args).toEqual(["uninstall", PACK]);
  });

  test("restores the dependency when uninstall throws after mutation", async () => {
    const directory = tempDir();
    writeProject(directory, {
      name: "pack-command-fixture",
      version: "1.0.0",
      packageManager: "npm@10.0.0",
      devDependencies: { [PACK]: "1.2.3" },
    });
    writeInstalledPack(directory);
    const before = readFileSync(join(directory, "package.json"), "utf8");
    const runs: string[] = [];
    const runner: PackageManagerRunner = (_manager, args) => {
      runs.push(args[0] ?? "");
      if (args[0] === "uninstall") {
        const manifest = dependencyManifest(directory);
        delete (manifest.devDependencies as Record<string, string>)[PACK];
        writeProject(directory, manifest);
        rmSync(packageRoot(directory), { recursive: true, force: true });
        throw new Error("runner boom");
      }
      writeInstalledPack(directory);
      return { ok: true, status: 0 };
    };

    const captured = await captureOutput(() =>
      runPackUninstall(directory, PACK, { runPackageManager: runner }),
    );

    expect(captured.result).toBe(1);
    expect(captured.errors.join("\n")).toContain("pack-uninstallation-failed");
    expect(readFileSync(join(directory, "package.json"), "utf8")).toBe(before);
    expect(existsSync(packageRoot(directory))).toBe(true);
    expect(runs).toEqual(["uninstall", "install"]);
  });
});

describe("atlante pack list", () => {
  test("reports direct valid packs without listing unrelated dependencies", async () => {
    const directory = tempDir();
    const otherPack = "@acme/other-pack";
    writeProject(directory, {
      name: "pack-command-fixture",
      version: "1.0.0",
      packageManager: "npm@10.0.0",
      devDependencies: {
        typescript: "5.0.0",
        [PACK]: "^1.0.0",
        [otherPack]: "^2.0.0",
      },
    });
    writeInstalledPack(directory, { version: "1.2.3" });
    writeInstalledPack(directory, {
      name: otherPack,
      version: "2.1.0",
    });
    writeFileSync(
      join(directory, "atlante.jsonc"),
      `{\n  "extends": "${PACK}"\n}\n`,
    );

    const captured = await captureOutput(() => runPackList(directory));

    expect(captured.result).toBe(0);
    expect(captured.output).toContain(
      `${PACK} declared=devDependencies:^1.0.0 installed=1.2.3 valid=yes referenced=yes`,
    );
    expect(captured.output).toContain(
      `${otherPack} declared=devDependencies:^2.0.0 installed=2.1.0 valid=yes referenced=no`,
    );
    expect(captured.output.join("\n")).not.toContain("typescript");
  });
});
