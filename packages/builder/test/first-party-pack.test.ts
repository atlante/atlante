import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_URI } from "@atlante/schema";
import { afterEach, describe, expect, test } from "vitest";
import { readArtifacts } from "../src/artifacts-public.js";
import { buildProject } from "../src/index.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

const phaseSkillTitles: Record<string, string> = {
  brainstorm: "# Brainstorm",
  build: "# Build",
  plan: "# Plan",
  review: "# Review",
};

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function firstPartyProject(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-builder-first-party-"));
  created.push(root);
  writeFileSync(
    join(root, "atlante.jsonc"),
    `{
      "$schema": "${SCHEMA_URI}",
      "extends": "@atlante/pack"
    }`,
  );
  cpSync(firstPartyPackRoot, join(root, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-builder-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  return root;
}

describe("first-party pack integration", () => {
  test("builds the preset and the verified reader loads the one agent and four skills", () => {
    const root = firstPartyProject();

    const built = buildProject(root);

    expect(built.diagnostics).toEqual([]);
    const artifacts = readArtifacts(root);
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
    expect(agent?.prompt.trim().length).toBeGreaterThan(0);

    for (const skill of artifacts.skills) {
      expect(
        skill.content.trim().length,
        `${skill.skillId} content`,
      ).toBeGreaterThan(0);
      expect(skill.content, skill.skillId).toContain(
        phaseSkillTitles[skill.skillId],
      );
      expect(skill.content, skill.skillId).toContain("## Overview");
    }
  });
});
