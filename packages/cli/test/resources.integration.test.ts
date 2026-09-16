import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject, loadProject, prepareProject } from "@atlante/builder";
import { openCodeMaterializer } from "@atlante/opencode";
import { createProjectResourcePack, loadPresetFacet } from "@atlante/resources";
import { SCHEMA_URI } from "@atlante/schema";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

function projectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-cli-pack-"));
  created.push(root);
  cpSync(firstPartyPackRoot, join(root, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-cli-pack-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  return root;
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("first-party package resources as user configurations", () => {
  test("keeps pack eval metadata outside the user configuration", () => {
    const root = projectRoot();
    const configPath = join(root, "atlante.jsonc");
    writeFileSync(
      configPath,
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "@atlante/pack"
      }`,
    );
    const source = loadPresetFacet(
      createProjectResourcePack(root),
      "@atlante/pack",
      configPath,
    );

    expect(source.facet.document.eval).toEqual({
      host: "opencode",
      scenarios: "eval/scenarios/*.eval.json",
      fixtures: "eval/fixtures",
      report: "eval/report.json",
      source: "packages/pack/eval",
    });

    const loaded = loadProject(root);
    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.document).toBeDefined();
    expect(loaded.document?.eval).toBeUndefined();
  });

  test("the first-party preset prepares one atlante agent, the four phase skills, and the harness skill", () => {
    const dir = projectRoot();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "@atlante/pack"
      }`,
    );

    const loaded = loadProject(dir);
    expect(loaded.diagnostics).toEqual([]);

    const prepared = prepareProject(dir);

    expect(prepared.diagnostics).toEqual([]);
    expect(prepared.agents.map(({ hostAgentId }) => hostAgentId)).toEqual([
      "atlante",
    ]);
    expect(prepared.skills.map(({ skillId }) => skillId).sort()).toEqual([
      "brainstorm",
      "build",
      "harness",
      "plan",
      "review",
    ]);
  });

  test("the inherited workflow-root default interpolates into prepared artifact paths", () => {
    const dir = projectRoot();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "@atlante/pack",
        "values": { "project": "Atlante" }
      }`,
    );

    const prepared = prepareProject(dir);

    expect(prepared.diagnostics).toEqual([]);
    const [agent] = prepared.agents;
    expect(agent?.prompt).toContain(
      "The artifact SHOULD be stored at .atlante/workflows/<cycle-id>/plan.md.",
    );
    expect(agent?.prompt).toContain(
      "The artifact SHOULD be stored at .atlante/workflows/<cycle-id>/reviews/<scope>-<n>.md.",
    );
    expect(agent?.prompt).not.toContain("{{values.");
  });

  test("the built first-party project materializes one agent and five loadable skills", () => {
    const dir = projectRoot();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "@atlante/pack"
      }`,
    );

    const built = buildProject(
      dir,
      {},
      {
        materializers: [openCodeMaterializer],
      },
    );
    expect(built.diagnostics).toEqual([]);

    const agent = readFileSync(
      join(dir, ".opencode", "agents", "atlante.md"),
      "utf8",
    );
    expect(agent).toContain("## Workflow");
    expect(agent).toContain("### 1. Brainstorm");
    expect(agent).toContain("### 3. Build");
    expect(agent).toContain("### 4. Review");
    expect(agent).toContain("MUST preserve unrelated user changes.");

    const titleLandmarks: Record<string, string> = {
      brainstorm: "# Brainstorm",
      plan: "# Plan",
      build: "# Build",
      review: "# Review",
      harness: "# Harness",
    };
    for (const [skillId, title] of Object.entries(titleLandmarks)) {
      const content = readFileSync(
        join(dir, ".opencode", "skills", "atlante", skillId, "SKILL.md"),
        "utf8",
      );
      expect(content.length, skillId).toBeGreaterThan(0);
      expect(content, skillId).toContain(title);
      expect(content, skillId).toContain("## Overview");
    }

    const manifest = JSON.parse(
      readFileSync(join(dir, ".atlante", "opencode-native.json"), "utf8"),
    ) as { files: Array<{ kind: string; id: string }> };
    expect(
      manifest.files.filter(({ kind }) => kind === "agent").map(({ id }) => id),
    ).toEqual(["atlante"]);
    expect(
      manifest.files
        .filter(({ kind }) => kind === "skill")
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["brainstorm", "build", "harness", "plan", "review"]);
  });

  test("CLI loading returns a canonical document and first-party skill template", () => {
    const dir = projectRoot();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "agents": {
          "reviewer": { "description": "Reviews changes.", "identity": "Review", "mission": "Find defects" }
        },
        "skills": {
          "testing": {
            "description": "Testing guidance",
            "title": "Testing",
            "overview": "Run tests.",
            "sections": [{ "markdown": [{ "type": "paragraph", "children": [{ "type": "text", "value": "Run tests." }] }] }]
          }
        }
      }`,
    );

    const loaded = loadProject(dir);

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.document?.skills?.testing?.description).toBe(
      "Testing guidance",
    );
    expect(loaded.resources?.templates.length).toBeGreaterThan(0);
  });
});
