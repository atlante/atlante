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
  materializeOpenCode,
  OpenCodeMaterializationError,
  type OpenCodeOwnershipManifest,
  type OpenCodePreparedProject,
  readOpenCodeNative,
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
): OpenCodePreparedProject {
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
): OpenCodePreparedProject {
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
  skills = ".claude/skills",
): OpenCodePreparedProject {
  return {
    ...preparedWithSkill(),
    options: {
      agents: { outDir: agents },
      skills: { outDir: skills },
    },
  } as OpenCodePreparedProject;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifestAt(root: string): OpenCodeOwnershipManifest {
  return JSON.parse(
    readFileSync(join(root, ".atlante", "opencode-native.json"), "utf8"),
  ) as OpenCodeOwnershipManifest;
}

function nativeBytes(root: string): Array<{ path: string; bytes: Buffer }> {
  const paths = [
    ".atlante/opencode-native.json",
    ".opencode/agents/reviewer.md",
    ".opencode/skills/atlante/testing/SKILL.md",
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
  code: OpenCodeMaterializationError["code"],
  path: string,
): void {
  try {
    action();
    throw new Error("expected OpenCode materialization to fail");
  } catch (cause) {
    expect(cause).toBeInstanceOf(OpenCodeMaterializationError);
    if (cause instanceof OpenCodeMaterializationError) {
      expect(cause.code).toBe(code);
      expect(cause.path).toBe(path);
    }
  }
}

describe("materializeOpenCode", () => {
  test("writes deterministic native files and a payload-free manifest", () => {
    const root = project();
    const result = materializeOpenCode(root, preparedWithSkill());
    const agent =
      '---\ndescription: "Reviews changes."\n---\nReview the change.\n';
    const skill =
      '---\nname: "testing"\ndescription: "Testing guidance."\n---\nRun the tests.\n';

    expect(result.writtenPaths).toEqual([
      ".opencode/agents/reviewer.md",
      ".opencode/skills/atlante/testing/SKILL.md",
    ]);
    expect(result.removedPaths).toEqual([]);
    expect(
      readFileSync(join(root, ".opencode", "agents", "reviewer.md"), "utf8"),
    ).toBe(agent);
    expect(
      readFileSync(
        join(root, ".opencode", "skills", "atlante", "testing", "SKILL.md"),
        "utf8",
      ),
    ).toBe(skill);
    expect(manifestAt(root)).toEqual({
      format: "atlante-opencode-native",
      version: 1,
      files: [
        {
          kind: "agent",
          id: "reviewer",
          path: ".opencode/agents/reviewer.md",
          sha256: digest(agent),
        },
        {
          kind: "skill",
          id: "testing",
          path: ".opencode/skills/atlante/testing/SKILL.md",
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
    const first = materializeOpenCode(root, preparedWithSkill());
    const before = nativeBytes(root);

    const second = materializeOpenCode(root, preparedWithSkill());

    expect(first.writtenPaths).toHaveLength(2);
    expect(second.writtenPaths).toEqual([]);
    expect(second.removedPaths).toEqual([]);
    expect(nativeBytes(root)).toEqual(before);
  });

  test("reads and verifies the materialized native files", () => {
    const root = project();
    materializeOpenCode(root, preparedWithSkill());

    const native = readOpenCodeNative(root);

    expect(native.manifest.format).toBe("atlante-opencode-native");
    expect(native.files.map(({ path }) => path)).toEqual([
      ".opencode/agents/reviewer.md",
      ".opencode/skills/atlante/testing/SKILL.md",
    ]);
    expect(new TextDecoder().decode(native.files[0]?.bytes)).toContain(
      "Review the change.",
    );
  });

  test("rejects a drifted native file", () => {
    const root = project();
    materializeOpenCode(root, prepared());
    const target = join(root, ".opencode", "agents", "reviewer.md");
    writeFileSync(target, "drifted\n");

    expectMaterializationError(() => readOpenCodeNative(root), "drift", target);
  });

  test("rejects a missing manifest or native file", () => {
    const empty = project();
    expectMaterializationError(
      () => readOpenCodeNative(empty),
      "invalid-manifest",
      join(empty, ".atlante", "opencode-native.json"),
    );

    const root = project();
    materializeOpenCode(root, prepared());
    rmSync(join(root, ".opencode", "agents", "reviewer.md"));
    expectMaterializationError(
      () => readOpenCodeNative(root),
      "invalid-manifest",
      join(root, ".opencode", "agents", "reviewer.md"),
    );
  });

  test("rejects a symlinked native parent before reading its target", () => {
    const root = project();
    materializeOpenCode(root, prepared());
    const agents = join(root, ".opencode", "agents");
    const outside = project();
    rmSync(agents, { recursive: true, force: true });
    symlinkSync(outside, agents, "dir");

    expectMaterializationError(
      () => readOpenCodeNative(root),
      "unsafe-path",
      agents,
    );
  });

  test("updates owned files, removes stale files, and preserves unrelated files", () => {
    const root = project();
    materializeOpenCode(root, preparedWithSkill());
    const userFile = join(root, ".opencode", "agents", "user.md");
    writeFileSync(userFile, "user-authored agent\n");

    const result = materializeOpenCode(
      root,
      prepared("reviewer", "Updated review.\n"),
    );

    expect(result.writtenPaths).toEqual([".opencode/agents/reviewer.md"]);
    expect(result.removedPaths).toEqual([
      ".opencode/skills/atlante/testing/SKILL.md",
    ]);
    expect(readFileSync(userFile, "utf8")).toBe("user-authored agent\n");
    expect(
      readFileSync(join(root, ".opencode", "agents", "reviewer.md"), "utf8"),
    ).toContain("Updated review.");
    expect(
      existsSync(
        join(root, ".opencode", "skills", "atlante", "testing", "SKILL.md"),
      ),
    ).toBe(false);
  });

  test("removes the emptied skill directory when its skill is removed", () => {
    const root = project();
    materializeOpenCode(root, preparedWithSkill());

    const result = materializeOpenCode(root, prepared());

    expect(result.removedPaths).toEqual([
      ".opencode/skills/atlante/testing/SKILL.md",
    ]);
    expect(
      existsSync(join(root, ".opencode", "skills", "atlante", "testing")),
    ).toBe(false);
    expect(existsSync(join(root, ".opencode", "agents"))).toBe(true);
  });

  test("preserves a stale skill directory that holds unrelated files", () => {
    const root = project();
    materializeOpenCode(root, preparedWithSkill());
    const notes = join(
      root,
      ".opencode",
      "skills",
      "atlante",
      "testing",
      "notes.md",
    );
    writeFileSync(notes, "user notes\n");

    const result = materializeOpenCode(root, prepared());

    expect(result.removedPaths).toEqual([
      ".opencode/skills/atlante/testing/SKILL.md",
    ]);
    expect(readFileSync(notes, "utf8")).toBe("user notes\n");
    expect(
      existsSync(join(root, ".opencode", "skills", "atlante", "testing")),
    ).toBe(true);
  });

  test("refuses an unowned native target before writing it", () => {
    const root = project();
    const agentDirectory = join(root, ".opencode", "agents");
    const target = join(agentDirectory, "reviewer.md");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(target, "user-authored agent\n");

    expect(() => materializeOpenCode(root, prepared())).toThrow(
      "unowned OpenCode target",
    );

    expect(readFileSync(target, "utf8")).toBe("user-authored agent\n");
    expect(existsSync(join(root, ".atlante", "opencode-native.json"))).toBe(
      false,
    );
  });

  test("writes independently configured agent and skill directories", () => {
    const root = project();

    const result = materializeOpenCode(root, preparedWithOutputDirectories());

    expect(result.writtenPaths).toEqual([
      ".claude/skills/testing/SKILL.md",
      "generated/agents/reviewer.md",
    ]);
    expect(manifestAt(root).files.map(({ path }) => path)).toEqual([
      ".claude/skills/testing/SKILL.md",
      "generated/agents/reviewer.md",
    ]);
    expect(
      readFileSync(
        join(root, ".claude", "skills", "testing", "SKILL.md"),
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
        materializeOpenCode(
          root,
          preparedWithOutputDirectories(outDir, ".claude/skills"),
        );
        throw new Error(`expected unsafe output directory to fail: ${outDir}`);
      } catch (cause) {
        expect(cause).toBeInstanceOf(OpenCodeMaterializationError);
        if (cause instanceof OpenCodeMaterializationError) {
          expect(cause.code).toBe("unsafe-path");
          expect(cause.path).toBe(outDir);
        }
      }
      expect(existsSync(join(root, ".atlante"))).toBe(false);
    }
  });

  test("accepts the previous skill path while moving stale output to the new default", () => {
    const root = project();
    materializeOpenCode(
      root,
      preparedWithOutputDirectories(".opencode/agents", ".opencode/skills"),
    );

    const result = materializeOpenCode(root, preparedWithSkill());

    expect(result.writtenPaths).toEqual([
      ".opencode/skills/atlante/testing/SKILL.md",
    ]);
    expect(result.removedPaths).toEqual([".opencode/skills/testing/SKILL.md"]);
    expect(
      existsSync(join(root, ".opencode", "skills", "testing", "SKILL.md")),
    ).toBe(false);
    expect(
      existsSync(
        join(root, ".opencode", "skills", "atlante", "testing", "SKILL.md"),
      ),
    ).toBe(true);
  });

  test("rejects a manifest path that is not a safe kind-and-ID path", () => {
    const root = project();
    materializeOpenCode(root, prepared());
    const manifest = manifestAt(root);
    const entry = manifest.files[0];
    if (!entry) throw new Error("manifest entry missing");
    const invalid = {
      ...manifest,
      files: [{ ...entry, path: "generated/reviewer.txt" }],
    };
    writeFileSync(
      join(root, ".atlante", "opencode-native.json"),
      `${JSON.stringify(invalid)}\n`,
    );

    expectMaterializationError(
      () => readOpenCodeNative(root),
      "unsafe-path",
      "generated/reviewer.txt",
    );
  });

  test("refuses a changed owned target and leaves the drift in place", () => {
    const root = project();
    materializeOpenCode(root, prepared());
    const target = join(root, ".opencode", "agents", "reviewer.md");
    writeFileSync(target, "manually changed\n");
    const beforeManifest = manifestAt(root);

    expect(() =>
      materializeOpenCode(root, prepared("reviewer", "New\n")),
    ).toThrow("owned OpenCode target drifted");

    expect(readFileSync(target, "utf8")).toBe("manually changed\n");
    expect(manifestAt(root)).toEqual(beforeManifest);
  });

  test("refuses drifted stale files instead of deleting them", () => {
    const root = project();
    materializeOpenCode(root, preparedWithSkill());
    const stale = join(
      root,
      ".opencode",
      "skills",
      "atlante",
      "testing",
      "SKILL.md",
    );
    writeFileSync(stale, "manually changed skill\n");
    const before = nativeBytes(root);

    expect(() => materializeOpenCode(root, prepared())).toThrow(
      "stale owned OpenCode target drifted",
    );

    expect(readFileSync(stale, "utf8")).toBe("manually changed skill\n");
    expect(nativeBytes(root)).toEqual(before);
  });

  test("rejects incompatible IDs rather than silently renaming them", () => {
    const root = project();

    expect(() => materializeOpenCode(root, prepared("Bad_Name"))).toThrow(
      "IDs are never renamed",
    );

    expect(existsSync(join(root, ".atlante"))).toBe(false);
  });

  test("rejects symlinked native parent directories", () => {
    const root = project();
    const outside = project();
    symlinkSync(outside, join(root, ".opencode"), "dir");

    expect(() => materializeOpenCode(root, prepared())).toThrow(
      "parent must not be a symlink",
    );
    expect(existsSync(join(root, ".atlante"))).toBe(false);
  });

  test("restores the previous native set after a partial publication failure", () => {
    const root = project();
    materializeOpenCode(root, preparedWithSkill());
    const before = nativeBytes(root);
    let publicationCount = 0;

    expect(() =>
      materializeOpenCode(
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
        entry.startsWith(".opencode-native.stage-"),
      ),
    ).toEqual([]);
  });

  test("removes newly created directories after a first publication failure", () => {
    const root = project();
    let publicationCount = 0;

    expect(() =>
      materializeOpenCode(root, preparedWithOutputDirectories(), {
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
      materializeOpenCode(root, prepared(), {
        fault: (operation) => {
          if (operation === "create-stage") throw new Error("stage failure");
        },
      });
      throw new Error("materialization unexpectedly succeeded");
    } catch (cause) {
      expect(cause).toBeInstanceOf(OpenCodeMaterializationError);
      expect((cause as OpenCodeMaterializationError).code).toBe(
        "publication-failed",
      );
    }
  });
});
