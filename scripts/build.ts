#!/usr/bin/env bun
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");
const PACKAGES = [
  "schema",
  "templates",
  "presets",
  "validator",
  "builder",
  "opencode-plugin",
  "cli",
] as const;

// Build
for (const pkg of PACKAGES) {
  const cwd = join(ROOT, "packages", pkg);

  console.log(`Building @atlante/${pkg}...`);
  await rm(join(cwd, "dist"), { force: true, recursive: true });
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

console.log("Build complete");
