import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
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
import { SCHEMA_URI } from "@atlante/schema";
import { createProgram } from "../src/main.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);
const cliEntry = fileURLToPath(new URL("../bin/atlante.ts", import.meta.url));
const launcher = fileURLToPath(
  new URL("../dist/bin/atlante.js", import.meta.url),
);

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

beforeAll(() => {
  const outdir = fileURLToPath(new URL("../dist/bin/", import.meta.url));
  const built = spawnSync(
    "bun",
    [
      "build",
      cliEntry,
      "--target=node",
      "--external",
      "jsonc-parser",
      "--outdir",
      outdir,
    ],
    { encoding: "utf8" },
  );
  if (built.status !== 0)
    throw new Error(`could not build CLI launcher: ${built.stderr}`);
  if (!existsSync(launcher))
    throw new Error("CLI launcher build did not produce dist/bin/atlante.js");
});

function tempProject(): string {
  const directory = mkdtempSync(join(tmpdir(), "atlante-import-command-"));
  created.push(directory);
  cpSync(
    firstPartyPackRoot,
    join(directory, "node_modules", "@atlante", "pack"),
    {
      recursive: true,
    },
  );
  writeFileSync(
    join(directory, "package.json"),
    `${JSON.stringify({
      name: "atlante-import-command-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.2.2" },
    })}\n`,
  );
  return directory;
}

function runCli(args: string[], cwd: string) {
  return spawnSync(launcher, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

describe("atlante import", () => {
  test("registers the import command and its required options", () => {
    const command = createProgram().commands.find(
      (candidate) => candidate.name() === "import",
    );

    expect(command).toBeDefined();
    expect(command?.options.map((option) => option.long)).toEqual([
      "--out",
      "--kind",
      "--name",
    ]);
  });

  test("imports an agent and validates and builds the generated local pack", () => {
    const project = tempProject();
    const input = join(project, "review.md");
    const output = join(project, "imported-pack");
    writeFileSync(
      input,
      `---
identity: A careful reviewer.
mission: Review the requested change.
description: A reviewer for imported projects.
---

Review the diff and report findings.
`,
    );

    const imported = runCli(
      ["import", input, "--kind", "agent", "--out", output],
      project,
    );
    expect(imported.status).toBe(0);
    expect(imported.stdout).toContain("imported");
    expect(
      JSON.parse(readFileSync(join(output, "package.json"), "utf8")),
    ).toEqual(
      expect.objectContaining({
        name: "review",
        version: "0.0.0",
        atlante: { format: 1 },
      }),
    );
    expect(existsSync(join(output, "review", "instance.jsonc"))).toBe(true);

    writeFileSync(
      join(project, "atlante.jsonc"),
      `${JSON.stringify({ $schema: SCHEMA_URI, extends: "./imported-pack" })}\n`,
    );
    expect(runCli(["validate", project], project).status).toBe(0);
    expect(runCli(["build", project], project).status).toBe(0);
    expect(existsSync(join(project, ".opencode", "agents", "review.md"))).toBe(
      true,
    );
  });

  test("imports a skill with an explicit resource ID", () => {
    const project = tempProject();
    const input = join(project, "guide.md");
    const output = join(project, "imported-skill");
    writeFileSync(
      input,
      `---
title: Testing guide.
overview: A guide imported from Markdown.
description: A testing guide.
---

Run the tests.
`,
    );

    const imported = runCli(
      [
        "import",
        input,
        "--kind",
        "skill",
        "--name",
        "testing-guide",
        "--out",
        output,
      ],
      project,
    );
    expect(imported.status).toBe(0);
    expect(existsSync(join(output, "testing-guide", "instance.jsonc"))).toBe(
      true,
    );
    expect(
      JSON.parse(readFileSync(join(output, "package.json"), "utf8")),
    ).toEqual(expect.objectContaining({ name: "testing-guide" }));
  });

  test("fails closed for unsupported Markdown without creating a pack", () => {
    const project = tempProject();
    const input = join(project, "invalid.md");
    const output = join(project, "generated");
    writeFileSync(
      input,
      "---\ntitle: Skill\noverview: Overview\ndescription: Description\n---\n\n<div>raw</div>\n",
    );

    const result = runCli(
      ["import", input, "--kind", "skill", "--out", output],
      project,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unsupported-markdown");
    expect(existsSync(output)).toBe(false);
  });
});
