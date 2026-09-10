import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type PackageManager = "bun" | "pnpm" | "yarn" | "npm";

export type PackageManagerRun = Readonly<{
  ok: boolean;
  status: number | null;
  /** Message from a spawn failure itself, e.g. a missing manager binary. */
  error?: string;
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
 * An explicit corepack `packageManager` hint (e.g. `"pnpm@9.1.2"`) wins over
 * lockfile inference, so fresh lockfile-less projects are not misclassified.
 */
export function detectPackageManager(
  directory: string,
  fileExists: FileExists = existsSync,
  managerHint?: string,
): PackageManager {
  const hint = managerHint?.split("@")[0];
  if (hint === "bun" || hint === "pnpm" || hint === "yarn" || hint === "npm")
    return hint;
  for (const manager of ["bun", "pnpm", "yarn"] as const) {
    if (LOCKFILES[manager].some((name) => fileExists(join(directory, name))))
      return manager;
  }
  return "npm";
}

const ALL_LOCKFILES: readonly string[] = Object.values(LOCKFILES).flat();

/**
 * Resolves the directory whose manifest and lockfiles govern dependency
 * mutations: the nearest ancestor of `directory` (including itself) holding a
 * package manager lockfile. npm, pnpm, yarn, and bun all scope workspaces this
 * way, and an install inside a workspace member mutates the root manifest,
 * lockfile, and node_modules — so detection, snapshotting, and installation
 * must be rooted there. With no lockfile up the tree, `directory` itself is
 * returned and npm is used.
 */
export function resolveDependencyRoot(
  directory: string,
  fileExists: FileExists = existsSync,
): string {
  let current = directory;
  for (;;) {
    if (ALL_LOCKFILES.some((name) => fileExists(join(current, name))))
      return current;
    const parent = dirname(current);
    if (parent === current) return directory;
    current = parent;
  }
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

/** Command that removes one direct package dependency. */
export function packageManagerRemoveArgs(
  manager: PackageManager,
  packageName: string,
): string[] {
  switch (manager) {
    case "npm":
      return ["uninstall", packageName];
    case "pnpm":
      return ["remove", packageName];
    case "yarn":
      return ["remove", packageName];
    case "bun":
      return ["remove", packageName];
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
  return {
    ok: run.status === 0,
    status: run.status,
    ...(run.error ? { error: run.error.message } : {}),
  };
};

/** Formats the command for diagnostics and console output. */
export function packageManagerCommand(
  manager: PackageManager,
  args: readonly string[],
): string {
  return [manager, ...args].join(" ");
}
