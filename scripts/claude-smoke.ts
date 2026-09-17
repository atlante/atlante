#!/usr/bin/env bun
// Smoke-test that Claude Code discovers the native files the CLI build
// materializes. The host reads `.claude/agents/` and `.claude/skills/`
// straight from disk, so a build that silently writes nothing (or a host
// change that stops discovering native files) passes every static check and
// still ships a harness with no agents or skills. This exercises the real
// flow end to end for the pinned host: pinned host install, user project
// authoring, CLI build, ownership-manifest integrity, native file content,
// host binary health, and idempotent rebuild.
//
// The smoke is credential-free: it never authenticates and never spends a
// model call. Host-side agent resolution (`claude -p`) needs credentials, so
// discovery is proven statically — exact native paths, frontmatter `name`
// and `description`, rendered bodies, and manifest digests — plus the
// credential-free `claude doctor` health check against the pinned binary.
// A live trial against these outputs belongs to `scripts/claude-eval-smoke.ts`
// (developer-only, authenticated).
//
// Downloads the pinned Claude Code CLI into a sandbox (network); everything
// else stays offline: the host boots with empty cache, data, config, and
// state directories so no registry access or host credentials are involved.
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// Pin the host and bump deliberately after validating this flow against the
// new binary; a floating latest would turn upstream changes into CI noise
// instead of a reviewable signal. CLAUDE_PACKAGE_VERSION runs a single pin
// instead of the default, for local experiments.
const DEFAULT_HOST_PIN = "2.1.218";
const PACK_PACKAGE = join(ROOT, "packages", "pack");
const CLI = join(ROOT, "packages", "cli", "dist", "bin", "atlante.js");
const AGENT_ID = "atlante";
const SKILL_IDS = ["brainstorm", "build", "harness", "plan", "review"];
const MANIFEST_PATH = ".atlante/claude-code-native.json";
// The native agent file's prompt signature. The file's description and prompt
// prove the build rendered pack content instead of an empty shell.
const NATIVE_AGENT_SIGNATURE = "You are the lead engineer";

type NativeManifest = {
  format: string;
  version: number;
  files: { kind: string; id: string; path: string; sha256: string }[];
};

type HostResult = Readonly<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function resolvePin(): string {
  return process.env.CLAUDE_PACKAGE_VERSION ?? DEFAULT_HOST_PIN;
}

function hostBinary(sandbox: string): string {
  return join(sandbox, "home", ".local", "bin", "claude");
}

function normalizeReportedVersion(value: string): string {
  const match = value.match(/(\d+\.\d+\.\d+)/);
  assert(match !== null, `unexpected Claude Code version output: ${value}`);
  return (match as RegExpMatchArray)[1] as string;
}

