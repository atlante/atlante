#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..");
const PACKAGE_DIRS = [
  "schema",
  "templates",
  "presets",
  "validator",
  "resolver",
  "opencode-plugin",
  "cli",
] as const;

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

type PackageDir = (typeof PACKAGE_DIRS)[number];

interface Version {
  raw: string;
  major: bigint;
  minor: bigint;
  patch: bigint;
}

interface PackageFile {
  directory: PackageDir;
  path: string;
  json: Record<string, unknown>;
  currentVersion: string;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface ReleaseOptions {
  version: Version;
  dryRun: boolean;
  yes: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string): never {
  throw new Error(message);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runCommand(
  command: string,
  cwd = PROJECT_ROOT,
): Promise<CommandResult> {
  const result = await Bun.$`sh -c ${command}`.cwd(cwd).quiet().nothrow();
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function printCommandOutput(result: CommandResult): void {
  const output = [result.stderr.trimEnd(), result.stdout.trimEnd()]
    .filter(Boolean)
    .join("\n");
  if (output) {
    console.error(output);
  }
}

async function runChecked(
  command: string,
  description: string,
  cwd = PROJECT_ROOT,
): Promise<CommandResult> {
  const result = await runCommand(command, cwd);
  if (result.exitCode !== 0) {
    printCommandOutput(result);
    fail(`${description} exited with code ${result.exitCode}`);
  }
  return result;
}

function parseVersion(raw: string, label: string): Version {
  const match = VERSION_PATTERN.exec(raw);
  if (!match) {
    fail(`${label} must match X.Y.Z with no pre-release suffix`);
  }

  return {
    raw,
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
  };
}

function compareVersions(left: Version, right: Version): number {
  for (const [leftPart, rightPart] of [
    [left.major, right.major],
    [left.minor, right.minor],
    [left.patch, right.patch],
  ]) {
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}

function parseArguments(args: string[]): ReleaseOptions {
  let versionText: string | undefined;
  let dryRun = false;
  let yes = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--version") {
      if (versionText !== undefined) {
        fail("--version may only be provided once");
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        fail("--version requires a value");
      }
      versionText = value;
      index += 1;
    } else if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--yes") {
      yes = true;
    } else {
      fail(`unknown argument: ${argument}`);
    }
  }

  if (versionText === undefined) {
    fail("--version X.Y.Z is required");
  }

  return {
    version: parseVersion(versionText, "Version"),
    dryRun,
    yes,
  };
}

async function validateRepository(): Promise<void> {
  console.log("🔍 Validating repository state...");

  const branch = await runChecked(
    "git branch --show-current",
    "branch validation",
  );
  if (branch.stdout.trim() !== "main") {
    fail(
      `release must run on main, not ${branch.stdout.trim() || "detached HEAD"}`,
    );
  }

  const status = await runChecked(
    "git status --porcelain",
    "working tree validation",
  );
  if (status.stdout.trim() !== "") {
    fail("working tree is not clean");
  }

  const head = await runChecked("git rev-parse HEAD", "local commit lookup");
  const originMain = await runChecked(
    "git rev-parse origin/main",
    "origin/main lookup",
  );
  if (head.stdout.trim() !== originMain.stdout.trim()) {
    fail("local main is not synchronized with origin/main");
  }

  console.log("✅ Repository is on a clean, synchronized main branch");
}

async function validateVersion(version: Version): Promise<void> {
  const tag = `v${version.raw}`;
  console.log(`🔍 Validating version ${version.raw}...`);

  const localTag = await runChecked(
    `git tag --list ${shellQuote(tag)}`,
    "local tag lookup",
  );
  if (localTag.stdout.split(/\r?\n/).some((line) => line.trim() === tag)) {
    fail(`tag ${tag} already exists locally`);
  }

  const remoteTag = await runChecked(
    `git ls-remote --tags origin refs/tags/${shellQuote(tag)}`,
    "remote tag lookup",
  );
  if (remoteTag.stdout.trim() !== "") {
    fail(`tag ${tag} already exists on origin`);
  }

  const latestResult = await runCommand(
    `git describe --tags --abbrev=0 --match ${shellQuote("v*")}`,
  );
  let latestTag = "";
  if (latestResult.exitCode === 0) {
    latestTag = latestResult.stdout.trim();
  } else if (
    !(
      latestResult.exitCode === 128 &&
      /no names found|cannot describe anything/i.test(latestResult.stderr)
    )
  ) {
    printCommandOutput(latestResult);
    fail(`latest tag lookup exited with code ${latestResult.exitCode}`);
  }

  if (latestTag === "") {
    if (version.raw !== "0.1.0") {
      fail("the first release must be exactly 0.1.0");
    }
  } else {
    const latestVersion = parseVersion(
      latestTag.replace(/^v/, ""),
      "Latest tag",
    );
    if (compareVersions(version, latestVersion) <= 0) {
      fail(`version ${version.raw} must be greater than ${latestTag}`);
    }
  }

  console.log(
    latestTag
      ? `✅ Version is greater than latest tag ${latestTag}`
      : "✅ First release version is 0.1.0",
  );
}

async function readPackageFiles(): Promise<PackageFile[]> {
  const packages: PackageFile[] = [];

  for (const directory of PACKAGE_DIRS) {
    const path = join(PROJECT_ROOT, "packages", directory, "package.json");
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        unknown
      >;
    } catch (error) {
      fail(`could not read ${path}: ${errorMessage(error)}`);
    }

    if (typeof json.version !== "string") {
      fail(`${path} does not contain a string version`);
    }

    packages.push({
      directory,
      path,
      json,
      currentVersion: json.version,
    });
  }

