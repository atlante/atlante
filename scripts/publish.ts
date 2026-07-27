#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PACKAGES = [
  "schema",
  "templates",
  "presets",
  "validator",
  "resolver",
  "opencode-plugin",
  "cli",
] as const;

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
    throw new Error("usage: bun scripts/publish.ts <version> [--otp <code>]");
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`version must match X.Y.Z, got "${version}"`);

  return { version, otp };
}

function transformExports(
  exports: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "string" && value.endsWith(".ts")) {
      const stem = value.replace("./src/", "./dist/").slice(0, -3);
      result[key] = { import: `${stem}.js`, types: `${stem}.d.ts` };
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function publishPackage(pkg: string, version: string, otp?: string) {
  const dir = join(ROOT, "packages", pkg);
  const manifestPath = join(dir, "package.json");
  const original = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(original);

  manifest.exports = transformExports(manifest.exports);

  if (manifest.bin?.atlante) {
    manifest.bin.atlante = manifest.bin.atlante
      .replace("./bin/", "./dist/bin/")
      .replace(".ts", ".js");
  }

  for (const field of ["dependencies", "peerDependencies", "devDependencies"]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (range === "workspace:*") manifest[field][name] = `^${version}`;
    }
  }

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
    const publishArgs = ["publish", "--access", "public"];
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
