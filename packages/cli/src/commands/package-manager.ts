import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export type PackageManagerRun = Readonly<{
  ok: boolean;
  status: number | null;
}>;

/** Filesystem seam for lockfile detection. */
export type FileExists = (path: string) => boolean;

const LOCKFILES: Readonly<Record<PackageManager, readonly string[]>> = {
  bun: ["bun.lockb", "bun.lock"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
  npm: ["package-lock.json"],
};

/**
 * Detects the package manager from lockfiles in the project directory:
 * bun, pnpm, and yarn lockfiles win over npm's; with no lockfile, npm is used.
 */
export function detectPackageManager(
  directory: string,
  fileExists: FileExists = existsSync,
): PackageManager {
  for (const manager of ["bun", "pnpm", "yarn"] as const) {
    if (LOCKFILES[manager].some((name) => fileExists(join(directory, name))))
      return manager;
  }
  return "npm";
}

/** Lockfiles the detected package manager may read or create. */
export function packageManagerLockfiles(
  manager: PackageManager,
  directory: string,
): string[] {
  return LOCKFILES[manager].map((name) => join(directory, name));
}

/** Command that installs and declares one package as a dev dependency. */
export function packageManagerAddArgs(
  manager: PackageManager,
  packageName: string,
): string[] {
  switch (manager) {
    case "npm":
      return ["install", "--save-dev", packageName];
    case "pnpm":
      return ["add", "--save-dev", packageName];
    case "yarn":
      return ["add", "--dev", packageName];
    case "bun":
      return ["add", "--dev", packageName];
  }
}

/** Command that reconciles installed packages with the project manifest. */
export function packageManagerInstallArgs(manager: PackageManager): string[] {
  switch (manager) {
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
      return ["install"];
  }
}

export type PackageManagerRunner = (
  manager: PackageManager,
  args: readonly string[],
  cwd: string,
) => PackageManagerRun;

export const runPackageManagerDefault: PackageManagerRunner = (
  manager,
  args,
  cwd,
) => {
  const run = spawnSync(manager, [...args], { cwd, stdio: "inherit" });
  return { ok: run.status === 0, status: run.status };
};

/** Formats the command for diagnostics and console output. */
export function packageManagerCommand(
  manager: PackageManager,
  args: readonly string[],
): string {
  return [manager, ...args].join(" ");
}
