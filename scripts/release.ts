#!/usr/bin/env bun
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncLockToManifests } from "./package-graph";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// All eight manifests stay synchronized and version-bumped together; the seven
// internal packages plus the static pack are covered by the release graph.
// Publishing is the separate scripts/publish-packages.ts step.
// Packages are listed in architectural layer order, lowest layer first — the
// same order as AGENTS.md and scripts/package-graph.test.ts.
const PACKAGES = [
  "schema",
  "resources",
  "validator",
  "builder",
  "pack",
  "opencode",
  "eval",
  "cli",
] as const;

// Exact-pinned consumers outside the package graph must track the released
// version. Deployment installs (npm inside website/) resolve the pin from
// the registry, where the tagged version exists by the time they run, while
// the local workspace install links the workspace package so dev exercises
// the current source bundle.
const DEPENDENTS = [
  { manifest: "website/package.json", dependency: "@atlante/cli" },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ShellArg = string | number | boolean | null | ShellArg[];

/** Run a shell command at ROOT. Throws on non‑zero exit. Returns trimmed stdout. */
async function run(
  strings: TemplateStringsArray,
  ...values: ShellArg[]
): Promise<string> {
  const r = await Bun.$(strings, ...values)
    .cwd(ROOT)
    .quiet()
    .nothrow();
  if (r.exitCode !== 0) {
    const msg =
      r.stderr.toString() || r.stdout.toString() || `exit ${r.exitCode}`;
    throw new Error(msg.trim());
  }
  return r.stdout.toString().trim();
}

/** Like `run` but returns null on failure (128 + no‑tags). */
async function maybe(
  strings: TemplateStringsArray,
  ...values: ShellArg[]
): Promise<string | null> {
  const r = await Bun.$(strings, ...values)
    .cwd(ROOT)
    .quiet()
    .nothrow();
  if (r.exitCode === 0) return r.stdout.toString().trim();
  return null;
}

interface Pkg {
  dir: string;
  path: string;
  json: Record<string, unknown>;
  currentVersion: string;
}

interface Dependent {
  manifest: string;
  path: string;
  json: Record<string, unknown>;
  dependency: string;
  currentPin: string;
}

// ---------------------------------------------------------------------------
// Version parsing
// ---------------------------------------------------------------------------

function parseVersion(raw: string, label: string) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(raw);
  if (!m) throw new Error(`${label} must match X.Y.Z, got "${raw}"`);
  return { raw, major: +m[1], minor: +m[2], patch: +m[3] };
}

function gt(
  a: ReturnType<typeof parseVersion>,
  b: ReturnType<typeof parseVersion>,
) {
  return (
    a.major > b.major ||
    (a.major === b.major && a.minor > b.minor) ||
    (a.major === b.major && a.minor === b.minor && a.patch > b.patch)
  );
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function parseArgs(args: string[]) {
  let versionText: string | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      if (arg === "--dry-run") {
        dryRun = true;
      } else {
        throw new Error(`unknown argument: ${arg}`);
      }
    } else {
      if (versionText !== undefined)
        throw new Error("only one version may be provided");
      versionText = arg;
    }
  }

  if (versionText === undefined)
    throw new Error("usage: bun scripts/release.ts <version> [--dry-run]");
  return { version: parseVersion(versionText, "Version"), dryRun };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

async function validateRepo() {
  console.log("Validating repository state...");

  const branch = await run`git branch --show-current`;
  if (branch !== "main")
    throw new Error(
      `release must run on main, not ${branch || "detached HEAD"}`,
    );

  const status = await run`git status --porcelain`;
  if (status !== "") throw new Error("working tree is not clean");

  const head = await run`git rev-parse HEAD`;
  const origin = await run`git rev-parse origin/main`;
  if (head !== origin)
    throw new Error("local main is not synchronized with origin/main");

  console.log("Repository is on a clean, synchronized main branch");
}

async function validateVersion(v: ReturnType<typeof parseVersion>) {
  const tag = `v${v.raw}`;
  console.log(`Validating version ${v.raw}...`);

  const localTags = await run`git tag --list ${tag}`;
  if (localTags.split("\n").some((l) => l.trim() === tag))
    throw new Error(`tag ${tag} already exists locally`);

  const remote = await run`git ls-remote --tags origin refs/tags/${tag}`;
  if (remote !== "") throw new Error(`tag ${tag} already exists on origin`);

  const latestTag = await maybe`git describe --tags --abbrev=0 --match 'v*'`;

  if (!latestTag) {
    if (v.raw !== "0.1.0")
      throw new Error("the first release must be exactly 0.1.0");
    console.log("First release version is 0.1.0");
  } else {
    const latest = parseVersion(latestTag.replace(/^v/, ""), "Latest tag");
    if (!gt(v, latest))
      throw new Error(`version ${v.raw} must be greater than ${latestTag}`);
    console.log(`Version is greater than latest tag ${latestTag}`);
  }
}

