#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "packages", "cli", "bin", "atlante.ts");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const project = await mkdtemp(join(tmpdir(), "atlante-smoke-"));

try {
  const version = (await Bun.$`bun ${CLI} --version`.cwd(ROOT).text()).trim();
  const pkg = await Bun.file(
    join(ROOT, "packages", "cli", "package.json"),
  ).json();
  assert(version === pkg.version, `unexpected CLI version: ${version}`);

  await Bun.$`bun ${CLI} init ${project}`.cwd(ROOT);
  assert(
    await Bun.file(join(project, "atlante.jsonc")).exists(),
    "init did not write atlante.jsonc",
  );
  const opencode = await Bun.file(join(project, "opencode.jsonc")).text();
  assert(
    opencode.includes("@atlante/opencode-plugin"),
    "missing @atlante/opencode-plugin in opencode.jsonc",
  );

  await Bun.$`bun ${CLI} validate ${project}`.cwd(ROOT);
  await Bun.$`bun ${CLI} build ${project}`.cwd(ROOT);

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

  // A broken configuration must fail loudly rather than exit 0.
  // The validate output is expected to be an error, so it is silenced.
  console.log("expecting validate to reject an invalid configuration...");
  await writeFile(
    join(project, "atlante.jsonc"),
    '{"$schema":"https://atlante.sh/schema/v0.1/schema.json","agents":{"a":{"identity":"x"}}}',
  );
  const invalid = await Bun.$`bun ${CLI} validate ${project}`
    .cwd(ROOT)
    .quiet()
    .nothrow();
  assert(
    invalid.exitCode !== 0,
    "validate exited 0 on an invalid configuration",
  );

  console.log("Smoke test passed");
} finally {
  await rm(project, { recursive: true, force: true });
}
