#!/usr/bin/env bun
// Smoke-test that the OpenCode host actually discovers the native files the
// CLI build materializes. There is no runtime plugin anymore: the host reads
// .opencode/agents/ and .opencode/skills/ straight from disk, so a build that
// silently writes nothing (or a host change that stops discovering native
// files) passes every static check and still ships a harness with no agents
// or skills. This exercises the real flow end to end for each pinned host
// dialect: pinned host install, user project authoring without any plugin,
// CLI build, ownership-manifest integrity, host agent discovery, host-owned
// config merge, native skill discovery, and idempotent rebuild.
//
// The V1 and V2 hosts need different discovery surfaces, verified against
// each pinned binary:
//   - V1 exposes `agent list`, `debug agent <id>`, and `debug skill` and is
//     booted with `--pure` so it never touches a background service.
//   - V2 removed those commands; the smoke verifies its resolved-config
//     merge and its agent resolution behavior instead (see
//     verifyV2Discovery for the exact surfaces and their limits).
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
// Pin both host dialects and bump deliberately after validating this flow
// against the new loader; a floating latest would turn upstream changes into
// CI noise instead of a reviewable signal. OPENCODE_PACKAGE_VERSION runs a
// single pin instead of both, for local experiments.
const DEFAULT_HOST_PINS = [
  { version: "1.18.29", dialect: "v1" },
  { version: "2.0.3", dialect: "v2" },
] as const;
const PACK_PACKAGE = join(ROOT, "packages", "pack");
const CLI = join(ROOT, "packages", "cli", "dist", "bin", "atlante.js");
const AGENT_ID = "atlante";
// The V2 host-owned config defines this extra agent so the smoke can prove
// config-defined agent resolution separately from native-file resolution
// (the native file is the only source of the `atlante` agent id on V2).
const CONFIG_AGENT_ID = "cfgprobe";
const SKILL_IDS = ["brainstorm", "build", "harness", "plan", "review"];
const MANIFEST_PATH = ".atlante/opencode-native.json";
// The native agent file's prompt signature. Because the host-owned config
// also names the agent, id presence alone cannot prove native discovery; the
// merged prompt and description prove the file itself was read.
const NATIVE_AGENT_SIGNATURE = "You are the lead engineer";

type HostPin = Readonly<{ version: string; dialect: "v1" | "v2" }>;

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

function resolvePins(): HostPin[] {
  const override = process.env.OPENCODE_PACKAGE_VERSION;
  if (override === undefined) return [...DEFAULT_HOST_PINS];
  const major = Number.parseInt(override.replace(/^opencode\s*v?/, ""), 10);
  return [
    {
      version: override,
      dialect: major >= 2 ? "v2" : "v1",
    },
  ];
}

// V1 publishes one host-agnostic npm package; V2 ships per-platform npm
// packages behind its official installer, which lands the binary in
// $HOME/.opencode/bin. Installing inside the sandbox HOME keeps the pinned
// V2 host out of the developer's machine.
function hostBinary(sandbox: string, dialect: "v1" | "v2"): string {
  return dialect === "v2"
    ? join(sandbox, "home", ".opencode", "bin", "opencode")
    : join(sandbox, "node_modules", ".bin", "opencode");
}

// The V1 npm binary prints a bare version; the V2-installed binary prints
// "opencode v<version>".
function normalizeReportedVersion(value: string): string {
  return value.trim().replace(/^opencode\s*v?/i, "");
}

