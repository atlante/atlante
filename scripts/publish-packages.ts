#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { withStagedPublishManifest } from "./publish-manifest.js";

const ROOT = join(import.meta.dir, "..");
// The static pack must be published before the CLI that depends on it. The
// CLI bundle includes the internal OpenCode materializer.
const PACKAGES = ["pack", "cli"] as const;
const PACKAGE_NAMES: Record<(typeof PACKAGES)[number], string> = {
  pack: "@atlante/pack",
  cli: "atlante",
};

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
const REQUIRED_FILES: Record<(typeof PACKAGES)[number], string[]> = {
  pack: [
    "package.json",
    "atlante.jsonc",
    "agent/template.jsonc",
    "agent/template.md",
    "architect/instance.jsonc",
  ],
  cli: ["dist/bin/atlante.js"],
};

async function preflightArtifacts(): Promise<string[]> {
  const missing: string[] = [];

  for (const pkg of PACKAGES) {
    const dir = join(ROOT, "packages", pkg);
    const name = PACKAGE_NAMES[pkg];

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
    }
  }

  return missing;
}

function throwOnCommandFailure(
  exitCode: number,
  stderr: string,
  stdout: string,
  fallback: string,
  name: string,
) {
  if (exitCode === 0) return;
  const error = stderr || stdout || fallback;
  throw new Error(`${name}: ${error.trim()}`);
}

// npm rejects republishing an existing version, which would abort a partial
// rerun before its remaining packages were reached.
async function isVersionPublished(
  name: string,
  version: string,
): Promise<boolean> {
  const probe = await Bun.$`npm view ${name}@${version} version`
    .quiet()
    .nothrow();
  return probe.exitCode === 0;
}

async function validatePackage(dir: string, name: string) {
  const pack = await Bun.$`npm pack --dry-run`.cwd(dir).quiet().nothrow();
  throwOnCommandFailure(
    pack.exitCode,
    pack.stderr.toString(),
    pack.stdout.toString(),
    "npm pack failed",
    name,
  );
  console.log(`Validated ${name}`);
}

async function publishPackageContents(
  dir: string,
  name: string,
  version: string,
  otp?: string,
) {
  const publishArgs = otp ? ["publish", "--otp", otp] : ["publish"];
  const published = await Bun.$`npm ${publishArgs}`.cwd(dir).nothrow();
  throwOnCommandFailure(
    published.exitCode,
    published.stderr.toString(),
    published.stdout.toString(),
    "npm publish failed",
    name,
  );
  console.log(`Published ${name}@${version}`);
}

async function publishPackage(
  pkg: (typeof PACKAGES)[number],
  version: string,
  otp?: string,
) {
  const dir = join(ROOT, "packages", pkg);
  const manifestPath = join(dir, "package.json");

  const name = PACKAGE_NAMES[pkg];
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    name?: unknown;
  };
  if (manifest.name !== name) {
    throw new Error(
      `${manifestPath} must declare package name ${name}, got ${String(manifest.name)}`,
    );
  }

  if (await isVersionPublished(name, version)) {
    console.log(`Skipping ${name}@${version} (already published)`);
    return;
  }

  await withStagedPublishManifest(manifestPath, version, async () => {
    await validatePackage(dir, name);
    await publishPackageContents(dir, name, version, otp);
  });
}

async function main() {
  const { version, otp } = parseArgs();

  // Two-phase, all-or-nothing preflight: every required artifact of ALL
  // public packages must exist before any manifest mutation, npm pack, or
  // npm publish, so a missing artifact can never leave a partial release
  // (dist/ is gitignored generated output; a fresh checkout must build first).
  const missing = await preflightArtifacts();
  if (missing.length > 0) {
    throw new Error(`${missing.join("\n")}\nrun \`bun run build\` first`);
  }

  for (const pkg of PACKAGES) {
    console.log(`\n--- ${PACKAGE_NAMES[pkg]} ---`);
    await publishPackage(pkg, version, otp);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\n${msg}`);
  process.exitCode = 1;
});
