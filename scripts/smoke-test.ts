#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI_PACKAGE = join(ROOT, "packages", "cli");
const PACK_PACKAGE = join(ROOT, "packages", "pack");

type NativeManifest = {
  format: string;
  version: number;
  files: { kind: string; id: string; path: string; sha256: string }[];
};

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const sandbox = await mkdtemp(join(tmpdir(), "atlante-smoke-"));
const project = join(sandbox, "project");
const noMcpProject = join(sandbox, "no-mcp-project");
const globalRoot = join(sandbox, "global");
const installedCli = join(globalRoot, "node_modules", "atlante");
const installedPack = join(globalRoot, "node_modules", "@atlante", "pack");
const CLI = join(installedCli, "dist", "bin", "atlante.js");

try {
  // Reproduce a global-style install: the launcher and its runtime static pack
  // are siblings under one node_modules tree, away from the project cwd.
  await mkdir(project, { recursive: true });
  await mkdir(installedCli, { recursive: true });
  await cp(join(CLI_PACKAGE, "dist"), join(installedCli, "dist"), {
    recursive: true,
  });
  await cp(
    join(CLI_PACKAGE, "package.json"),
    join(installedCli, "package.json"),
  );
  await cp(PACK_PACKAGE, installedPack, { recursive: true });
  await cp(
    await realpath(join(CLI_PACKAGE, "node_modules", "jsonc-parser")),
    join(globalRoot, "node_modules", "jsonc-parser"),
    { recursive: true },
  );

  const version = (await Bun.$`node ${CLI} --version`.cwd(ROOT).text()).trim();
  const pkg = await Bun.file(join(installedCli, "package.json")).json();
  assert(version === pkg.version, `unexpected CLI version: ${version}`);

  await Bun.$`node ${CLI} init ${project}`.cwd(project);
  assert(
    await Bun.file(join(project, "atlante.jsonc")).exists(),
    "init did not write atlante.jsonc",
  );
  const config = await Bun.file(join(project, "atlante.jsonc")).text();
  assert(
    config.includes('"extends": "@atlante/pack"'),
    "init did not use the installed @atlante/pack preset",
  );
  assert(
    await Bun.file(join(project, "opencode.jsonc")).exists(),
    "init did not create the OpenCode configuration",
  );
  const openCodeConfig = (await Bun.file(
    join(project, "opencode.jsonc"),
  ).json()) as {
    mcp?: {
      atlante?: { type?: string; command?: unknown; enabled?: boolean };
    };
  };
  assert(
    openCodeConfig.mcp?.atlante?.type === "local",
    "init did not register a local Atlante MCP server",
  );
  assert(
    JSON.stringify(openCodeConfig.mcp?.atlante?.command) ===
      JSON.stringify(["npx", "--yes", `atlante@${pkg.version}`, "mcp"]),
    "init did not register the version-pinned Atlante MCP command",
  );
  assert(
    openCodeConfig.mcp?.atlante?.enabled === true,
    "init did not enable the Atlante MCP server",
  );

  // The explicit opt-out must leave an existing host configuration untouched
  // and must not create a sibling configuration file.
  await mkdir(noMcpProject, { recursive: true });
  const existingHostConfig = '{ "model": "demo" }\n';
  await writeFile(join(noMcpProject, "opencode.json"), existingHostConfig);
  await Bun.$`node ${CLI} init ${noMcpProject} --no-mcp`.cwd(noMcpProject);
  assert(
    (await Bun.file(join(noMcpProject, "opencode.json")).text()) ===
      existingHostConfig,
    "--no-mcp modified the existing OpenCode configuration",
  );
  assert(
    !(await Bun.file(join(noMcpProject, "opencode.jsonc")).exists()),
    "--no-mcp created an OpenCode JSONC configuration",
  );

  await Bun.$`node ${CLI} validate ${project}`.cwd(project);
  await Bun.$`node ${CLI} build ${project}`.cwd(project);

  const manifest = (await Bun.file(
    join(project, ".atlante", "opencode-native.json"),
  ).json()) as NativeManifest;
  assert(
    manifest.format === "atlante-opencode-native" && manifest.version === 1,
    "unexpected ownership manifest",
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

  const agentIds = manifest.files
    .filter((file) => file.kind === "agent")
    .map((file) => file.id)
    .sort();
  assert(
    agentIds.join(",") === "architect",
    `unexpected agent ids: ${agentIds}`,
  );
  const skillIds = manifest.files
    .filter((file) => file.kind === "skill")
    .map((file) => file.id)
    .sort();
  assert(
    skillIds.join(",") === "brainstorm,build,harness,plan,review",
    `unexpected skill ids: ${skillIds}`,
  );

  const contents = await Promise.all(
    manifest.files.map((entry) => Bun.file(join(project, entry.path)).text()),
  );
  assert(
    contents.some((content) => content.includes("You are the lead engineer")),
    "native agent file missing lead engineer content",
  );

  assert(
    await Bun.file(
      join(ROOT, "resources", "architect", "instance.jsonc"),
    ).exists(),
    "tracked local architect resource is missing",
  );

  await Bun.$`node ${CLI} validate ${ROOT}`.cwd(ROOT);
  await Bun.$`node ${CLI} build ${ROOT}`.cwd(ROOT);
  const rootManifest = (await Bun.file(
    join(ROOT, ".atlante", "opencode-native.json"),
  ).json()) as NativeManifest;
  assert(
    rootManifest.format === "atlante-opencode-native" &&
      rootManifest.version === 1,
    "root ownership manifest format changed",
  );
  const rootManifestBefore = JSON.stringify(rootManifest);
  await Bun.$`node ${CLI} build ${ROOT}`.cwd(ROOT);
  const rootManifestAfter = await Bun.file(
    join(ROOT, ".atlante", "opencode-native.json"),
  ).json();
  assert(
    JSON.stringify(rootManifestAfter) === rootManifestBefore,
    "root ownership manifest or hashes changed",
  );
  assert(
    rootManifest.files
      .filter((file) => file.kind === "agent")
      .map((file) => file.id)
      .join(",") === "architect",
    "root architect ID changed",
  );
  assert(
    rootManifest.files
      .filter((file) => file.kind === "skill")
      .map((file) => file.id)
      .sort()
      .join(",") === "brainstorm,build,harness,plan,review",
    "root skill IDs changed",
  );
  assert(
    await Bun.file(join(ROOT, ".opencode", "agents", "architect.md")).exists(),
    "root native architect file is missing",
  );
  assert(
    await Bun.file(
      join(ROOT, ".opencode", "skills", "plan", "SKILL.md"),
    ).exists(),
    "root native skill file is missing",
  );
  const rootContents = await Promise.all(
    rootManifest.files.map((entry) => Bun.file(join(ROOT, entry.path)).text()),
  );
  assert(
    rootContents.some((content) =>
      content.includes("You are the lead engineer for Atlante."),
    ),
    "root architect content changed",
  );

  // A broken configuration must fail loudly rather than exit 0.
  // The validate output is expected to be an error, so it is silenced.
  console.log("expecting validate to reject an invalid configuration...");
  await writeFile(
    join(project, "atlante.jsonc"),
    '{"$schema":"https://atlante.sh/schema/v0.1/schema.json","agents":{"a":{"identity":"x"}}}',
  );
  const invalid = await Bun.$`node ${CLI} validate ${project}`
    .cwd(ROOT)
    .quiet()
    .nothrow();
  assert(
    invalid.exitCode !== 0,
    "validate exited 0 on an invalid configuration",
  );

  console.log("Smoke test passed");
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
