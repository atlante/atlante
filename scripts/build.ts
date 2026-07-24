#!/usr/bin/env bun
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");
const PACKAGES = [
  "schema",
  "templates",
  "presets",
  "validator",
  "resolver",
  "opencode-plugin",
  "cli",
] as const;

const checkMode = process.argv.includes("--check");

// Build
for (const pkg of PACKAGES) {
  const cwd = join(ROOT, "packages", pkg);

  if (checkMode) {
    console.log(`Checking @atlante/${pkg} build output...`);
    continue;
  }

  console.log(`Building @atlante/${pkg}...`);
  await Bun.$`${TSC} --project tsconfig.build.json`.cwd(cwd);

  if (pkg === "cli") {
    await Bun.$`${TSC} --project tsconfig.build.bin.json`.cwd(cwd);
  }
}

// Validate
for (const pkg of PACKAGES) {
  const dist = join(ROOT, "packages", pkg, "dist");
  const entries = await readdir(dist);
  if (!entries.some((e) => e.endsWith(".js"))) {
    throw new Error(`@atlante/${pkg}: no .js files in dist/`);
  }
}

console.log(checkMode ? "Build outputs are valid" : "Build complete");
