import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProject, validateProject } from "@atlante/builder";
import { openCodeMaterializer } from "@atlante/opencode";
import { SCHEMA_URI } from "@atlante/schema";
import { hasErrors } from "@atlante/validator";
import {
  lowerToAtlanteAst,
  parseMarkdownSource,
  runImportWithDependencies,
} from "../src/commands/import-internal.js";
import {
  firstPartyPackVersion,
  firstPartyProjectContext,
} from "../src/first-party-pack.js";

const created: string[] = [];

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "atlante-import-"));
  created.push(directory);
  return directory;
}

function runQuiet<T>(run: () => T): T {
  const previousError = console.error;
  const previousLog = console.log;
  console.error = () => undefined;
  console.log = () => undefined;
  try {
    return run();
  } finally {
    console.error = previousError;
    console.log = previousLog;
  }
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function generatedBody(source: string): string {
  const separator = source.indexOf("\n---\n");
  if (separator < 0)
    throw new Error("generated native output has no frontmatter");
  return source.slice(separator + "\n---\n".length);
}

function nodesOfType(value: unknown, type: string): Record<string, unknown>[] {
  if (Array.isArray(value))
    return value.flatMap((item) => nodesOfType(item, type));
  if (typeof value !== "object" || value === null) return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.type === type ? [record] : []),
    ...Object.values(record).flatMap((item) => nodesOfType(item, type)),
  ];
}

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("local Markdown pack import", () => {
  test("writes a deterministic skill pack with the shipped pack version", () => {
    const root = tempDir();
    const input = join(root, "source.md");
    const firstOutput = join(root, "packs", "first");
    const secondOutput = join(root, "packs", "second");
    writeFileSync(
      input,
      `---
name: Example Skill
title: Example skill
overview: A skill imported from Markdown.
description: Lookup metadata for the imported skill.
---

# Introduction

Run **this** command:

\`\`\`sh
bun install
\`\`\`
`,
    );

    expect(
      runQuiet(() =>
        runImportWithDependencies(input, firstOutput, { kind: "skill" }),
      ),
    ).toBe(0);
    expect(
      runQuiet(() =>
        runImportWithDependencies(input, secondOutput, { kind: "skill" }),
      ),
    ).toBe(0);

    const firstFiles = [
      "package.json",
      "atlante.jsonc",
      "example-skill/instance.jsonc",
    ];
    for (const file of firstFiles)
      expect(existsSync(join(firstOutput, file))).toBe(true);

    expect(json(join(firstOutput, "package.json"))).toEqual({
      name: "example-skill",
      version: "0.0.0",
      atlante: { format: 1 },
      dependencies: { "@atlante/pack": firstPartyPackVersion() },
    });
    expect(json(join(firstOutput, "atlante.jsonc"))).toEqual({
      $schema: SCHEMA_URI,
      skills: {
        "example-skill": {
          $instance: "./example-skill",
          description: "Lookup metadata for the imported skill.",
        },
      },
    });
    expect(json(join(firstOutput, firstFiles[2]))).toEqual({
      $template: "@atlante/pack/skill",
      overview: "A skill imported from Markdown.",
      sections: [
        {
          markdown: [
            {
              type: "heading",
              depth: 1,
              children: [{ type: "text", value: "Introduction" }],
            },
            {
              type: "paragraph",
              children: [
                { type: "text", value: "Run " },
                {
                  type: "strong",
                  children: [{ type: "text", value: "this" }],
                },
                { type: "text", value: " command:" },
              ],
            },
            { type: "code", lang: "sh", value: "bun install" },
          ],
        },
      ],
    });

    for (const file of firstFiles)
      expect(readFileSync(join(firstOutput, file), "utf8")).toBe(
        readFileSync(join(secondOutput, file), "utf8"),
      );
  });

  test("generates an agent pack that validates and builds normally", () => {
    const root = tempDir();
    const input = join(root, "agent.md");
    const output = join(root, "agent-pack");
    writeFileSync(
      input,
      `---
name: Review Agent
identity: A careful reviewer.
mission: Review the requested change.
description: A reviewer for imported projects.
---

Review the diff and report findings.
`,
    );

    expect(
      runQuiet(() =>
        runImportWithDependencies(input, output, { kind: "agent" }),
      ),
    ).toBe(0);

    writeFileSync(
      join(root, "package.json"),
      '{ "name": "import-consumer", "version": "0.0.0" }\n',
    );
    writeFileSync(
      join(root, "atlante.jsonc"),
      `${JSON.stringify({ $schema: SCHEMA_URI, extends: "./agent-pack" })}\n`,
    );

    const context = firstPartyProjectContext();
    const validated = validateProject(join(root, "atlante.jsonc"), context);
    expect(hasErrors(validated.diagnostics)).toBe(false);
    expect(validated.diagnostics).toEqual([]);

    const built = buildProject(join(root, "atlante.jsonc"), context, {
      materializers: [openCodeMaterializer],
    });
    expect(hasErrors(built.diagnostics)).toBe(false);
    expect(built.diagnostics).toEqual([]);
    expect(
      existsSync(join(root, ".opencode", "agents", "review-agent.md")),
    ).toBe(true);
  });

  test("preserves imported Markdown through OpenCode materialization", () => {
    const root = tempDir();
    const input = join(root, "create-issue.md");
    const pack = join(root, "imported-pack");
    const sourceText = [
      "---",
      "name: create-issue",
      "description: Create GitHub issues.",
      "---",
      "",
      "# Create a Nesso GitHub issue",
      "",
      "Draft a **fully drafted** issue with js + e2e, a=b~c, and `inline` code.",
      "",
      "## 1. Prepare the draft",
      "",
      "- preserve the first item",
      "- preserve the second item",
      "",
      "| Name       | Value |",
      "|:-----------|------:|",
      "| command    | `js + e2e` |",
      "",
      "````bash",
      "printf 'hello'",
      "```\ninner",
      "````",
    ].join("\n");
    writeFileSync(input, sourceText);

    expect(
      runQuiet(() => runImportWithDependencies(input, pack, { kind: "skill" })),
    ).toBe(0);

    const instance = json(join(pack, "create-issue", "instance.jsonc"));
    expect(instance).toEqual(
      expect.objectContaining({
        $template: "@atlante/pack/skill",
        sections: expect.any(Array),
      }),
    );
    expect(instance).not.toHaveProperty("title");

    writeFileSync(
      join(root, "package.json"),
      '{ "name": "import-consumer", "version": "0.0.0" }\n',
    );
    writeFileSync(
      join(root, "atlante.jsonc"),
      `${JSON.stringify({ $schema: SCHEMA_URI, extends: "./imported-pack" })}\n`,
    );

    const context = firstPartyProjectContext();
    const validated = validateProject(join(root, "atlante.jsonc"), context);
    expect(hasErrors(validated.diagnostics)).toBe(false);
    expect(validated.diagnostics).toEqual([]);

    const first = buildProject(join(root, "atlante.jsonc"), context, {
      materializers: [openCodeMaterializer],
    });
    expect(hasErrors(first.diagnostics)).toBe(false);
    expect(first.diagnostics).toEqual([]);
    expect(first.materializations[0]?.writtenPaths.length).toBeGreaterThan(0);

    const native = readFileSync(
      join(root, ".opencode", "skills", "atlante", "create-issue", "SKILL.md"),
      "utf8",
    );
    const generated = parseMarkdownSource(native, "generated.md");
    expect(generated.frontmatter).toEqual({
      name: "create-issue",
      description: "Create GitHub issues.",
    });
    expect(generated.diagnostics).toEqual([]);
    const body = generatedBody(native);
    const sourceAst = lowerToAtlanteAst(
      parseMarkdownSource(sourceText, input).tree,
      input,
    );
    const generatedAst = lowerToAtlanteAst(
      parseMarkdownSource(body, "generated.md").tree,
      "generated.md",
    );
    expect(sourceAst.diagnostics).toEqual([]);
    expect(generatedAst.diagnostics).toEqual([]);
    expect(generatedAst.ast).toEqual(sourceAst.ast);
    expect(body.match(/^# [^\n]*$/gm) ?? []).toHaveLength(1);
    expect(body).toContain("**fully drafted** issue with js + e2e, a=b~c");
    expect(body).toContain("## 1. Prepare the draft");
    expect(body).toContain("````bash");
    expect(body).not.toContain("&#32;");
    expect(body).not.toContain("\\~");
    expect(body).not.toContain("1\\.");
    expect(
      nodesOfType(sourceAst.ast, "code").map(({ value, lang }) => ({
        value,
        lang,
      })),
    ).toEqual(
      nodesOfType(generatedAst.ast, "code").map(({ value, lang }) => ({
        value,
        lang,
      })),
    );

    const second = buildProject(join(root, "atlante.jsonc"), context, {
      materializers: [openCodeMaterializer],
    });
    expect(hasErrors(second.diagnostics)).toBe(false);
    expect(second.diagnostics).toEqual([]);
    expect(
      second.materializations.flatMap(({ writtenPaths }) => writtenPaths),
    ).toEqual([]);
  });

  test.each([
    [
      "unsupported HTML",
      "---\ntitle: Skill\noverview: Overview\ndescription: Description\n---\n\n<div>raw</div>\n",
    ],
    ["missing metadata", "A body without the required frontmatter.\n"],
    [
      "unresolved reference",
      "---\ntitle: Skill\noverview: Overview\ndescription: Description\n---\n\n[missing][target]\n",
    ],
  ] as const)("does not create output for %s", (_label, sourceText) => {
    const root = tempDir();
    const input = join(root, "invalid.md");
    const output = join(root, "generated");
    writeFileSync(input, sourceText);

    expect(
      runQuiet(() =>
        runImportWithDependencies(input, output, { kind: "skill" }),
      ),
    ).toBe(1);
    expect(existsSync(output)).toBe(false);
  });

  test("does not clobber an existing output directory", () => {
    const root = tempDir();
    const input = join(root, "valid.md");
    const output = join(root, "generated");
    writeFileSync(
      input,
      "---\ntitle: Skill\noverview: Overview\ndescription: Description\n---\n\nBody\n",
    );

    expect(
      runQuiet(() =>
        runImportWithDependencies(input, output, { kind: "skill" }),
      ),
    ).toBe(0);
    writeFileSync(join(output, "sentinel"), "keep\n");

    expect(
      runQuiet(() =>
        runImportWithDependencies(input, output, { kind: "skill" }),
      ),
    ).toBe(1);
    expect(readFileSync(join(output, "sentinel"), "utf8")).toBe("keep\n");
  });

  test("adds a second skill to an existing pack that validates and builds", () => {
    const root = tempDir();
    const pack = join(root, "site-pack");
    const docInput = join(root, "doc.md");
    const otherInput = join(root, "other.md");
    writeFileSync(
      docInput,
      "---\nname: Doc Skill\ntitle: Doc skill\ndescription: Document the feature.\n---\n\nBody text.\n",
    );
    writeFileSync(
      otherInput,
      "---\nname: Other Skill\ntitle: Other skill\ndescription: Another imported skill.\n---\n\nOther body.\n",
    );

    expect(
      runQuiet(() =>
        runImportWithDependencies(docInput, pack, { kind: "skill" }),
      ),
    ).toBe(0);
    expect(
      runQuiet(() =>
        runImportWithDependencies(otherInput, pack, { kind: "skill" }),
      ),
    ).toBe(0);

    expect(json(join(pack, "atlante.jsonc"))).toEqual({
      $schema: SCHEMA_URI,
      skills: {
        "doc-skill": {
          $instance: "./doc-skill",
          description: "Document the feature.",
        },
        "other-skill": {
          $instance: "./other-skill",
          description: "Another imported skill.",
        },
      },
    });
    // The pack manifest written by the first import is untouched.
    expect(json(join(pack, "package.json"))).toEqual({
      name: "doc-skill",
      version: "0.0.0",
      atlante: { format: 1 },
      dependencies: { "@atlante/pack": firstPartyPackVersion() },
    });
    expect(json(join(pack, "doc-skill", "instance.jsonc"))).toEqual(
      expect.objectContaining({ title: "Doc skill" }),
    );

    writeFileSync(
      join(root, "package.json"),
      '{ "name": "import-consumer", "version": "0.0.0" }\n',
    );
    writeFileSync(
      join(root, "atlante.jsonc"),
      `${JSON.stringify({ $schema: SCHEMA_URI, extends: "./site-pack" })}\n`,
    );

    const context = firstPartyProjectContext();
    const validated = validateProject(join(root, "atlante.jsonc"), context);
    expect(hasErrors(validated.diagnostics)).toBe(false);
    expect(validated.diagnostics).toEqual([]);

    const built = buildProject(join(root, "atlante.jsonc"), context, {
      materializers: [openCodeMaterializer],
    });
    expect(hasErrors(built.diagnostics)).toBe(false);
    expect(built.diagnostics).toEqual([]);
    expect(
      existsSync(
        join(root, ".opencode", "skills", "atlante", "doc-skill", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(root, ".opencode", "skills", "atlante", "other-skill", "SKILL.md"),
      ),
    ).toBe(true);
  });

  test("refuses a duplicate import without changing the target pack", () => {
    const root = tempDir();
    const pack = join(root, "site-pack");
    const input = join(root, "doc.md");
    writeFileSync(
      input,
      "---\nname: Doc Skill\ntitle: Doc skill\ndescription: Document the feature.\n---\n\nBody text.\n",
    );

    expect(
      runQuiet(() => runImportWithDependencies(input, pack, { kind: "skill" })),
    ).toBe(0);
    const presetBefore = readFileSync(join(pack, "atlante.jsonc"), "utf8");
    const instanceBefore = readFileSync(
      join(pack, "doc-skill", "instance.jsonc"),
      "utf8",
    );
    writeFileSync(join(pack, "sentinel"), "keep\n");

    expect(
      runQuiet(() => runImportWithDependencies(input, pack, { kind: "skill" })),
    ).toBe(1);

    expect(readFileSync(join(pack, "atlante.jsonc"), "utf8")).toBe(
      presetBefore,
    );
    expect(
      readFileSync(join(pack, "doc-skill", "instance.jsonc"), "utf8"),
    ).toBe(instanceBefore);
    expect(readFileSync(join(pack, "sentinel"), "utf8")).toBe("keep\n");
  });
});
