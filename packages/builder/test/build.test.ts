import { afterEach, describe, expect, test } from "bun:test";
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
import { SCHEMA_URI } from "@atlante/schema";
import { loadBundledTemplates } from "@atlante/templates";
import { readArtifacts } from "../src/artifacts.js";
import {
  buildProject,
  type PublishOperation,
  prepareProject,
} from "../src/index.js";

const created: string[] = [];

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function project(document: string): { root: string; config: string } {
  const root = mkdtempSync(join(tmpdir(), "atlante-build-"));
  created.push(root);
  const config = join(root, "atlante.jsonc");
  writeFileSync(config, document);
  return { root, config };
}

const oneAgent = (id: string, prompt: string) =>
  JSON.stringify({
    $schema: SCHEMA_URI,
    agents: {
      [id]: {
        description: `${id} description`,
        identity: prompt,
        mission: "Do the work.",
      },
    },
  });

function privateArtifactEntries(root: string): string[] {
  if (!existsSync(join(root, ".atlante"))) return [];
  return readdirSync(join(root, ".atlante")).filter((entry) =>
    entry.startsWith(".artifacts."),
  );
}

describe("buildProject", () => {
  test("rejects a symlinked project target before publishing", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const target = join(root, "linked-project");
    symlinkSync(root, target);

    expect(() => buildProject(target)).toThrow("project root");
    expect(existsSync(join(root, ".atlante"))).toBe(false);
  });

  test("publishes exact prepared payloads and a verified manifest", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    const prepared = prepareProject(root);

    const result = buildProject(root);

    expect(result.diagnostics).toEqual([]);
    expect(result.artifactsPath).toBe(join(root, ".atlante", "artifacts"));
    expect(readArtifacts(root)?.agents[0]).toMatchObject({
      hostAgentId: "reviewer",
      description: "reviewer description",
      prompt: prepared.agents[0]?.prompt,
    });
    expect(
      readFileSync(join(result.artifactsPath, "manifest.json"), "utf8"),
    ).toContain('"version": 1');
  });

  test("loads the project once and publishes under the loaded root", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));
    let loadCount = 0;

    const result = buildProject(root, {
      loadTemplates: () => {
        loadCount += 1;
        return loadBundledTemplates();
      },
    });

    expect(loadCount).toBe(1);
    expect(result.projectRoot).toBe(root);
    expect(result.artifactsPath).toBe(join(root, ".atlante", "artifacts"));
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("reviewer");
  });

  test("produces deterministic bytes on repeated builds", () => {
    const { root } = project(oneAgent("reviewer", "Review the change."));

    buildProject(root);
    const first = [
      readFileSync(join(root, ".atlante", "artifacts", "manifest.json")),
      ...readdirSync(join(root, ".atlante", "artifacts", "agents")).map(
        (file) =>
          readFileSync(join(root, ".atlante", "artifacts", "agents", file)),
      ),
    ];
    buildProject(root);
    const second = [
      readFileSync(join(root, ".atlante", "artifacts", "manifest.json")),
      ...readdirSync(join(root, ".atlante", "artifacts", "agents")).map(
        (file) =>
          readFileSync(join(root, ".atlante", "artifacts", "agents", file)),
      ),
    ];

    expect(second).toEqual(first);
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test("publishes an empty valid manifest", () => {
    const { root } = project(JSON.stringify({ $schema: SCHEMA_URI }));

    const result = buildProject(root);

    expect(result.diagnostics).toEqual([]);
    expect(readArtifacts(root)).toEqual({ agents: [], skills: [] });
  });

  test("removes stale payloads on a successful rebuild", () => {
    const { root } = project(oneAgent("old", "Old prompt."));
    buildProject(root);
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("old");

    writeFileSync(join(root, "atlante.jsonc"), oneAgent("new", "New prompt."));
    buildProject(root);

    expect(
      readArtifacts(root)?.agents.map((agent) => agent.hostAgentId),
    ).toEqual(["new"]);
    expect(
      readdirSync(join(root, ".atlante", "artifacts", "agents")),
    ).toHaveLength(1);
  });

  test("keeps the previous tree when preparation fails", () => {
    const { root } = project(oneAgent("reviewer", "Good prompt."));
    buildProject(root);
    const before = readFileSync(
      join(root, ".atlante", "artifacts", "manifest.json"),
      "utf8",
    );

    writeFileSync(
      join(root, "atlante.jsonc"),
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          broken: {
            description: "Missing value {{values.nope}}",
            identity: "Review.",
            mission: "Do the work.",
          },
        },
      }),
    );
    const result = buildProject(root);

    expect(result.diagnostics[0]?.code).toBe("missing-value");
    expect(
      readFileSync(
        join(root, ".atlante", "artifacts", "manifest.json"),
        "utf8",
      ),
    ).toBe(before);
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test.each([
    "create-directory",
    "write-manifest",
    "sync-file",
    "sync-directory",
    "write-payload",
    "rename-stage",
    "rename-backup",
  ] as PublishOperation[])(
    "restores the previous tree after %s failure",
    (operation) => {
      const { root } = project(oneAgent("reviewer", "Original prompt."));
      buildProject(root);
      const before = readArtifacts(root);
      let injected = false;

      writeFileSync(
        join(root, "atlante.jsonc"),
        oneAgent("replacement", "New prompt."),
      );
      expect(() =>
        buildProject(
          root,
          {},
          {
            fault: (current) => {
              if (!injected && current === operation) {
                injected = true;
                throw new Error(`injected ${operation} failure`);
              }
            },
          },
        ),
      ).toThrow(`injected ${operation} failure`);

      expect(readArtifacts(root)).toEqual(before);
      expect(privateArtifactEntries(root)).toEqual([]);
    },
  );

  test("reports stage cleanup failures without invalidating the previous tree", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    let thrown: unknown;

    try {
      buildProject(
        root,
        {},
        {
          fault: (operation) => {
            if (operation === "write-manifest") {
              throw new Error("injected publication failure");
            }
            if (operation === "cleanup-stage") {
              throw new Error("injected cleanup-stage failure");
            }
          },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "ArtifactPublicationError",
      recoverability: "no-previous-tree",
      cleanupErrors: [
        expect.objectContaining({ message: "injected cleanup-stage failure" }),
      ],
    });
    expect((thrown as Error).message).toContain(
      "cleanup failed: injected cleanup-stage failure",
    );
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("reviewer");
    expect(privateArtifactEntries(root)).toHaveLength(1);
  });

  test("keeps the backup when restoring after a persistent stage rename failure fails", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    writeFileSync(
      join(root, "atlante.jsonc"),
      oneAgent("replacement", "New prompt."),
    );

    let stageAttempts = 0;
    let restoreAttempts = 0;
    let thrown: unknown;
    try {
      buildProject(
        root,
        {},
        {
          fault: (operation) => {
            if (operation === "rename-stage") {
              stageAttempts += 1;
              throw new Error(
                `persistent stage rename failure ${stageAttempts}`,
              );
            }
            if (operation === "restore-backup") {
              restoreAttempts += 1;
              throw new Error(`restore failure ${restoreAttempts}`);
            }
          },
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      name: "ArtifactPublicationError",
      recoverability: "backup-preserved",
    });
    const backupPath = (thrown as { backupPath?: string }).backupPath;
    if (!backupPath)
      throw new Error("publication error did not preserve backup path");
    expect(backupPath && existsSync(backupPath)).toBe(true);
    expect(
      backupPath && readFileSync(join(backupPath, "manifest.json"), "utf8"),
    ).toContain('"reviewer"');
    expect(existsSync(join(root, ".atlante", "artifacts"))).toBe(false);
    expect(privateArtifactEntries(root)).toContain(
      backupPath.substring(backupPath.lastIndexOf("/") + 1),
    );
  });

  test("publishes with a warning when post-swap directory sync fails", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    writeFileSync(
      join(root, "atlante.jsonc"),
      oneAgent("replacement", "New prompt."),
    );
    let injected = false;

    const result = buildProject(
      root,
      {},
      {
        fault: (operation, path) => {
          if (
            !injected &&
            operation === "sync-directory" &&
            path === join(root, ".atlante")
          ) {
            injected = true;
            throw new Error("injected post-swap sync failure");
          }
        },
      },
    );

    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "post-publication-sync-failed",
        path: join(root, ".atlante"),
      }),
    ]);
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("replacement");
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test("publishes with a warning and preserves the backup after persistent cleanup failure", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    writeFileSync(
      join(root, "atlante.jsonc"),
      oneAgent("replacement", "New prompt."),
    );
    let injected = false;

    const result = buildProject(
      root,
      {},
      {
        fault: (operation) => {
          if (operation === "cleanup-backup") {
            injected = true;
            throw new Error("injected backup cleanup failure");
          }
        },
      },
    );

    expect(injected).toBe(true);
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: "backup-cleanup-failed" }),
    ]);
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("replacement");
    expect(privateArtifactEntries(root)).toHaveLength(1);
  });

  test("does not create a usable tree when publication fails without a previous tree", () => {
    const { root } = project(oneAgent("reviewer", "New prompt."));

    expect(() =>
      buildProject(
        root,
        {},
        {
          fault: (operation) => {
            if (operation === "rename-stage") {
              throw new Error("injected stage rename failure");
            }
          },
        },
      ),
    ).toThrow("injected stage rename failure");

    expect(existsSync(join(root, ".atlante", "artifacts"))).toBe(false);
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test("permits the no-tree visibility window during a live swap", () => {
    const { root } = project(oneAgent("reviewer", "Original prompt."));
    buildProject(root);
    writeFileSync(
      join(root, "atlante.jsonc"),
      oneAgent("replacement", "New prompt."),
    );
    let observed: ReturnType<typeof readArtifacts>;

    expect(() =>
      buildProject(
        root,
        {},
        {
          fault: (operation) => {
            if (operation === "rename-stage") {
              observed = readArtifacts(root);
              throw new Error("stop during permitted no-tree window");
            }
          },
        },
      ),
    ).toThrow("stop during permitted no-tree window");

    expect(observed).toBeUndefined();
    expect(readArtifacts(root)?.agents[0]?.hostAgentId).toBe("reviewer");
  });

  test("rejects a symlinked .atlante directory before staging", () => {
    const { root } = project(oneAgent("reviewer", "Prompt."));
    const metadataTarget = join(root, "metadata-target");
    mkdirSync(metadataTarget);
    symlinkSync(metadataTarget, join(root, ".atlante"));

    expect(() => buildProject(root)).toThrow(".atlante");
    expect(readdirSync(metadataTarget)).toEqual([]);
    expect(privateArtifactEntries(root)).toEqual([]);
  });

  test("rejects a non-directory .atlante path before staging", () => {
    const { root } = project(oneAgent("reviewer", "Prompt."));
    writeFileSync(join(root, ".atlante"), "not a directory");

    expect(() => buildProject(root)).toThrow(".atlante");
    expect(readFileSync(join(root, ".atlante"), "utf8")).toBe(
      "not a directory",
    );
  });
});
