#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI_PACKAGE = join(ROOT, "packages", "cli");
const PACK_PACKAGE = join(ROOT, "packages", "pack");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const sandbox = await mkdtemp(join(tmpdir(), "atlante-smoke-"));
const project = join(sandbox, "project");
const globalRoot = join(sandbox, "global");
const installedCli = join(globalRoot, "node_modules", "@atlante", "cli");
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
    join(ROOT, "node_modules", "jsonc-parser"),
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
  const opencode = await Bun.file(join(project, "opencode.jsonc")).text();
  assert(
    opencode.includes("@atlante/opencode-plugin"),
    "missing @atlante/opencode-plugin in opencode.jsonc",
  );

  await Bun.$`node ${CLI} validate ${project}`.cwd(project);
  await Bun.$`node ${CLI} build ${project}`.cwd(project);

  const artifacts = join(project, ".atlante", "artifacts");
  const manifest = (await Bun.file(
    join(artifacts, "manifest.json"),
  ).json()) as {
    format: string;
    version: number;
    agents: { id: string; path: string; sha256: string }[];
    skills: { id: string; path: string; sha256: string }[];
  };
  assert(
    manifest.format === "atlante-artifacts" && manifest.version === 1,
    "unexpected manifest",
  );

  const entries = [...manifest.agents, ...manifest.skills];
  for (const entry of entries) {
    const payload = await Bun.file(join(artifacts, entry.path)).bytes();
    const digest = createHash("sha256").update(payload).digest("hex");
    assert(digest === entry.sha256, `sha256 mismatch for ${entry.path}`);
  }

  const agentIds = manifest.agents.map((agent) => agent.id).sort();
  assert(
    agentIds.join(",") === "architect",
    `unexpected agent ids: ${agentIds}`,
  );
  const skillIds = manifest.skills.map((skill) => skill.id).sort();
  assert(
    skillIds.join(",") === "brainstorming,workflow",
    `unexpected skill ids: ${skillIds}`,
  );

  const contents = await Promise.all(
    entries.map((entry) => Bun.file(join(artifacts, entry.path)).text()),
  );
  assert(
    contents.some((content) => content.includes("You are the lead engineer")),
    "agent artifact missing lead engineer content",
  );
  assert(
    contents.some((content) => content.includes("# Workflow")),
    "skill artifact missing workflow content",
  );

  assert(
    await Bun.file(
      join(ROOT, "resources", "architect", "instance.jsonc"),
    ).exists(),
    "tracked local architect resource is missing",
  );
  assert(
    await Bun.file(
      join(ROOT, "resources", "delivery-workflow", "instance.jsonc"),
    ).exists(),
    "tracked local workflow resource is missing",
  );

  await Bun.$`node ${CLI} validate ${ROOT}`.cwd(ROOT);
  await Bun.$`node ${CLI} build ${ROOT}`.cwd(ROOT);
  const rootManifest = (await Bun.file(
    join(ROOT, ".atlante", "artifacts", "manifest.json"),
  ).json()) as {
    format: string;
    version: number;
    agents: { id: string; description: string; path: string; sha256: string }[];
    skills: { id: string; description: string; path: string; sha256: string }[];
  };
  assert(
    rootManifest.format === "atlante-artifacts" && rootManifest.version === 1,
    "root artifact format changed",
  );
  const rootManifestBefore = JSON.stringify(rootManifest);
  await Bun.$`node ${CLI} build ${ROOT}`.cwd(ROOT);
  const rootManifestAfter = await Bun.file(
    join(ROOT, ".atlante", "artifacts", "manifest.json"),
  ).json();
  assert(
    JSON.stringify(rootManifestAfter) === rootManifestBefore,
    "root artifact manifest or hashes changed",
  );
  assert(
    rootManifest.agents.map(({ id }) => id).join(",") === "architect",
    "root architect artifact ID changed",
  );
  assert(
    rootManifest.skills
      .map(({ id }) => id)
      .sort()
      .join(",") === "brainstorming,workflow",
    "root skill artifact IDs changed",
  );
  assert(
    rootManifest.agents[0]?.description ===
      "Plan, implement, and review Atlante work: clarify scope, delegate execution and reviews, and validate against acceptance criteria. Use for any implementation, review, or workflow session.",
    "root architect description changed",
  );
  assert(
    rootManifest.skills.find(({ id }) => id === "brainstorming")
      ?.description ===
      "Use before creative or implementation work to collaboratively clarify intent, requirements, and design, then produce an approved implementation handoff.",
    "root brainstorming description changed",
  );
  assert(
    rootManifest.skills.find(({ id }) => id === "workflow")?.description ===
      "Use when an approved issue is ready for implementation: deliver a focused, verified change that satisfies its acceptance criteria.",
    "root workflow description changed",
  );
  const rootContents = await Promise.all(
    [...rootManifest.agents, ...rootManifest.skills].map((entry) =>
      Bun.file(join(ROOT, ".atlante", "artifacts", entry.path)).text(),
    ),
  );
  assert(
    rootContents.some((content) =>
      content.includes("You are the lead engineer for Atlante."),
    ),
    "root architect content changed",
  );
  assert(
    rootContents.some((content) => content.includes("# Brainstorming")),
    "root brainstorming content changed",
  );
  assert(
    rootContents.some((content) => content.includes("# Workflow")),
    "root workflow content changed",
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