  const versions = new Set(
    packages.map((packageFile) => packageFile.currentVersion),
  );
  if (versions.size !== 1) {
    fail("package versions are not synchronized");
  }

  return packages;
}

async function runPreReleaseChecks(): Promise<void> {
  const checks = [
    ["bun run check", "format and lint check"],
    ["bun run typecheck", "typecheck"],
    ["bun test", "tests"],
    ["bun run build", "build"],
  ] as const;

  for (const [command, description] of checks) {
    console.log(`\n🔍 Running ${description}...`);
    await runChecked(command, description);
    console.log(`✅ ${description} completed`);
  }
}

function expectedPackPaths(directory: PackageDir): string[] {
  const expected = ["dist/ with .js and .d.ts files", "package.json"];
  if (directory === "schema") expected.push("schema/");
  if (directory === "templates" || directory === "presets") {
    expected.push("bundled/");
  }
  return expected;
}

function readPackFilePaths(output: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    fail(`could not parse npm pack output: ${errorMessage(error)}`);
  }

  const records = Array.isArray(parsed) ? parsed : [parsed];
  return records.flatMap((record) => {
    if (typeof record !== "object" || record === null) return [];
    const files = (record as { files?: unknown }).files;
    if (!Array.isArray(files)) return [];
    return files.flatMap((file) => {
      if (typeof file !== "object" || file === null) return [];
      const path = (file as { path?: unknown }).path;
      return typeof path === "string" ? [path] : [];
    });
  });
}

async function validatePacks(): Promise<void> {
  for (const directory of PACKAGE_DIRS) {
    const packagePath = join(PROJECT_ROOT, "packages", directory);
    console.log(`\n🔍 Validating @atlante/${directory} package...`);
    const result = await runChecked(
      "npm pack --dry-run --json",
      `pack validation for @atlante/${directory}`,
      packagePath,
    );
    const paths = readPackFilePaths(result.stdout);
    const missing: string[] = [];

    if (!paths.includes("package.json")) missing.push("package.json");
    if (
      !paths.some((path) => path.startsWith("dist/") && path.endsWith(".js"))
    ) {
      missing.push("dist/*.js");
    }
    if (
      !paths.some((path) => path.startsWith("dist/") && path.endsWith(".d.ts"))
    ) {
      missing.push("dist/*.d.ts");
    }
    if (
      directory === "schema" &&
      !paths.some((path) => path.startsWith("schema/"))
    ) {
      missing.push("schema/");
    }
    if (
      (directory === "templates" || directory === "presets") &&
      !paths.some((path) => path.startsWith("bundled/"))
    ) {
      missing.push("bundled/");
    }

    if (missing.length > 0) {
      fail(
        `@atlante/${directory} package is missing ${missing.join(", ")}; ` +
          `expected ${expectedPackPaths(directory).join(", ")}`,
      );
    }

    console.log(`✅ @atlante/${directory} package contents are valid`);
  }
}

async function runNodeSmokeTest(): Promise<void> {
  console.log("\n🔍 Running Node.js 22 CLI smoke test...");
  const nodeVersion = await runChecked(
    "node --version",
    "Node.js version check",
  );
  const match = /v(\d+)/.exec(nodeVersion.stdout.trim());
  if (match === null || Number(match[1]) < 22) {
    fail(`Node.js 22 or newer is required, found ${nodeVersion.stdout.trim()}`);
  }

  // Run the compiled CLI directly under Node, relying on the workspace
  // symlinks that `bun install` created in node_modules/. This verifies
  // Node.js ESM compatibility without requiring npm publication first.
  await runChecked(
    `node ${shellQuote(join(PROJECT_ROOT, "packages", "cli", "dist", "bin", "atlante.js"))} --help`,
    "CLI help smoke test",
  );
  console.log("✅ Node.js CLI smoke test passed");
}

