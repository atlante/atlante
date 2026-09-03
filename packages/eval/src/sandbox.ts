import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { type OpenCodeNativeFile, readOpenCodeNative } from "@atlante/opencode";
import type { DiscoveredEvalScenario } from "@atlante/validator";
import type { ResolvedBudget } from "./config.js";
import { runCommand } from "./spawn.js";

/** Thrown when the project's native OpenCode outputs are missing or stale. */
export class NativeOutputsNotVerifiedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeOutputsNotVerifiedError";
  }
}

/**
 * Verifies the project's native OpenCode publication through the adapter's
 * manifest-backed reader. `atlante eval` never builds: missing or stale
 * outputs are an error with `atlante build` as the recovery action.
 */
export function verifyNativeOutputs(
  projectRoot: string,
): ReturnType<typeof readOpenCodeNative> {
  try {
    return readOpenCodeNative(projectRoot);
  } catch (cause) {
    throw new NativeOutputsNotVerifiedError(
      `native output verification failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

export type SnapshotEntry = { path: string; hash: string | null };

export type Sandbox = {
  /** Absolute sandbox project root. */
  root: string;
  /** Isolation state dir with config/, data/, cache/ subdirectories. */
  stateDir: string;
  /** sha256 of every declared file-unchanged path, taken before the session. */
  snapshot: SnapshotEntry[];
  /** Commit created before the host session; anchors diff grading and evidence. */
  baseline: string;
  keep: boolean;
};

export type AssembleSandboxInput = {
  /** Directory holding every sandbox of this run. */
  runRoot: string;
  projectRoot: string;
  scenario: DiscoveredEvalScenario;
  trialIndex: number;
  budget: ResolvedBudget;
  keep: boolean;
};

/** Creates the per-run root under the OS temp directory. */
export function createRunRoot(): string {
  return mkdtempSync(join(tmpdir(), "atlante-eval-"));
}

/** Removes the per-run root (used when not keeping sandboxes). */
export function destroyRunRoot(runRoot: string): void {
  rmSync(runRoot, { recursive: true, force: true });
}

/**
 * Assembles the sandbox for one scenario × trial: fixture copy, verified
 * native outputs, host integration, setup commands, baseline snapshot, and
 * the git baseline commit that enables diff checks.
 */
export async function assembleSandbox(
  input: AssembleSandboxInput,
  prepareHostIntegration: (sandbox: Sandbox) => Promise<void> | void,
): Promise<Sandbox> {
  const name = input.scenario.scenario.name;
  const root = join(
    input.runRoot,
    `${name}-trial-${input.trialIndex}`,
    "project",
  );
  mkdirSync(root, { recursive: true });

  // Isolation state dirs (config/data/cache) inside the trial directory.
  const stateDir = join(
    input.runRoot,
    `${name}-trial-${input.trialIndex}`,
    "state",
  );
  for (const sub of ["config", "data", "cache"]) {
    mkdirSync(join(stateDir, sub), { recursive: true });
  }

  // (a) Fixture copy: the sandbox root starts as a copy of the fixture.
  assertNoSymlinkPath(
    input.projectRoot,
    join(input.projectRoot, input.scenario.scenario.task.fixture),
    "fixture",
  );
  copyFixtureTree(
    join(input.projectRoot, input.scenario.scenario.task.fixture),
    root,
  );

  // (b) Verified native outputs, copied from manifest-backed bytes. The
  // manifest itself stays in the source project; the host only needs the
  // generated files in the disposable sandbox.
  const native = verifyNativeOutputs(input.projectRoot);
  copyNativeFiles(root, native.files);

  const sandbox: Sandbox = {
    root,
    stateDir,
    snapshot: [],
    baseline: "",
    keep: input.keep,
  };

  // (c) Host integration (config authoring is host-specific).
  await prepareHostIntegration(sandbox);

  // (d) Setup commands run in the sandbox before the snapshot. Setup runs
  // pre-trial on author-trusted fixture content, so it keeps the full host
  // env; every command after the trial uses the allowlisted env instead.
  const setup = input.scenario.scenario.task.setup;
  if (setup && setup.length > 0) {
    const outcome = await runCommand(setup, {
      cwd: root,
      timeoutMs: input.budget.setupTimeoutMs,
    });
    if (outcome.timedOut) {
      throw new Error(`setup timed out after ${input.budget.setupTimeoutMs}ms`);
    }
    if (outcome.spawnError !== undefined || outcome.exit !== 0) {
      throw new Error(
        `setup failed: ${outcome.spawnError ?? `exit ${outcome.exit}`}: ${outcome.stderr.slice(-400)}`,
      );
    }
  }

  // (e) Baseline snapshot for file-unchanged checks (anti-cheat guard).
  sandbox.snapshot = fileUnchangedPaths(input.scenario).map((path) => ({
    path,
    hash: sha256File(join(root, path)),
  }));

  // (f) Git baseline for diff-allowlist and diff evidence.
  const git = async (argv: readonly string[]): Promise<string> => {
    const outcome = await runCommand(
      [
        "git",
        "-c",
        "user.name=atlante-eval",
        "-c",
        "user.email=atlante-eval@atlante.local",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.fsmonitor=false",
        ...argv,
      ],
      { cwd: root, timeoutMs: 60_000 },
    );
    if (outcome.exit !== 0) {
      throw new Error(
        `git ${argv.join(" ")} failed (exit ${outcome.exit}): ${outcome.stderr.slice(-400)}`,
      );
    }
    return outcome.stdout.trim();
  };
  await git(["init", "--quiet"]);
  // Track the complete baseline, including files ignored by fixture rules;
  // otherwise later ignored writes cannot be distinguished from baseline.
  await git(["add", "--all", "--force"]);
  await git([
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "atlante-eval baseline",
  ]);
  const baseline = await git(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]+$/.test(baseline)) {
    throw new Error("git baseline did not produce a valid commit id");
  }
  sandbox.baseline = baseline;

  return sandbox;
}

/** Removes the sandbox unless it was kept for inspection. */
export function destroySandbox(sandbox: Sandbox): void {
  if (sandbox.keep) return;
  // The sandbox project sits one level below the per-trial directory.
  rmSync(join(sandbox.root, ".."), { recursive: true, force: true });
}

function sha256File(path: string): string | null {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (!stat?.isFile()) return null;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fileUnchangedPaths(scenario: DiscoveredEvalScenario): string[] {
  return scenario.scenario.checks.flatMap((check) =>
    check.type === "file-unchanged" && "path" in check ? [check.path] : [],
  );
}

const FORBIDDEN_COPY_SEGMENTS = new Set([".git", "node_modules"]);

/**
 * Copies the fixture tree into the sandbox root. Discovery already validated
 * the fixture; the copy still refuses to carry `.git` or `node_modules` into
 * the sandbox (defense in depth, not duplication of validation logic).
 */
function copyFixtureTree(source: string, target: string): void {
  const stat = lstatSync(source, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) {
    if (stat?.isSymbolicLink())
      throw new Error(`fixture must not be a symbolic link: ${source}`);
    throw new Error(`fixture is not a directory: ${source}`);
  }
  mkdirSync(target, { recursive: true });
  const entries = readdirSync(source, {
    withFileTypes: true,
    encoding: "utf8",
  });
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw new Error(`fixture contains a symbolic link: ${entry.name}`);
    if (FORBIDDEN_COPY_SEGMENTS.has(entry.name)) {
      throw new Error(`fixture contains a forbidden entry: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      copyFixtureTree(join(source, entry.name), join(target, entry.name));
    } else if (entry.isFile()) {
      cpSync(join(source, entry.name), join(target, entry.name));
    }
  }
}

function assertNoSymlinkPath(
  base: string,
  target: string,
  label: string,
): void {
  const relativePath = relative(base, target);
  if (
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error(`${label} must resolve inside the project`);
  }

  let current = base;
  if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
    throw new Error(`${label} path traverses a symbolic link`);
  for (const segment of relativePath.split(sep)) {
    if (segment === "" || segment === ".") continue;
    current = join(current, segment);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error(`${label} path traverses a symbolic link`);
  }
}

/** Copies verified native files without following links or overwriting fixtures. */
function copyNativeFiles(
  root: string,
  files: readonly OpenCodeNativeFile[],
): void {
  for (const file of files) {
    const target = join(root, ...file.path.split("/"));
    assertNoSymlinkPath(root, target, "native output");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes, { flag: "wx" });
  }
}
