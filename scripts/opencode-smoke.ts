#!/usr/bin/env bun
// Smoke-test that OpenCode actually loads @atlante/opencode as a server
// plugin. The host drops packages that expose no plugin target silently
// (its report.missing handler is a no-op), so a broken manifest shape
// passes every static check and still ships an adapter that never boots.
// This exercises the real host loader end to end: manifest discovery,
// entry resolution, plugin runtime, and agent injection.
//
// Downloads the pinned OpenCode CLI into a sandbox (network); everything
// else stays offline: the plugin is referenced by file path and the host
// boots with empty cache, data, and config directories, so no registry
// access or host credentials are involved.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// Pin the host version and bump deliberately after validating the new
// loader against this flow; a floating latest would turn upstream changes
// into CI noise instead of a reviewable signal.
const OPENCODE_PACKAGE_VERSION = "1.18.25";
const PLUGIN_PACKAGE = join(ROOT, "packages", "opencode");
const CLI = join(ROOT, "packages", "cli", "dist", "bin", "atlante.js");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
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
  const opencode = join(sandbox, "node_modules", ".bin", "opencode");
  const reported = (
    await Bun.$`${opencode} --version`.cwd(sandbox).text()
  ).trim();
  assert(
    reported === OPENCODE_PACKAGE_VERSION,
    `unexpected OpenCode version: ${reported}`,
  );

  // Author a user project the way atlante init does: the first-party pack
  // as a dependency, a config extending it, and the plugin referenced by
  // file path so the boot never touches the npm registry.
  const project = join(sandbox, "project");
  await mkdir(join(project, "node_modules", "@atlante"), { recursive: true });
  await cp(
    join(ROOT, "packages", "pack"),
    join(project, "node_modules", "@atlante", "pack"),
    { recursive: true },
  );
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
      plugin: [PLUGIN_PACKAGE],
    })}\n`,
  );

  // Publish the artifacts the plugin materializes at boot.
  await Bun.$`node ${CLI} build`.cwd(project).quiet();

  // Boot the host with empty cache, data, and config directories and
  // assert the plugin registered its architect agent. A boot that exits 0
  // without the agent is the silent-drop signature this smoke exists to
  // catch, so it must fail loudly.
  const boot = Bun.spawn([opencode, "agent", "list"], {
    cwd: project,
    env: {
      ...process.env,
      XDG_CACHE_HOME: join(sandbox, "cache"),
      XDG_DATA_HOME: join(sandbox, "data"),
      XDG_CONFIG_HOME: join(sandbox, "config"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, errors, exitCode] = await Promise.all([
    new Response(boot.stdout).text(),
    new Response(boot.stderr).text(),
    boot.exited,
  ]);
  assert(exitCode === 0, `opencode agent list exited ${exitCode}: ${errors}`);
  assert(
    /^architect\b/m.test(output),
    `opencode booted without the architect agent; the plugin was likely dropped silently. Output tail:\n${output.slice(-400)}`,
  );

  console.log("OpenCode plugin smoke test passed");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
