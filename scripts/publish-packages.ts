#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

const ROOT = join(import.meta.dir, "..");
// Only the two public packages are published. The other five (schema,
// templates, presets, validator, builder) are private workspaces: they are
// versioned and synchronized by scripts/release.ts, but never published.
const PACKAGES = ["cli", "opencode-plugin"] as const;

function parseArgs() {
  let version: string | undefined;
  let otp: string | undefined;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--otp") {
      otp = process.argv[++i];
      if (!otp) throw new Error("--otp requires a value");
    } else if (!version) {
      version = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!version)
    throw new Error(
      "usage: bun scripts/publish-packages.ts <version> [--otp <code>]",
    );
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`version must match X.Y.Z, got "${version}"`);

  return { version, otp };
}

// Files that must exist verbatim in each public package (relative to the
// package dir) before anything else happens.
const REQUIRED_FILES: Record<string, string[]> = {
  cli: ["dist/bin/atlante.js"],
  "opencode-plugin": [
    "dist/index.js",
    "dist/api.js",
    "dist/index.d.ts",
    "dist/api.d.ts",
  ],
};

// Static, offline bundle inspection: follow every relative runtime import
// reachable from the plugin entry JS files and require each target to exist
// under dist. Bare specifiers (node builtins, the external @opencode-ai/plugin
// peer) are skipped; only files inside dist are followed, so nothing outside
// dist is read and no plugin behavior is invoked.
const RELATIVE_IMPORT_RE =
  /(?:from\s+|import\s*\(\s*|require\s*\()\s*["'](\.[^"']+)["']/g;

async function relativeImports(file: string): Promise<string[]> {
  const text = await readFile(file, "utf8");
  const specs: string[] = [];
  for (const match of text.matchAll(RELATIVE_IMPORT_RE)) {
    specs.push(match[1]);
  }
  return specs;
}

async function pluginImportIssues(
  dir: string,
  name: string,
): Promise<string[]> {
  const issues: string[] = [];
  const distDir = join(dir, "dist");
  const seen = new Set<string>();
  const queue = ["dist/index.js", "dist/api.js"]
    .map((entry) => join(dir, entry))
    .filter((path) => existsSync(path));

  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined) break;
    if (seen.has(file)) continue;
    seen.add(file);

    for (const spec of await relativeImports(file)) {
      const target = resolve(dirname(file), spec);
      if (!target.startsWith(distDir + sep)) {
        issues.push(
          `${name}: import "${spec}" in ${relative(dir, file)} escapes dist`,
        );
        continue;
      }
      if (!existsSync(target)) {
        issues.push(
          `${name}: missing dist/${relative(distDir, target)} (imported by ${relative(dir, file)})`,
        );
        continue;
      }
      if (target.endsWith(".js") && !seen.has(target)) queue.push(target);
    }
  }
  return issues;
}

async function preflightArtifacts(): Promise<string[]> {
  const missing: string[] = [];

  for (const pkg of PACKAGES) {
    const dir = join(ROOT, "packages", pkg);
    const name = `@atlante/${pkg}`;

    for (const rel of REQUIRED_FILES[pkg]) {
      if (!existsSync(join(dir, rel))) missing.push(`${name}: missing ${rel}`);
    }

    if (pkg === "cli") {
      const launcher = join(dir, "dist", "bin", "atlante.js");
      if (existsSync(launcher)) {
        const head = await readFile(launcher, "utf8");
        if (!head.startsWith("#!/usr/bin/env node"))
          missing.push(`${name}: dist/bin/atlante.js shebang is not node`);
      }
      for (const asset of ["bundled/templates", "bundled/presets"]) {
        const assetDir = join(dir, asset);
        if (!existsSync(assetDir) || (await readdir(assetDir)).length === 0)
          missing.push(`${name}: ${asset} is missing or empty`);
      }
    } else if (pkg === "opencode-plugin") {
      missing.push(...(await pluginImportIssues(dir, name)));
    }
  }

  return missing;
}

async function publishPackage(pkg: string, version: string, otp?: string) {
  const dir = join(ROOT, "packages", pkg);
  const manifestPath = join(dir, "package.json");
  const original = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(original);

  // npm does not strip devDependencies from the packed/published manifest, so
  // repo-only dev tooling (e.g. the plugin's `@atlante/builder:
  // workspace:*`) would ship verbatim. Drop the field for the pack/publish
  // cycle and restore the byte-exact original in `finally` below.
  delete manifest.devDependencies;

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const name = `@atlante/${pkg}`;

  try {
    // Validate
    const pack = await Bun.$`npm pack --dry-run`.cwd(dir).quiet().nothrow();
    if (pack.exitCode !== 0) {
      const err =
        pack.stderr.toString() || pack.stdout.toString() || "npm pack failed";
      throw new Error(`${name}: ${err.trim()}`);
    }
    console.log(`Validated ${name}`);

    // Publish
    const publishArgs = ["publish"];
    if (otp) {
      publishArgs.push("--otp", otp);
    }

    const pub = await Bun.$`npm ${publishArgs}`.cwd(dir).nothrow();
    if (pub.exitCode !== 0) {
      const err =
        pub.stderr.toString() || pub.stdout.toString() || "npm publish failed";
      throw new Error(`${name}: ${err.trim()}`);
    }
    console.log(`Published ${name}@${version}`);
  } finally {
    await writeFile(manifestPath, original);
  }
}

async function main() {
  const { version, otp } = parseArgs();

  // Two-phase, all-or-nothing preflight: every required artifact of BOTH
  // public packages must exist before any manifest mutation, npm pack, or
  // npm publish, so a missing artifact can never leave a partial release
  // (dist/ and cli bundled/ are gitignored generated output; a fresh
  // checkout must build first).
  const missing = await preflightArtifacts();
  if (missing.length > 0) {
    throw new Error(`${missing.join("\n")}\nrun \`bun run build\` first`);
  }

  for (const pkg of PACKAGES) {
    console.log(`\n--- @atlante/${pkg} ---`);
    await publishPackage(pkg, version, otp);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${msg}`);
  process.exitCode = 1;
});