// bun 1.3.x treats manifest-version drift as a no-op and may leave bun.lock
// untouched (oven-sh/bun#28411, #28935; v0.1.21 shipped a stale lock this
// way). Detection alone strands the release, so the stale entries are synced
// in place — the same invariant scripts/package-graph.test.ts enforces — and
// anything that cannot be repaired fails before any commit or tag exists.
function validateLock() {
  console.log("\nValidating bun.lock against the bumped manifests...");
  const { synced, remaining } = syncLockToManifests({
    packages: PACKAGES,
    pins: DEPENDENTS,
  });
  if (remaining.length > 0)
    throw new Error(
      `bun.lock is stale; the release commit and tag were not created:\n${remaining
        .map((issue) => `  - ${issue}`)
        .join("\n")}`,
    );
  if (synced > 0)
    console.log(
      `Synced ${synced} stale bun.lock ${
        synced === 1 ? "entry" : "entries"
      } (bun 1.3.x ignores workspace-version drift)`,
    );
  console.log("bun.lock matches the bumped manifests");
}

async function readPackages(): Promise<Pkg[]> {
  const pkgs: Pkg[] = [];

  for (const dir of PACKAGES) {
    const path = join(ROOT, "packages", dir, "package.json");
    const json = JSON.parse(await readFile(path, "utf8"));
    if (typeof json.version !== "string")
      throw new Error(`${path} does not contain a string version`);

    pkgs.push({ dir, path, json, currentVersion: json.version });
  }

  const versions = new Set(pkgs.map((p) => p.currentVersion));
  if (versions.size !== 1)
    throw new Error("package versions are not synchronized");

  return pkgs;
}

async function readDependents(): Promise<Dependent[]> {
  const dependents: Dependent[] = [];
  for (const { manifest, dependency } of DEPENDENTS) {
    const path = join(ROOT, manifest);
    const json: Record<string, unknown> = JSON.parse(
      await readFile(path, "utf8"),
    );
    const dependencies = json.dependencies as Record<string, unknown>;
    const pin = dependencies?.[dependency];
    if (typeof pin !== "string")
      throw new Error(
        `${manifest} does not declare ${dependency} in dependencies`,
      );
    if (!/^\d+\.\d+\.\d+$/.test(pin))
      throw new Error(
        `${manifest} must pin ${dependency} to an exact X.Y.Z version, got "${pin}"`,
      );
    dependents.push({ manifest, path, json, dependency, currentPin: pin });
  }
  return dependents;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function bump(pkgs: Pkg[], v: ReturnType<typeof parseVersion>) {
  for (const p of pkgs) {
    p.json.version = v.raw;
    await writeFile(p.path, `${JSON.stringify(p.json, null, 2)}\n`, "utf8");
    console.log(`${p.path}: ${p.currentVersion} → ${v.raw}`);
  }
}

/** Pin dependents to the version being released. */
async function bumpDependents(
  dependents: Dependent[],
  releasedVersion: string,
) {
  for (const d of dependents) {
    (d.json.dependencies as Record<string, unknown>)[d.dependency] =
      releasedVersion;
    await writeFile(d.path, `${JSON.stringify(d.json, null, 2)}\n`, "utf8");
    console.log(
      `${d.manifest}: ${d.dependency} ${d.currentPin} → ${releasedVersion}`,
    );
  }
}

async function commitAndTag(
  pkgs: Pkg[],
  dependents: Dependent[],
  v: ReturnType<typeof parseVersion>,
) {
  const paths = [
    ...pkgs.map((p) => p.path.slice(ROOT.length + 1)),
    ...dependents.map((d) => d.manifest),
    "bun.lock",
  ];
  await run`git add -- ${paths}`;
  await run`git commit --allow-empty -m ${`release: v${v.raw}`}`;
  await run`git tag -a ${`v${v.raw}`} -m ${`v${v.raw}`}`;
  console.log(`Created commit and annotated tag v${v.raw}`);
}

async function pushRelease(v: ReturnType<typeof parseVersion>) {
  const tag = `v${v.raw}`;
  console.log("\nPushing release...");
  await run`git push origin main`;
  await run`git push origin ${tag}`;
  console.log(`Pushed main and ${tag}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { version, dryRun } = parseArgs(process.argv.slice(2));

  await validateRepo();
  await validateVersion(version);
  const pkgs = await readPackages();
  const dependents = await readDependents();

  console.log("\nVersion bump plan:");
  for (const p of pkgs)
    console.log(`  ${p.path}: ${p.currentVersion} → ${version.raw}`);
  for (const d of dependents)
    console.log(
      `  ${d.manifest}: ${d.dependency} ${d.currentPin} → ${version.raw}`,
    );

  if (dryRun) {
    console.log(`\nDry run complete; no files were changed`);
    console.log(`Would commit: release: v${version.raw}`);
    console.log(`Would create annotated tag: v${version.raw}`);
    return;
  }

  await bump(pkgs, version);
  await bumpDependents(dependents, version.raw);
  console.log("\nRefreshing bun.lock...");
  await run`bun install`;
  validateLock();
  await commitAndTag(pkgs, dependents, version);
  await pushRelease(version);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`${msg}`);
  process.exitCode = 1;
});
