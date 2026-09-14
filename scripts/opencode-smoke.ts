#!/usr/bin/env bun
// Smoke-test that the OpenCode host actually discovers the native files the
// CLI build materializes. There is no runtime plugin anymore: the host reads
// .opencode/agents/ and .opencode/skills/ straight from disk, so a build that
// silently writes nothing (or a host change that stops discovering native
// files) passes every static check and still ships a harness with no agents
// or skills. This exercises the real flow end to end: pinned host install,
// user project authoring without any plugin, CLI build, ownership-manifest
// integrity, host agent discovery, host-owned config merge, native skill
// discovery, and idempotent rebuild.
//
// Downloads the pinned OpenCode CLI into a sandbox (network); everything
// else stays offline: the host boots with empty cache, data, config, and
// state directories so no registry access or host credentials are involved.
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// Pin the host version and bump deliberately after validating this flow
// against the new loader (1.18.26 is the spike-verified version); a floating
// latest would turn upstream changes into CI noise instead of a reviewable
// signal. OPENCODE_PACKAGE_VERSION overrides the pin for local experiments.
const DEFAULT_OPENCODE_PACKAGE_VERSION = "1.18.26";
const OPENCODE_PACKAGE_VERSION =
  process.env.OPENCODE_PACKAGE_VERSION ?? DEFAULT_OPENCODE_PACKAGE_VERSION;
const PACK_PACKAGE = join(ROOT, "packages", "pack");
const CLI = join(ROOT, "packages", "cli", "dist", "bin", "atlante.js");
const AGENT_ID = "atlante";
const SKILL_IDS = ["brainstorm", "build", "harness", "plan", "review"];
const MANIFEST_PATH = ".atlante/opencode-native.json";

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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

