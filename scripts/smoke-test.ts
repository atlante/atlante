#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin", "atlante.js");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const project = await mkdtemp(join(tmpdir(), "atlante-smoke-"));

try {
  const version = (await Bun.$`node ${CLI} --version`.cwd(ROOT).text()).trim();
  const pkg = await Bun.file(
    join(ROOT, "packages", "cli", "package.json"),
  ).json();
  assert(version === pkg.version, `unexpected CLI version: ${version}`);

  await Bun.$`node ${CLI} init ${project}`.cwd(ROOT);
  assert(
    await Bun.file(join(project, "atlante.jsonc")).exists(),
    "init did not write atlante.jsonc",
  );
  const opencode = await Bun.file(join(project, "opencode.jsonc")).text();
  assert(
    opencode.includes("@atlante/opencode-plugin"),
    "missing @atlante/opencode-plugin in opencode.jsonc",
  );

  await Bun.$`node ${CLI} validate ${project}`.cwd(ROOT);
  await Bun.$`node ${CLI} build ${project}`.cwd(ROOT);

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

  const rootConfig = await Bun.file(join(ROOT, "atlante.jsonc")).text();
  assert(
    rootConfig.includes('"./resources/architect"'),
    "root config does not dogfood the local architect resource",
  );
  assert(
    rootConfig.includes('"./resources/delivery-workflow"'),
    "root config does not dogfood the local workflow resource",
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
    agents: { id: string; description: string; path: string }[];
    skills: { id: string; description: string; path: string }[];
  };
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
  await rm(project, { recursive: true, force: true });
}