async function bumpVersions(
  packages: PackageFile[],
  version: Version,
): Promise<void> {
  for (const packageFile of packages) {
    packageFile.json.version = version.raw;
    await writeFile(
      packageFile.path,
      `${JSON.stringify(packageFile.json, null, 2)}\n`,
      "utf8",
    );
    console.log(
      `✅ ${packageFile.path}: ${packageFile.currentVersion} -> ${version.raw}`,
    );
  }
}

async function rewriteExportsForPublish(
  packages: PackageFile[],
): Promise<void> {
  const exportPaths: Record<PackageDir, string> = {
    schema: "./dist/index.js",
    templates: "./dist/index.js",
    presets: "./dist/index.js",
    validator: "./dist/index.js",
    resolver: "./dist/index.js",
    "opencode-plugin": "./dist/index.js",
    cli: "./dist/main.js",
  };

  for (const packageFile of packages) {
    const exportsField = packageFile.json.exports;
    if (
      typeof exportsField !== "object" ||
      exportsField === null ||
      Array.isArray(exportsField)
    ) {
      fail(`${packageFile.path} does not contain an exports object`);
    }

    (exportsField as Record<string, unknown>)["."] =
      exportPaths[packageFile.directory];
    const changes = [`exports["."] -> ${exportPaths[packageFile.directory]}`];

    if (packageFile.directory === "cli") {
      const bin = packageFile.json.bin;
      if (typeof bin !== "object" || bin === null || Array.isArray(bin)) {
        fail(`${packageFile.path} does not contain a bin object`);
      }
      (bin as Record<string, unknown>).atlante = "./dist/bin/atlante.js";
      changes.push("bin.atlante -> ./dist/bin/atlante.js");
    }

    await writeFile(
      packageFile.path,
      `${JSON.stringify(packageFile.json, null, 2)}\n`,
      "utf8",
    );
    console.log(`✅ ${packageFile.path}: ${changes.join(", ")}`);
  }
}

async function commitAndTag(
  packages: PackageFile[],
  version: Version,
): Promise<void> {
  const paths = packages.map((packageFile) =>
    packageFile.path.slice(PROJECT_ROOT.length + 1),
  );
  await runChecked(
    `git add -- ${paths.map(shellQuote).join(" ")}`,
    "staging release files",
  );

  const staged = await runChecked(
    "git diff --cached --name-only",
    "staged file validation",
  );
  const stagedPaths = staged.stdout
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean)
    .sort();
  const expectedPaths = [...paths].sort();
  if (
    stagedPaths.length !== expectedPaths.length ||
    stagedPaths.some((path, index) => path !== expectedPaths[index])
  ) {
    fail("staging would include files other than the seven package manifests");
  }

  const message = `release: v${version.raw}`;
  await runChecked(`git commit -m ${shellQuote(message)}`, "release commit");
  await runChecked(
    `git tag -a ${shellQuote(`v${version.raw}`)} -m ${shellQuote(`v${version.raw}`)}`,
    "release tag",
  );
  console.log(`✅ Created commit and annotated tag v${version.raw}`);
}

async function pushRelease(version: Version): Promise<void> {
  const tag = `v${version.raw}`;
  console.log("\n🚀 Pushing release...");
  await runChecked("git push origin main", "main push");
  await runChecked(`git push origin ${shellQuote(tag)}`, "tag push");
  console.log(`✅ Pushed main and ${tag}`);
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  await validateRepository();
  await validateVersion(options.version);

  const packages = await readPackageFiles();
  await runPreReleaseChecks();

  console.log("\n🔍 Version bump plan:");
  for (const packageFile of packages) {
    console.log(
      `  ${packageFile.path}: ${packageFile.currentVersion} -> ${options.version.raw}`,
    );
  }

  if (options.dryRun) {
    await validatePacks();
    await runNodeSmokeTest();
    console.log(`\n✅ Dry run complete; no files were changed`);
    console.log(`Would commit: release: v${options.version.raw}`);
    console.log(`Would create annotated tag: v${options.version.raw}`);
    return;
  }

  if (!options.yes) {
    await validatePacks();
    await runNodeSmokeTest();
    console.log("\n⚠️ No --yes supplied; no files were changed.");
    console.log(`Would commit: release: v${options.version.raw}`);
    console.log(`Would create annotated tag: v${options.version.raw}`);
    console.log(`Would push: main and v${options.version.raw}`);
    console.log(
      `Re-run with --yes: bun scripts/release.ts --version ${options.version.raw} --yes`,
    );
    return;
  }

  await bumpVersions(packages, options.version);
  await rewriteExportsForPublish(packages);
  await validatePacks();
  await runNodeSmokeTest();
  await commitAndTag(packages, options.version);
  await pushRelease(options.version);
}

main().catch((error: unknown) => {
  console.error(`❌ Step failed: ${errorMessage(error)}`);
  process.exitCode = 1;
});
