import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClaudeCodeMaterializationError,
  type ClaudeCodeOwnershipManifest,
  type ClaudeCodePreparedProject,
  materializeClaudeCode,
  planClaudeCodeMaterialization,
  readClaudeCodeNative,
} from "../src/native.js";

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function project(): string {
  const directory = mkdtempSync(join(tmpdir(), "atlante-native-"));
  created.push(directory);
  return directory;
}

function prepared(
  agentId = "reviewer",
  prompt = "Review the change.\n",
): ClaudeCodePreparedProject {
  return {
    agents: [
      {
        hostAgentId: agentId,
        description: "Reviews changes.",
        prompt,
      },
    ],
    skills: [],
  };
}

function preparedWithSkill(
  prompt = "Review the change.\n",
  content = "Run the tests.\n",
): ClaudeCodePreparedProject {
  return {
    ...prepared("reviewer", prompt),
    skills: [
      {
        skillId: "testing",
        description: "Testing guidance.",
        content,
      },
    ],
  };
}

function preparedWithOutputDirectories(
  agents = "generated/agents",
  skills = "custom/skills",
): ClaudeCodePreparedProject {
  return {
    ...preparedWithSkill(),
    options: {
      agents: { outDir: agents },
      skills: { outDir: skills },
    },
  } as ClaudeCodePreparedProject;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifestAt(root: string): ClaudeCodeOwnershipManifest {
  return JSON.parse(
    readFileSync(join(root, ".atlante", "claude-code-native.json"), "utf8"),
  ) as ClaudeCodeOwnershipManifest;
}

function nativeBytes(root: string): Array<{ path: string; bytes: Buffer }> {
  const paths = [
    ".atlante/claude-code-native.json",
    ".claude/agents/reviewer.md",
    ".claude/skills/testing/SKILL.md",
  ];
  return paths
    .filter((path) => existsSync(join(root, ...path.split("/"))))
    .map((path) => ({
      path,
      bytes: readFileSync(join(root, ...path.split("/"))),
    }));
}

function expectMaterializationError(
  action: () => unknown,
  code: ClaudeCodeMaterializationError["code"],
  path: string,
): void {
  try {
    action();
    throw new Error("expected Claude Code materialization to fail");
  } catch (cause) {
    expect(cause).toBeInstanceOf(ClaudeCodeMaterializationError);
    if (cause instanceof ClaudeCodeMaterializationError) {
      expect(cause.code).toBe(code);
      expect(cause.path).toBe(path);
    }
  }
}

describe("materializeClaudeCode", () => {
  test("writes deterministic native files and a payload-free manifest", () => {
    const root = project();
    const result = materializeClaudeCode(root, preparedWithSkill());
    const agent =
      '---\nname: "reviewer"\ndescription: "Reviews changes."\n---\nReview the change.\n';
    const skill =
      '---\nname: "testing"\ndescription: "Testing guidance."\n---\nRun the tests.\n';

    expect(result.writtenPaths).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/testing/SKILL.md",
    ]);
    expect(result.removedPaths).toEqual([]);
    expect(
      readFileSync(join(root, ".claude", "agents", "reviewer.md"), "utf8"),
    ).toBe(agent);
    expect(
      readFileSync(
        join(root, ".claude", "skills", "testing", "SKILL.md"),
        "utf8",
      ),
    ).toBe(skill);
    expect(manifestAt(root)).toEqual({
      format: "atlante-claude-code-native",
      version: 1,
      files: [
        {
          kind: "agent",
          id: "reviewer",
          path: ".claude/agents/reviewer.md",
          sha256: digest(agent),
        },
        {
          kind: "skill",
          id: "testing",
          path: ".claude/skills/testing/SKILL.md",
          sha256: digest(skill),
        },
      ],
    });
    expect(JSON.stringify(manifestAt(root))).not.toContain(
      "Review the change.",
    );
    expect(JSON.stringify(manifestAt(root))).not.toContain("Run the tests.");
  });

  test("does not rewrite unchanged output on a repeated materialization", () => {
    const root = project();
    const first = materializeClaudeCode(root, preparedWithSkill());
    const before = nativeBytes(root);

    const second = materializeClaudeCode(root, preparedWithSkill());

    expect(first.writtenPaths).toHaveLength(2);
    expect(second.writtenPaths).toEqual([]);
    expect(second.removedPaths).toEqual([]);
    expect(nativeBytes(root)).toEqual(before);
  });

  test("reads and verifies the materialized native files", () => {
    const root = project();
    materializeClaudeCode(root, preparedWithSkill());

    const native = readClaudeCodeNative(root);

    expect(native.manifest.format).toBe("atlante-claude-code-native");
    expect(native.files.map(({ path }) => path)).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/testing/SKILL.md",
    ]);
    expect(new TextDecoder().decode(native.files[0]?.bytes)).toContain(
      "Review the change.",
    );
  });

  test("rejects a drifted native file", () => {
    const root = project();
    materializeClaudeCode(root, prepared());
    const target = join(root, ".claude", "agents", "reviewer.md");
    writeFileSync(target, "drifted\n");

    expectMaterializationError(
      () => readClaudeCodeNative(root),
      "drift",
      target,
    );
  });

  test("rejects a missing manifest or native file", () => {
    const empty = project();
    expectMaterializationError(
      () => readClaudeCodeNative(empty),
      "invalid-manifest",
      join(empty, ".atlante", "claude-code-native.json"),
    );

    const root = project();
    materializeClaudeCode(root, prepared());
    rmSync(join(root, ".claude", "agents", "reviewer.md"));
    expectMaterializationError(
      () => readClaudeCodeNative(root),
      "invalid-manifest",
      join(root, ".claude", "agents", "reviewer.md"),
    );
  });

  test("rejects a symlinked native parent before reading its target", () => {
    const root = project();
    materializeClaudeCode(root, prepared());
    const agents = join(root, ".claude", "agents");
    const outside = project();
    rmSync(agents, { recursive: true, force: true });
    symlinkSync(outside, agents, "dir");

    expectMaterializationError(
      () => readClaudeCodeNative(root),
      "unsafe-path",
      agents,
    );
  });

  test("updates owned files, removes stale files, and preserves unrelated files", () => {
    const root = project();
    materializeClaudeCode(root, preparedWithSkill());
    const userFile = join(root, ".claude", "agents", "user.md");
    writeFileSync(userFile, "user-authored agent\n");

    const result = materializeClaudeCode(
      root,
      prepared("reviewer", "Updated review.\n"),
    );

    expect(result.writtenPaths).toEqual([".claude/agents/reviewer.md"]);
    expect(result.removedPaths).toEqual([".claude/skills/testing/SKILL.md"]);
    expect(readFileSync(userFile, "utf8")).toBe("user-authored agent\n");
    expect(
      readFileSync(join(root, ".claude", "agents", "reviewer.md"), "utf8"),
    ).toContain("Updated review.");
    expect(
      existsSync(join(root, ".claude", "skills", "testing", "SKILL.md")),
    ).toBe(false);
  });

  test("removes the emptied skill directory when its skill is removed", () => {
    const root = project();
    materializeClaudeCode(root, preparedWithSkill());

    const result = materializeClaudeCode(root, prepared());

    expect(result.removedPaths).toEqual([".claude/skills/testing/SKILL.md"]);
    expect(existsSync(join(root, ".claude", "skills", "testing"))).toBe(false);
    expect(existsSync(join(root, ".claude", "agents"))).toBe(true);
  });

  test("preserves a stale skill directory that holds unrelated files", () => {
    const root = project();
    materializeClaudeCode(root, preparedWithSkill());
    const notes = join(root, ".claude", "skills", "testing", "notes.md");
    writeFileSync(notes, "user notes\n");

    const result = materializeClaudeCode(root, prepared());

    expect(result.removedPaths).toEqual([".claude/skills/testing/SKILL.md"]);
    expect(readFileSync(notes, "utf8")).toBe("user notes\n");
    expect(existsSync(join(root, ".claude", "skills", "testing"))).toBe(true);
  });

  test("refuses an unowned native target before writing it", () => {
    const root = project();
    const agentDirectory = join(root, ".claude", "agents");
    const target = join(agentDirectory, "reviewer.md");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(target, "user-authored agent\n");

    expect(() => materializeClaudeCode(root, prepared())).toThrow(
      "unowned Claude Code target",
    );

    expect(readFileSync(target, "utf8")).toBe("user-authored agent\n");
    expect(existsSync(join(root, ".atlante", "claude-code-native.json"))).toBe(
      false,
    );
  });

  test("writes independently configured agent and skill directories", () => {
    const root = project();

    const result = materializeClaudeCode(root, preparedWithOutputDirectories());

    expect(result.writtenPaths).toEqual([
      "custom/skills/testing/SKILL.md",
      "generated/agents/reviewer.md",
    ]);
    expect(manifestAt(root).files.map(({ path }) => path)).toEqual([
      "custom/skills/testing/SKILL.md",
      "generated/agents/reviewer.md",
    ]);
    expect(
      readFileSync(
        join(root, "custom", "skills", "testing", "SKILL.md"),
        "utf8",
      ),
    ).toContain("Run the tests.");
    expect(
      readFileSync(join(root, "generated", "agents", "reviewer.md"), "utf8"),
    ).toContain("Review the change.");
  });

  test("rejects unsafe configured output directories before mutation", () => {
    for (const outDir of [
      "/tmp/agents",
      "../agents",
      "./agents",
      "agents\\nested",
      "agents//nested",
      "C:/agents",
      "C:agents",
    ]) {
      const root = project();

      try {
        materializeClaudeCode(
          root,
          preparedWithOutputDirectories(outDir, "custom/skills"),
        );
        throw new Error(`expected unsafe output directory to fail: ${outDir}`);
      } catch (cause) {
        expect(cause).toBeInstanceOf(ClaudeCodeMaterializationError);
        if (cause instanceof ClaudeCodeMaterializationError) {
          expect(cause.code).toBe("unsafe-path");
          expect(cause.path).toBe(outDir);
        }
      }
      expect(existsSync(join(root, ".atlante"))).toBe(false);
    }
  });

  test("rejects a manifest path that is not a safe kind-and-ID path", () => {
    const root = project();
    materializeClaudeCode(root, prepared());
    const manifest = manifestAt(root);
    const entry = manifest.files[0];
    if (!entry) throw new Error("manifest entry missing");
    const invalid = {
      ...manifest,
      files: [{ ...entry, path: "generated/reviewer.txt" }],
    };
    writeFileSync(
      join(root, ".atlante", "claude-code-native.json"),
      `${JSON.stringify(invalid)}\n`,
    );

    expectMaterializationError(
      () => readClaudeCodeNative(root),
      "unsafe-path",
      "generated/reviewer.txt",
    );
  });

  test("refuses a changed owned target and leaves the drift in place", () => {
    const root = project();
    materializeClaudeCode(root, prepared());
    const target = join(root, ".claude", "agents", "reviewer.md");
    writeFileSync(target, "manually changed\n");
    const beforeManifest = manifestAt(root);

    expect(() =>
      materializeClaudeCode(root, prepared("reviewer", "New\n")),
    ).toThrow("owned Claude Code target drifted");

    expect(readFileSync(target, "utf8")).toBe("manually changed\n");
    expect(manifestAt(root)).toEqual(beforeManifest);
  });

  test("refuses drifted stale files instead of deleting them", () => {
    const root = project();
    materializeClaudeCode(root, preparedWithSkill());
    const stale = join(root, ".claude", "skills", "testing", "SKILL.md");
    writeFileSync(stale, "manually changed skill\n");
    const before = nativeBytes(root);

    expect(() => materializeClaudeCode(root, prepared())).toThrow(
      "stale owned Claude Code target drifted",
    );

    expect(readFileSync(stale, "utf8")).toBe("manually changed skill\n");
    expect(nativeBytes(root)).toEqual(before);
  });

  test("rejects incompatible IDs rather than silently renaming them", () => {
    const root = project();

    expect(() => materializeClaudeCode(root, prepared("Bad_Name"))).toThrow(
      "IDs are never renamed",
    );

    expect(existsSync(join(root, ".atlante"))).toBe(false);
  });

  test("rejects symlinked native parent directories", () => {
    const root = project();
    const outside = project();
    symlinkSync(outside, join(root, ".claude"), "dir");

    expect(() => materializeClaudeCode(root, prepared())).toThrow(
      "parent must not be a symlink",
    );
    expect(existsSync(join(root, ".atlante"))).toBe(false);
  });

  test("restores the previous native set after a partial publication failure", () => {
    const root = project();
    materializeClaudeCode(root, preparedWithSkill());
    const before = nativeBytes(root);
    let publicationCount = 0;

    expect(() =>
      materializeClaudeCode(
        root,
        preparedWithSkill("Updated review.\n", "Updated tests.\n"),
        {
          fault: (operation) => {
            if (operation === "publish-file") {
              publicationCount += 1;
              if (publicationCount === 2)
                throw new Error("injected native failure");
            }
          },
        },
      ),
    ).toThrow("injected native failure");

    expect(publicationCount).toBe(2);
    expect(nativeBytes(root)).toEqual(before);
    expect(
      readdirSync(join(root, ".atlante")).filter((entry) =>
        entry.startsWith(".claude-code-native.stage-"),
      ),
    ).toEqual([]);
  });

  test("removes newly created directories after a first publication failure", () => {
    const root = project();
    let publicationCount = 0;

    expect(() =>
      materializeClaudeCode(root, preparedWithOutputDirectories(), {
        fault: (operation) => {
          if (operation === "publish-file") {
            publicationCount += 1;
            if (publicationCount === 2)
              throw new Error("injected first-publication failure");
          }
        },
      }),
    ).toThrow("injected first-publication failure");

    expect(publicationCount).toBe(2);
    expect(readdirSync(root)).toEqual([]);
  });

  test("exposes a typed publication error for filesystem failures", () => {
    const root = project();

    try {
      materializeClaudeCode(root, prepared(), {
        fault: (operation) => {
          if (operation === "create-stage") throw new Error("stage failure");
        },
      });
      throw new Error("materialization unexpectedly succeeded");
    } catch (cause) {
      expect(cause).toBeInstanceOf(ClaudeCodeMaterializationError);
      expect((cause as ClaudeCodeMaterializationError).code).toBe(
        "publication-failed",
      );
    }
  });
});

describe("planClaudeCodeMaterialization", () => {
  test("reports planned paths without writing anything", () => {
    const root = project();

    const planned = planClaudeCodeMaterialization(root, preparedWithSkill());

    expect(planned.writtenPaths).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/testing/SKILL.md",
    ]);
    expect(planned.removedPaths).toEqual([]);
    expect(existsSync(join(root, ".claude"))).toBe(false);
    expect(existsSync(join(root, ".atlante"))).toBe(false);

    const built = materializeClaudeCode(root, preparedWithSkill());

    expect(built.writtenPaths).toEqual(planned.writtenPaths);
    expect(built.removedPaths).toEqual(planned.removedPaths);
  });

  test("reports an empty plan for up-to-date outputs without rewriting", () => {
    const root = project();
    materializeClaudeCode(root, preparedWithSkill());
    const before = readFileSync(join(root, ".claude", "agents", "reviewer.md"));

    const planned = planClaudeCodeMaterialization(root, preparedWithSkill());

    expect(planned.writtenPaths).toEqual([]);
    expect(planned.removedPaths).toEqual([]);
    expect(
      readFileSync(join(root, ".claude", "agents", "reviewer.md")),
    ).toEqual(before);
  });
});
