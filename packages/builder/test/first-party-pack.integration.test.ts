import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openCodeMaterializer } from "@atlante/opencode";
import { SCHEMA_URI } from "@atlante/schema";
import { buildProject } from "../src/index.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

const phaseSkillTitles: Record<string, string> = {
  brainstorm: "# Brainstorm",
  build: "# Build",
  harness: "# Harness",
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
  test("materializes the one agent and five phase skills into native OpenCode outputs", () => {
    const root = firstPartyProject();

    const built = buildProject(
      root,
      {},
      {
        materializers: [openCodeMaterializer],
      },
    );

    expect(built.diagnostics).toEqual([]);
    expect(
      [...(built.materializations[0]?.writtenPaths ?? [])].sort((left, right) =>
        left.localeCompare(right),
      ),
    ).toEqual([
      ".opencode/agents/atlante.md",
      ".opencode/skills/brainstorm/SKILL.md",
      ".opencode/skills/build/SKILL.md",
      ".opencode/skills/harness/SKILL.md",
      ".opencode/skills/plan/SKILL.md",
      ".opencode/skills/review/SKILL.md",
    ]);
    expect(built.materializations[0]?.removedPaths).toEqual([]);

    const agent = readFileSync(
      join(root, ".opencode", "agents", "atlante.md"),
      "utf8",
    );
    expect(agent).toContain("You are the lead engineer");
    expect(agent).toContain("## Workflow");
    expect(agent).toContain("### 1. Brainstorm");
    expect(agent).toContain("### 3. Build");
    expect(agent).toContain("### 4. Review");
    expect(agent).toContain("MUST preserve unrelated user changes.");

    for (const [skillId, title] of Object.entries(phaseSkillTitles)) {
      const content = readFileSync(
        join(root, ".opencode", "skills", skillId, "SKILL.md"),
        "utf8",
      );
      expect(content, skillId).toContain(title);
      expect(content, skillId).toContain("## Overview");
      expect(content.trim().length, skillId).toBeGreaterThan(0);
    }

    const manifest = JSON.parse(
      readFileSync(join(root, ".atlante", "opencode-native.json"), "utf8"),
    ) as {
      format: string;
      version: number;
      files: Array<{ kind: string; id: string; path: string }>;
    };
    expect(manifest.format).toBe("atlante-opencode-native");
    expect(manifest.version).toBe(1);
    expect(
      manifest.files.filter(({ kind }) => kind === "agent").map(({ id }) => id),
    ).toEqual(["atlante"]);
    expect(
      manifest.files
        .filter(({ kind }) => kind === "skill")
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["brainstorm", "build", "harness", "plan", "review"]);
    for (const file of manifest.files)
      expect(
        readFileSync(join(root, ...file.path.split("/")), "utf8").length,
      ).toBeGreaterThan(0);
  });

  test("does not execute or materialize the pack eval suite during a build", () => {
    const root = firstPartyProject();

    const built = buildProject(
      root,
      {},
      { materializers: [openCodeMaterializer] },
    );

    expect(built.diagnostics).toEqual([]);
    expect(existsSync(join(root, ".atlante", "eval"))).toBe(false);
  });
});