// Boot the sandboxed host against the project with empty cache, data,
// config, and state directories (plus an isolated HOME) so discovery is
// driven only by the project's own native files.
async function runHost(
  projectRoot: string,
  sandbox: string,
  args: readonly string[],
): Promise<HostResult> {
  const opencode = join(sandbox, "node_modules", ".bin", "opencode");
  const host = Bun.spawn([opencode, ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: join(sandbox, "home"),
      OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
      OPENCODE_PURE: "1",
      XDG_CACHE_HOME: join(sandbox, "cache"),
      XDG_CONFIG_HOME: join(sandbox, "config"),
      XDG_DATA_HOME: join(sandbox, "data"),
      XDG_STATE_HOME: join(sandbox, "state"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(host.stdout).text(),
    new Response(host.stderr).text(),
    host.exited,
  ]);
  return { stdout, stderr, exitCode };
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

const sandbox = await mkdtemp(join(tmpdir(), "atlante-opencode-smoke-"));
try {
  assert(
    await Bun.file(CLI).exists(),
    "CLI dist is missing; run bun run build before the smoke test",
  );

  // Install the pinned host into the sandbox so the tested binary version
  // is explicit and independent of the machine running the smoke.
  await Bun.write(
    join(sandbox, "package.json"),
    `${JSON.stringify({
      name: "opencode-smoke-host",
      version: "0.0.0",
      private: true,
    })}\n`,
  );
  await Bun.$`bun add opencode-ai@${OPENCODE_PACKAGE_VERSION}`
    .cwd(sandbox)
    .quiet();
  const reported = (
    await Bun.$`${join(sandbox, "node_modules", ".bin", "opencode")} --version`
      .cwd(sandbox)
      .text()
  ).trim();
  assert(
    reported === OPENCODE_PACKAGE_VERSION,
    `unexpected OpenCode version: ${reported}`,
  );

  // Author a user project the way atlante init does: the first-party pack
  // as a dependency and a config extending it. The host config carries no
  // plugin; it only contributes host-owned agent settings that must compose
  // with the native agent file the build materializes.
  const project = join(sandbox, "project");
  await mkdir(join(project, "node_modules", "@atlante"), { recursive: true });
  await cp(PACK_PACKAGE, join(project, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  await Bun.write(
    join(project, "package.json"),
    `${JSON.stringify({
      name: "opencode-smoke-project",
      version: "0.0.0",
      private: true,
    })}\n`,
  );
  await Bun.write(
    join(project, "atlante.jsonc"),
    `${JSON.stringify({
      $schema: "https://atlante.sh/schema/v0.1/schema.json",
      extends: "@atlante/pack",
    })}\n`,
  );
  await Bun.write(
    join(project, "opencode.json"),
    `${JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      agent: {
        [AGENT_ID]: {
          mode: "primary",
          permission: { edit: "ask", bash: "deny" },
        },
      },
    })}\n`,
  );

  await Bun.$`node ${CLI} build`.cwd(project).quiet();

  // The ownership manifest must account for exactly the first-party native
  // files, and every entry must hash-match the file on disk.
  const manifestText = await Bun.file(join(project, MANIFEST_PATH)).text();
  const manifest = parseJson<NativeManifest>(manifestText, MANIFEST_PATH);
  assert(
    manifest.format === "atlante-opencode-native" && manifest.version === 1,
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
      .join(",") === SKILL_IDS.sort().join(","),
    `unexpected skill ids: ${JSON.stringify(manifest.files)}`,
  );
  for (const entry of manifest.files) {
    assert(
      entry.path.startsWith(".opencode/agents/") ||
        entry.path.startsWith(".opencode/skills/"),
      `unexpected native output path: ${entry.path}`,
    );
    const payload = await Bun.file(join(project, entry.path)).bytes();
    const digest = createHash("sha256").update(payload).digest("hex");
    assert(digest === entry.sha256, `sha256 mismatch for ${entry.path}`);
  }
  assert(
    await Bun.file(
      join(project, ".opencode", "agents", `${AGENT_ID}.md`),
    ).exists(),
    "native agent file is missing",
  );
  for (const id of SKILL_IDS) {
    assert(
      await Bun.file(
        join(project, ".opencode", "skills", id, "SKILL.md"),
      ).exists(),
      `native skill file is missing for ${id}`,
    );
  }

  // Host discovery: the host must list the atlante agent. Because the
  // host-owned config also names the agent, id presence alone cannot prove
  // native discovery; the native-file signature is asserted below via the
  // merged prompt and description, so a build that silently writes no
  // agent file still fails loudly.
  const agents = await runHost(project, sandbox, ["agent", "list", "--pure"]);
  assert(
    agents.exitCode === 0,
    `opencode agent list exited ${agents.exitCode}: ${agents.stderr}`,
  );
  assert(
    new RegExp(`^${AGENT_ID}\\b`, "m").test(agents.stdout),
    `the host booted without the ${AGENT_ID} agent; the native agent file was not discovered. Output tail:\n${agents.stdout.slice(-400)}`,
  );

  // Host-owned merge plus the native-file signature: the discovered agent
  // must reflect the settings from opencode.json (mode and permission
  // rules), while its description and prompt must come from the native
  // agent file (with the file missing, the host returns an empty prompt
  // and no description).
  const agent = await runHost(project, sandbox, [
    "debug",
    "agent",
    AGENT_ID,
    "--pure",
  ]);
  assert(
    agent.exitCode === 0,
    `opencode debug agent ${AGENT_ID} exited ${agent.exitCode}: ${agent.stderr}`,
  );
  const agentConfig = parseJson<Record<string, unknown>>(
    agent.stdout,
    `opencode debug agent ${AGENT_ID}`,
  );
  assert(
    agentConfig.mode === "primary",
    `host-owned mode was not preserved: ${agent.stdout}`,
  );
  assert(
    Array.isArray(agentConfig.permission) &&
      agentConfig.permission.some(
        (rule) =>
          record(rule) && rule.permission === "edit" && rule.action === "ask",
      ) &&
      agentConfig.permission.some(
        (rule) =>
          record(rule) && rule.permission === "bash" && rule.action === "deny",
      ),
    `host-owned permission rules were not preserved: ${agent.stdout}`,
  );
  assert(
    typeof agentConfig.description === "string" &&
      agentConfig.description.length > 0 &&
      String(agentConfig.prompt).includes("You are the lead engineer"),
    `the native agent file content was not discovered (empty prompt/description means the host only saw the config-defined agent): ${agent.stdout}`,
  );

  // Native skill discovery: every first-party skill must be discovered
  // from the project's .opencode/skills directory.
  const skills = await runHost(project, sandbox, ["debug", "skill", "--pure"]);
  assert(
    skills.exitCode === 0,
    `opencode debug skill exited ${skills.exitCode}: ${skills.stderr}`,
  );
  const skillList = parseJson<unknown[]>(skills.stdout, "opencode debug skill");
  // The host reports resolved paths, so compare against the real project
  // location (on macOS /var/... is a symlink to /private/var/...).
  const skillsDir = join(await realpath(project), ".opencode", "skills");
  for (const id of SKILL_IDS) {
    const found = skillList.find((entry) => record(entry) && entry.name === id);
    assert(
      record(found) &&
        typeof found.location === "string" &&
        found.location.startsWith(skillsDir),
      `native skill ${id} was not discovered from ${skillsDir}. Output:\n${skills.stdout}`,
    );
  }

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

  console.log("OpenCode host smoke test passed");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
