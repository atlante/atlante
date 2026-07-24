#!/usr/bin/env bun
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = import.meta.dir;
const PROJECT_ROOT = join(ROOT, "..");

const PACKAGES = [
  "schema",
  "templates",
  "presets",
  "validator",
  "resolver",
  "opencode-plugin",
  "cli",
] as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function validateOutput(pkg: string): Promise<boolean> {
  const dist = join(PROJECT_ROOT, "packages", pkg, "dist");
  let entries: Dirent[];

  try {
    entries = await readdir(dist, { withFileTypes: true });
  } catch (error) {
    console.error(
      `❌ @atlante/${pkg}: dist/ is missing (${errorMessage(error)})`,
    );
    return false;
  }

  let valid = entries.some(
    (entry) => entry.isFile() && entry.name.endsWith(".js"),
  );
  if (!valid) {
    console.error(`❌ @atlante/${pkg}: dist/ contains no .js files`);
  }

  if (!(await Bun.file(join(dist, "index.js")).exists())) {
    console.error(`❌ @atlante/${pkg}: dist/index.js is missing`);
    valid = false;
  }

  return valid;
}

async function runTsc(cwd: string, project: string): Promise<boolean> {
  const result = await Bun.$`bunx --no-install tsc --project ${project}`
    .cwd(cwd)
    .nothrow();
  if (result.exitCode === 0) {
    return true;
  }

  const stderr = result.stderr.toString();
  const stdout = result.stdout.toString();
  console.error(stderr || stdout || `tsc exited with code ${result.exitCode}`);
  return false;
}

async function main(): Promise<void> {
  const checkMode = process.argv.includes("--check");
  let failed = false;

  for (const pkg of PACKAGES) {
    const cwd = join(PROJECT_ROOT, "packages", pkg);

    if (checkMode) {
      console.log(`\n🔍 Checking @atlante/${pkg} build output...`);
      continue;
    }

    console.log(`\n🔨 Building @atlante/${pkg}...`);
    if (!(await runTsc(cwd, "tsconfig.build.json"))) {
      failed = true;
    }

    if (pkg === "cli") {
      if (!(await runTsc(cwd, "tsconfig.build.bin.json"))) {
        failed = true;
      }
    }
  }

  for (const pkg of PACKAGES) {
    if (!(await validateOutput(pkg))) {
      failed = true;
    }
  }

  if (failed) {
    console.error("\n❌ Build failed");
    process.exit(1);
  }

  console.log(
    checkMode ? "\n✅ Build outputs are valid" : "\n✅ Build complete",
  );
}

main().catch((error: unknown) => {
  console.error(`\n❌ Build failed: ${errorMessage(error)}`);
  process.exit(1);
});