async function installHost(sandbox: string, pin: HostPin): Promise<void> {
  if (pin.dialect === "v1") {
    await Bun.$`bun add opencode-ai@${pin.version}`.cwd(sandbox).quiet();
    return;
  }
  const installer = Bun.spawn(
    [
      "bash",
      "-c",
      `curl -fsSL https://opencode.ai/v2/install | bash -s -- --version '${pin.version}' --no-modify-path`,
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
    `the OpenCode V2 installer exited ${exitCode} for ${pin.version}:\n${stderr.slice(-600)}${stdout.slice(-600)}`,
  );
}

// Boots the pinned host against the project with empty cache, data,
// config, and state directories so discovery is driven only by the project's
// own native files. V1 additionally gets --pure plus its service opt-outs;
// V2 anchors HOME at the project because its managed service resolves the
// discovery location from HOME.
async function runHost(
  projectRoot: string,
  sandbox: string,
  dialect: "v1" | "v2",
  args: readonly string[],
  timeoutMs = 120_000,
): Promise<HostResult> {
  const host = Bun.spawn([hostBinary(sandbox, dialect), ...args], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: dialect === "v2" ? projectRoot : join(sandbox, "home"),
      // V1-only service opt-outs. The V2 host reads OPENCODE_PURE itself and
      // an empty agent registry is the observed result, so V2 gets plain
      // env: its sandbox isolation comes from the XDG directories and HOME.
      ...(dialect === "v1"
        ? { OPENCODE_DISABLE_EXTERNAL_SKILLS: "1", OPENCODE_PURE: "1" }
        : {}),
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

// V1 discovery: the host lists agents and skills directly.
async function verifyV1Discovery(
  project: string,
  sandbox: string,
): Promise<void> {
  const agents = await runHost(project, sandbox, "v1", [
    "agent",
    "list",
    "--pure",
  ]);
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
  const agent = await runHost(project, sandbox, "v1", [
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
      String(agentConfig.prompt).includes(NATIVE_AGENT_SIGNATURE),
    `the native agent file content was not discovered (empty prompt/description means the host only saw the config-defined agent): ${agent.stdout}`,
  );

  // Native skill discovery: every first-party skill must be discovered
  // from the project's .opencode/skills directory.
  const skills = await runHost(project, sandbox, "v1", [
    "debug",
    "skill",
    "--pure",
  ]);
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
}

// V2 discovery. V2.0.3 removed V1's `agent list`, `debug agent`, and
// `debug skill` commands, and its experimental agent/skill listing endpoints
// proved unreliable for headless assertions, so the smoke verifies what the
// binary exposes deterministically:
//   1. the resolved configuration — the host must parse the V2-native
//      `agents` + ordered `permissions` shapes and normalize them;
//   2. agent resolution through `run` — a missing agent fails fast with
//      "Agent not found", while the native-file-only agent must get past
//      agent resolution (the run then fails on the deliberately unknown
//      model, which is the expected fast error). V2.0.3 resolves agents
//      from files and built-ins; agents defined only in the config's
//      `agents` map are visible in the resolved configuration but are not
//      resolved by `run`, so the smoke makes no assertion about them.
// Native skill discovery is asserted on the V1 pin; V2.0.3 offers no
// headless skill listing, so the V2 pin keeps the static manifest and
// hash assertions for skills.
async function verifyV2Discovery(
  project: string,
  sandbox: string,
): Promise<void> {
  const config = await runHost(project, sandbox, "v2", [
    "api",
    "--standalone",
    "get",
    "/api/config",
  ]);
  assert(
    config.exitCode === 0,
    `opencode api get /api/config exited ${config.exitCode}: ${config.stderr}`,
  );
  const sources = parseJson<
    {
      type: string;
      path?: string;
      info?: {
        agents?: Record<
          string,
          {
            mode?: string;
            permissions?: {
              action: string;
              resource: string;
              effect: string;
            }[];
          }
        >;
      };
    }[]
  >(config.stdout, "opencode api get /api/config");
  const owned = sources.find(
    (source) =>
      source.path?.endsWith("/opencode.json") === true &&
      source.info?.agents?.[CONFIG_AGENT_ID] !== undefined,
  );
  assert(
    owned !== undefined,
    `the host did not merge the project's V2-native agent config. Sources:\n${config.stdout.slice(-600)}`,
  );
  const mergedAgent = owned.info.agents[CONFIG_AGENT_ID];
  assert(
    mergedAgent.mode === "primary" &&
      Array.isArray(mergedAgent.permissions) &&
      mergedAgent.permissions.some(
        (rule) => rule.action === "edit" && rule.effect === "ask",
      ) &&
      mergedAgent.permissions.some(
        (rule) => rule.action === "shell" && rule.effect === "deny",
      ),
    `host-owned V2 permission rules were not preserved: ${config.stdout}`,
  );

  // Agent resolution: every probe uses a deliberately unknown model so a
  // resolved agent fails fast on the model instead of hanging on a session.
  const modelArgs = ["--model", "no-such-provider/nope", "probe"];
  const missing = await runHost(
    project,
    sandbox,
    "v2",
    [
      "run",
      "--standalone",
      "--format",
      "json",
      "--agent",
      "totally-missing",
      ...modelArgs,
    ],
    60_000,
  );
  assert(
    missing.exitCode !== 0 && missing.stdout.includes("Agent not found"),
    `the missing-agent control did not fail with "Agent not found": ${missing.stdout} ${missing.stderr}`,
  );
  const byNativeFile = await runHost(
    project,
    sandbox,
    "v2",
    [
      "run",
      "--standalone",
      "--format",
      "json",
      "--agent",
      AGENT_ID,
      ...modelArgs,
    ],
    60_000,
  );
  assert(
    byNativeFile.exitCode !== 0 &&
      !byNativeFile.stdout.includes("Agent not found"),
    `the host did not resolve the ${AGENT_ID} agent from the native agent file: ${byNativeFile.stdout} ${byNativeFile.stderr}`,
  );
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

function hostOwnedConfig(dialect: "v1" | "v2"): string {
  // Each dialect gets its native config shape: V1's grouped permission map
  // with bash, and V2's ordered permission rules with shell. Both carry the
  // same intent (edits ask, shell denies) and both must compose with the
  // native agent file the build materializes.
  const config =
    dialect === "v1"
      ? {
          $schema: "https://opencode.ai/config.json",
          agent: {
            [AGENT_ID]: {
              mode: "primary",
              permission: { edit: "ask", bash: "deny" },
            },
          },
        }
      : {
          $schema: "https://opencode.ai/config.json",
          agents: {
            [CONFIG_AGENT_ID]: {
              mode: "primary",
              permissions: [
                { action: "edit", resource: "*", effect: "ask" },
                { action: "shell", resource: "*", effect: "deny" },
              ],
            },
          },
        };
  return `${JSON.stringify(config, null, 2)}\n`;
}

async function runPin(pin: HostPin): Promise<void> {
  const sandbox = await mkdtemp(
    join(tmpdir(), `atlante-opencode-smoke-${pin.dialect}-`),
  );
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
    await installHost(sandbox, pin);
    const reported = normalizeReportedVersion(
      await Bun.$`${hostBinary(sandbox, pin.dialect)} --version`
        .cwd(sandbox)
        .text(),
    );
    assert(
      reported === pin.version,
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
      hostOwnedConfig(pin.dialect),
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

    if (pin.dialect === "v1") await verifyV1Discovery(project, sandbox);
    else await verifyV2Discovery(project, sandbox);

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

    console.log(
      `OpenCode host smoke test passed (${pin.dialect} ${pin.version})`,
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

for (const pin of resolvePins()) {
  await runPin(pin);
}