// Installs the pinned native build inside the sandbox HOME, keeping the
// pinned host out of the developer's machine. The installer script takes an
// explicit version and installs everything under $HOME.
async function installHost(sandbox: string, pin: string): Promise<void> {
  const installer = Bun.spawn(
    [
      "bash",
      "-c",
      `curl -fsSL https://claude.ai/install.sh | bash -s -- '${pin}'`,
    ],
    {
      cwd: sandbox,
      env: {
        ...process.env,
        HOME: join(sandbox, "home"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(installer.stdout).text(),
    new Response(installer.stderr).text(),
    installer.exited,
  ]);
  assert(
    exitCode === 0,
    `the Claude Code installer exited ${exitCode} for ${pin}:\n${stderr.slice(-600)}${stdout.slice(-600)}`,
  );
}

// Runs the pinned host with empty cache, data, config, and state directories
// so execution is driven only by the sandbox, never by user state. No command
// here authenticates or spends a model call.
async function runHost(
  projectRoot: string,
  sandbox: string,
  args: readonly string[],
  timeoutMs = 120_000,
): Promise<HostResult> {
  const host = Bun.spawn([hostBinary(sandbox), ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: join(sandbox, "home"),
      XDG_CACHE_HOME: join(sandbox, "cache"),
      XDG_CONFIG_HOME: join(sandbox, "config"),
      XDG_DATA_HOME: join(sandbox, "data"),
      XDG_STATE_HOME: join(sandbox, "state"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => {
    host.kill(9);
  }, timeoutMs);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(host.stdout).text(),
      new Response(host.stderr).text(),
      host.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

type Snapshot = Readonly<{
  files: ReadonlyMap<string, { sha256: string; mtimeMs: number }>;
  manifest: string;
}>;

async function snapshotOutputs(
  project: string,
  manifest: NativeManifest,
): Promise<Snapshot> {
  const paths = [MANIFEST_PATH, ...manifest.files.map((file) => file.path)];
  const files = new Map<string, { sha256: string; mtimeMs: number }>();
  for (const path of paths) {
    const [bytes, info] = await Promise.all([
      readFile(join(project, path)),
      stat(join(project, path)),
    ]);
    files.set(path, {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      mtimeMs: info.mtimeMs,
    });
  }
  return { files, manifest: JSON.stringify(manifest) };
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (cause) {
    throw new Error(`could not parse ${label} as JSON: ${value}`, {
      cause,
    });
  }
}

async function runPin(pin: string): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), "atlante-claude-smoke-"));
  try {
    assert(
      await Bun.file(CLI).exists(),
      "CLI dist is missing; run bun run build before the smoke test",
    );

    await installHost(sandbox, pin);
    const reported = normalizeReportedVersion(
      (await runHost(sandbox, sandbox, ["--version"])).stdout,
    );
    assert(reported === pin, `unexpected Claude Code version: ${reported}`);

    // Author a user project the way atlante init does: the first-party pack
    // as a dependency and a v0.2 config extending it for the claude-code
    // host. No host-owned settings are authored: the build must materialize
    // native files without touching host configuration.
    const project = join(sandbox, "project");
    await mkdir(join(project, "node_modules", "@atlante"), { recursive: true });
    await cp(PACK_PACKAGE, join(project, "node_modules", "@atlante", "pack"), {
      recursive: true,
    });
    await Bun.write(
      join(project, "package.json"),
      `${JSON.stringify({
        name: "claude-smoke-project",
        version: "0.0.0",
        private: true,
      })}\n`,
    );
    await Bun.write(
      join(project, "atlante.jsonc"),
      `${JSON.stringify({
        $schema: "https://atlante.sh/schema/v0.2/schema.json",
        extends: "@atlante/pack",
        hosts: ["claude-code"],
      })}\n`,
    );

    await Bun.$`node ${CLI} build`.cwd(project).quiet();

    // The ownership manifest must account for exactly the first-party native
    // files, and every entry must hash-match the file on disk.
    const manifestText = await Bun.file(join(project, MANIFEST_PATH)).text();
    const manifest = parseJson<NativeManifest>(manifestText, MANIFEST_PATH);
    assert(
      manifest.format === "atlante-claude-code-native" &&
        manifest.version === 1,
      "unexpected ownership manifest",
    );
    assert(
      manifest.files
        .filter((file) => file.kind === "agent")
        .map((file) => file.id)
        .sort()
        .join(",") === AGENT_ID,
      `unexpected agent ids: ${JSON.stringify(manifest.files)}`,
    );
    assert(
      manifest.files
        .filter((file) => file.kind === "skill")
        .map((file) => file.id)
        .sort()
        .join(",") === [...SKILL_IDS].sort().join(","),
      `unexpected skill ids: ${JSON.stringify(manifest.files)}`,
    );
    for (const entry of manifest.files) {
      assert(
        entry.path.startsWith(".claude/agents/") ||
          entry.path.startsWith(".claude/skills/"),
        `unexpected native output path: ${entry.path}`,
      );
      const payload = await Bun.file(join(project, entry.path)).bytes();
      const digest = createHash("sha256").update(payload).digest("hex");
      assert(digest === entry.sha256, `sha256 mismatch for ${entry.path}`);
    }
    const agentPath = join(project, ".claude", "agents", `${AGENT_ID}.md`);
    assert(await Bun.file(agentPath).exists(), "native agent file is missing");
    const agentContent = await Bun.file(agentPath).text();
    assert(
      agentContent.includes(`name: "${AGENT_ID}"`),
      "native agent file is missing its frontmatter name",
    );
    assert(
      agentContent.includes("description: "),
      "native agent file is missing its frontmatter description",
    );
    assert(
      agentContent.includes(NATIVE_AGENT_SIGNATURE),
      "native agent file is missing the rendered prompt body",
    );
    for (const id of SKILL_IDS) {
      const skillPath = join(project, ".claude", "skills", id, "SKILL.md");
      assert(
        await Bun.file(skillPath).exists(),
        `native skill file is missing for ${id}`,
      );
      const skillContent = await Bun.file(skillPath).text();
      assert(
        skillContent.includes(`name: "${id}"`),
        `native skill file is missing its frontmatter name for ${id}`,
      );
      assert(
        skillContent.includes("description: "),
        `native skill file is missing its frontmatter description for ${id}`,
      );
    }

    // Host-owned settings stay host-owned: the build must not author them.
    assert(
      !(await Bun.file(join(project, ".claude", "settings.json")).exists()),
      "the build authored host-owned .claude/settings.json",
    );

    // Credential-free host health: the pinned binary runs without login.
    const doctor = await runHost(project, sandbox, ["doctor"]);
    assert(
      doctor.exitCode === 0,
      `claude doctor exited ${doctor.exitCode}: ${doctor.stderr}`,
    );

    // A second build must be idempotent: identical manifest JSON and no file
    // modifications (same bytes and mtimes) across the owned outputs.
    const before = await snapshotOutputs(project, manifest);
    await Bun.$`node ${CLI} build`.cwd(project).quiet();
    const manifestAfter = parseJson<NativeManifest>(
      await Bun.file(join(project, MANIFEST_PATH)).text(),
      MANIFEST_PATH,
    );
    const after = await snapshotOutputs(project, manifestAfter);
    assert(
      after.manifest === before.manifest,
      "second build changed the ownership manifest",
    );
    for (const [path, info] of before.files) {
      const next = after.files.get(path);
      assert(next !== undefined, `second build removed ${path}`);
      assert(
        next.sha256 === info.sha256,
        `second build rewrote bytes of ${path}`,
      );
      assert(next.mtimeMs === info.mtimeMs, `second build rewrote ${path}`);
    }

    console.log(`Claude Code host smoke test passed (${pin})`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

await runPin(resolvePin());
