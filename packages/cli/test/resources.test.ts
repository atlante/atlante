import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readArtifacts } from "@atlante/artifacts/read-only";
import { buildProject, loadProject, prepareProject } from "@atlante/builder";
import { createProjectResourcePack, loadPresetFacet } from "@atlante/resources";
import { SCHEMA_URI } from "@atlante/schema";
import { validateDocumentText } from "@atlante/validator";

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
  test("the first-party default preset validates against the user configuration schema", () => {
    const root = projectRoot();
    const configPath = join(root, "atlante.jsonc");
    const source = loadPresetFacet(
      createProjectResourcePack(root),
      "@atlante/pack",
      configPath,
    );
    const result = validateDocumentText(
      JSON.stringify(source.facet.document),
      configPath,
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.document).toBeDefined();
  });

  test("the first-party preset prepares one architect agent and the four phase skills", () => {
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
      "architect",
    ]);
    expect(prepared.skills.map(({ skillId }) => skillId).sort()).toEqual([
      "brainstorm",
      "build",
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

  test("the built first-party artifact manifest lists one agent and four loadable skills", () => {
    const dir = projectRoot();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "@atlante/pack"
      }`,
    );

    const built = buildProject(dir);
    expect(built.diagnostics).toEqual([]);

    const artifacts = readArtifacts(dir);
    expect(artifacts).toBeDefined();
    if (!artifacts) throw new Error("expected built first-party artifacts");

    expect(artifacts.agents.map(({ hostAgentId }) => hostAgentId)).toEqual([
      "architect",
    ]);
    expect(artifacts.skills.map(({ skillId }) => skillId).sort()).toEqual([
      "brainstorm",
      "build",
      "plan",
      "review",
    ]);

    const [agent] = artifacts.agents;
    expect(agent?.prompt).toContain("## Workflow");
    expect(agent?.prompt).toContain("### 1. Brainstorm");
    expect(agent?.prompt).toContain("### 3. Build");
    expect(agent?.prompt).toContain("### 4. Review");
    expect(agent?.prompt).toContain("MUST preserve unrelated user changes.");

    const titleLandmarks: Record<string, string> = {
      brainstorm: "# Brainstorm",
      plan: "# Plan",
      build: "# Build",
      review: "# Review",
    };
    for (const skill of artifacts.skills) {
      expect(
        skill.description.length,
        `${skill.skillId} description`,
      ).toBeGreaterThan(0);
      expect(
        skill.content.trim().length,
        `${skill.skillId} content`,
      ).toBeGreaterThan(0);
      expect(skill.content, skill.skillId).toContain(
        titleLandmarks[skill.skillId],
      );
      expect(skill.content, skill.skillId).toContain("## Overview");
    }
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
            "sections": [{ "markdown": "Run tests." }]
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
