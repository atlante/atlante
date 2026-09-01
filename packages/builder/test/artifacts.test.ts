import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as publicArtifacts from "@atlante/builder/artifacts";
import { createArtifacts } from "../src/artifacts.js";
import type {
  ArtifactManifest,
  ArtifactPayload,
} from "../src/artifacts-internal.js";

// These compile-time assertions keep the adapter subpath free of build-only
// manifest, payload, and source metadata.
// @ts-expect-error Build-only manifest details are not public adapter types.
export type PAM = import("@atlante/builder/artifacts").ArtifactManifest;
// @ts-expect-error Build-only manifest details are not public adapter types.
export type PAME = import("@atlante/builder/artifacts").ArtifactManifestEntry;

const created: string[] = [];
const builderPackage = join(import.meta.dirname, "..");

type ArtifactInput = Parameters<typeof createArtifacts>[0];

const input: ArtifactInput = {
  agents: [
    {
      hostAgentId: "reviewer",
      description: "Reviews changes.",
      prompt: "# Review\n\nFind defects.\n",
    },
  ],
  skills: [
    {
      skillId: "workflow",
      description: "A useful workflow.",
      content: "# Workflow\n\n1. Check the change.\n",
    },
  ],
};

afterEach(() => {
  for (const directory of created.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function digest(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-artifacts-"));
  created.push(root);
  return root;
}

function artifactDirectory(root: string): string {
  return join(root, ".atlante", "artifacts");
}

function writeTree(
  root: string,
  manifest: ArtifactManifest,
  payloads: readonly ArtifactPayload[],
): void {
  const directory = artifactDirectory(root);
  mkdirSync(join(directory, "agents"), { recursive: true });
  mkdirSync(join(directory, "skills"), { recursive: true });
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  for (const payload of payloads) {
    writeFileSync(join(directory, ...payload.path.split("/")), payload.bytes);
  }
}

function validTree(root = project()): {
  root: string;
  manifest: ArtifactManifest;
  payloads: readonly ArtifactPayload[];
} {
  const artifacts = createArtifacts(input);
  writeTree(root, artifacts.manifest, artifacts.payloads);
  return { root, ...artifacts };
}

function expectReadError(
  action: () => unknown,
): publicArtifacts.ArtifactReadError {
  let thrown: unknown;
  try {
    action();
  } catch (cause) {
    thrown = cause;
  }
  expect(thrown).toBeInstanceOf(publicArtifacts.ArtifactReadError);
  return thrown as publicArtifacts.ArtifactReadError;
}

describe("createArtifacts", () => {
  test("creates strict v1 metadata and byte-exact UTF-8 payload digests", () => {
    const artifacts = createArtifacts({
      agents: [
        {
          hostAgentId: "réviewer/../ \ud83d\udca1",
          description: "Resolved description",
          prompt: "Café\n💡\n",
        },
      ],
      skills: [],
    });
    const payload = artifacts.payloads[0];

    expect(artifacts.manifest).toEqual({
      format: "atlante-artifacts",
      version: 1,
      agents: [
        {
          id: "réviewer/../ \ud83d\udca1",
          description: "Resolved description",
          path: `agents/r-viewer-${digest("réviewer/../ \ud83d\udca1")}-${digest("Café\n💡\n")}.md`,
          sha256: digest("Café\n💡\n"),
        },
      ],
      skills: [],
    });
    expect(payload?.path).toBe(artifacts.manifest.agents[0]?.path);
    expect(payload?.bytes).toEqual(new TextEncoder().encode("Café\n💡\n"));
    expect(payload && digest(payload.bytes)).toBe(
      artifacts.manifest.agents[0]?.sha256,
    );
  });

  test("uses deterministic safe names for arbitrary IDs", () => {
    const ids = [
      " whitespace id ",
      "日本語/\u0000/../../name",
      "__proto__",
      "日本語",
      "💡",
      "ÄBC id",
      "a".repeat(4096),
    ];
    const first = createArtifacts({
      agents: ids.map((hostAgentId) => ({
        hostAgentId,
        description: "description",
        prompt: hostAgentId,
      })),
      skills: [],
    });
    const second = createArtifacts({
      agents: ids.map((hostAgentId) => ({
        hostAgentId,
        description: "description",
        prompt: hostAgentId,
      })),
      skills: [],
    });

    expect(first).toEqual(second);
    for (const entry of first.manifest.agents) {
      expect(entry.path).toMatch(
        /^agents\/(?:[a-z0-9]+(?:-[a-z0-9]+)*|artifact)-[0-9a-f]{64}-[0-9a-f]{64}\.md$/,
      );
      expect(entry.path.split("/")[1]?.length).toBeLessThanOrEqual(181);
      expect(entry.path.includes("..")).toBe(false);
      expect(entry.path.includes("__proto__")).toBe(false);
    }
    expect(first.manifest.agents.map(({ path }) => path)).toContainEqual(
      expect.stringContaining("/artifact-"),
    );
  });

  test("keeps colliding slugs distinct with the ID digest", () => {
    const ids = [
      "Alpha ID",
      "alpha-id",
      "日本語",
      "💡",
      `${"a".repeat(48)}-one`,
      `${"a".repeat(48)}-two`,
    ];
    const artifacts = createArtifacts({
      agents: ids.map((hostAgentId) => ({
        hostAgentId,
        description: "description",
        prompt: "same content",
      })),
      skills: [],
    });
    const paths = artifacts.manifest.agents.map(({ path }) => path);

    expect(paths).toHaveLength(new Set(paths).size);
    expect(paths[0]).toContain("alpha-id-");
    expect(paths[1]).toContain("alpha-id-");
    expect(paths[2]).toContain("artifact-");
    expect(paths[3]).toContain("artifact-");
    expect(paths[4]).toContain(`${"a".repeat(48)}-`);
    expect(paths[5]).toContain(`${"a".repeat(48)}-`);
    expect(paths[0]).not.toBe(paths[1]);
    expect(paths[2]).not.toBe(paths[3]);
    expect(paths[4]).not.toBe(paths[5]);
  });

  test("rejects duplicate source IDs before returning a bundle", () => {
    expect(() =>
      createArtifacts({
        agents: [
          { hostAgentId: "same", description: "a", prompt: "a" },
          { hostAgentId: "same", description: "b", prompt: "b" },
        ],
        skills: [],
      }),
    ).toThrow();
  });
});

describe("readArtifacts", () => {
  test("is exposed through the reader-only public artifacts subpath", () => {
    expect(Object.keys(publicArtifacts).sort()).toEqual([
      "ArtifactReadError",
      "readArtifacts",
    ]);
  });

  test("returns only verified adapter-safe descriptors", () => {
    const { root } = validTree();

    expect(publicArtifacts.readArtifacts(root)).toEqual({
      agents: [
        {
          hostAgentId: "reviewer",
          description: "Reviews changes.",
          prompt: "# Review\n\nFind defects.\n",
        },
      ],
      skills: [
        {
          skillId: "workflow",
          description: "A useful workflow.",
          content: "# Workflow\n\n1. Check the change.\n",
        },
      ],
    });
    expect(publicArtifacts.readArtifacts(root)).not.toHaveProperty("manifest");
  });

  test("returns undefined when the artifact tree is absent", () => {
    expect(publicArtifacts.readArtifacts(project())).toBeUndefined();
  });

  test("throws a typed error for an existing tree without a manifest", () => {
    const root = project();
    mkdirSync(artifactDirectory(root), { recursive: true });

    const error = expectReadError(() => publicArtifacts.readArtifacts(root));

    expect(error.name).toBe("ArtifactReadError");
    expect("agents" in error).toBe(false);
    expect("skills" in error).toBe(false);
  });

  test.each(["agents", "skills"] as const)(
    "throws a typed error when the empty manifest tree is missing %s",
    (missingNamespace) => {
      const root = project();
      const directory = artifactDirectory(root);
      mkdirSync(
        join(directory, missingNamespace === "agents" ? "skills" : "agents"),
        {
          recursive: true,
        },
      );
      writeFileSync(
        join(directory, "manifest.json"),
        JSON.stringify({
          format: "atlante-artifacts",
          version: 1,
          agents: [],
          skills: [],
        }),
      );

      const error = expectReadError(() => publicArtifacts.readArtifacts(root));

      expect(error.code).toBe("invalid-tree");
      expect(error.artifactPath).toBe(join(directory, missingNamespace));
    },
  );

  test("fails closed without exposing valid descriptors before a later failure", () => {
    const { root, manifest, payloads } = validTree();
    const skill = manifest.skills[0];
    if (!skill) throw new Error("test fixture has no skill");
    writeFileSync(
      join(artifactDirectory(root), ...skill.path.split("/")),
      new Uint8Array([0xff, 0xfe]),
    );

    const error = expectReadError(() => publicArtifacts.readArtifacts(root));

    expect(error.message).toContain(skill.path);
    expect(payloads).toHaveLength(2);
    expect("agents" in error).toBe(false);
  });

  test.each([
    ["malformed JSON", (_manifest: ArtifactManifest): string => "{not json"],
    [
      "unknown manifest field",
      (manifest: ArtifactManifest) => ({ ...manifest, extra: true }),
    ],
    [
      "unsupported version",
      (manifest: ArtifactManifest) => ({ ...manifest, version: 2 }),
    ],
    [
      "unknown entry field",
      (manifest: ArtifactManifest) => ({
        ...manifest,
        agents: [{ ...manifest.agents[0], extra: true }],
      }),
    ],
    [
      "missing description",
      (manifest: ArtifactManifest) => ({
        ...manifest,
        agents: [
          {
            path: manifest.agents[0]?.path,
            id: manifest.agents[0]?.id,
            sha256: manifest.agents[0]?.sha256,
          },
        ],
      }),
    ],
    [
      "invalid hash",
      (manifest: ArtifactManifest) => ({
        ...manifest,
        agents: [{ ...manifest.agents[0], sha256: "not-a-hash" }],
      }),
    ],
  ] as const)("rejects %s", (_name, mutate) => {
    const { root, manifest, payloads } = validTree();
    const changed = mutate(manifest);
    writeTree(root, changed as ArtifactManifest, payloads);

    expectReadError(() => publicArtifacts.readArtifacts(root));
  });

  test("rejects duplicate IDs and duplicate paths", () => {
    const { root, manifest, payloads } = validTree();
    const agent = manifest.agents[0];
    const skill = manifest.skills[0];
    if (!agent || !skill) throw new Error("test fixture is incomplete");
    const duplicateId = {
      ...manifest,
      agents: [agent, { ...agent, description: "two" }],
    };
    writeTree(root, duplicateId, payloads);
    expectReadError(() => publicArtifacts.readArtifacts(root));

    const duplicatePath = {
      ...manifest,
      skills: [skill, { ...skill, id: "another-skill" }],
    };
    writeTree(root, duplicatePath, payloads);
    expectReadError(() => publicArtifacts.readArtifacts(root));
  });

  test.each(["missing payload", "altered payload"] as const)(
    "rejects %s",
    (name) => {
      const { root, manifest } = validTree();
      const agent = manifest.agents[0];
      if (!agent) throw new Error("test fixture has no agent");
      if (name === "missing payload") {
        rmSync(join(artifactDirectory(root), ...agent.path.split("/")));
      } else {
        writeFileSync(
          join(artifactDirectory(root), ...agent.path.split("/")),
          "changed",
        );
      }

      expectReadError(() => publicArtifacts.readArtifacts(root));
    },
  );

  test.each([
    ["namespace mismatch", "skills/reviewer.md"],
    ["unsafe traversal", "../outside.md"],
    ["absolute path", "/tmp/outside.md"],
    ["backslash path", "agents\\outside.md"],
    ["wrong deterministic name", "agents/not-the-digest.md"],
    [
      "altered slug",
      (manifest: ArtifactManifest) =>
        `agents/wrong-${digest(manifest.agents[0]?.id ?? "")}-${manifest.agents[0]?.sha256}.md`,
    ],
  ] as const)("rejects %s", (_name, pathOrFactory) => {
    const { root, manifest, payloads } = validTree();
    const agent = manifest.agents[0];
    if (!agent) throw new Error("test fixture has no agent");
    const path =
      typeof pathOrFactory === "function"
        ? pathOrFactory(manifest)
        : pathOrFactory;
    writeTree(root, { ...manifest, agents: [{ ...agent, path }] }, payloads);

    expectReadError(() => publicArtifacts.readArtifacts(root));
  });

  test("rejects symlinked artifact roots and payloads", () => {
    const root = project();
    const parent = join(root, ".atlante");
    mkdirSync(parent, { recursive: true });
    const real = join(root, "real-artifacts");
    mkdirSync(real);
    symlinkSync(real, join(parent, "artifacts"));
    expectReadError(() => publicArtifacts.readArtifacts(root));

    const valid = validTree();
    const payload = valid.manifest.agents[0]?.path;
    if (!payload) throw new Error("test fixture has no agent");
    const target = join(artifactDirectory(valid.root), ...payload.split("/"));
    rmSync(target);
    symlinkSync(join(valid.root, "missing-payload"), target);
    expectReadError(() => publicArtifacts.readArtifacts(valid.root));
  });

  test.each(["agents", "skills"] as const)(
    "rejects a symlinked empty %s namespace",
    (namespace) => {
      const root = project();
      const directory = artifactDirectory(root);
      mkdirSync(directory, { recursive: true });
      const realNamespace = join(root, `real-${namespace}`);
      mkdirSync(realNamespace);
      symlinkSync(realNamespace, join(directory, namespace));
      mkdirSync(join(directory, namespace === "agents" ? "skills" : "agents"));
      writeFileSync(
        join(directory, "manifest.json"),
        JSON.stringify({
          format: "atlante-artifacts",
          version: 1,
          agents: [],
          skills: [],
        }),
      );

      expectReadError(() => publicArtifacts.readArtifacts(root));
    },
  );

  test("rejects non-regular payloads", () => {
    const { root, manifest } = validTree();
    const payload = manifest.agents[0]?.path;
    if (!payload) throw new Error("test fixture has no agent");
    rmSync(join(artifactDirectory(root), ...payload.split("/")));
    mkdirSync(join(artifactDirectory(root), ...payload.split("/")));

    expectReadError(() => publicArtifacts.readArtifacts(root));
  });

  test("rejects invalid UTF-8 payload bytes", () => {
    const { root, manifest, payloads } = validTree();
    const agent = manifest.agents[0];
    if (!agent) throw new Error("test fixture has no agent");
    const bytes = new Uint8Array([0xc3, 0x28]);
    const path = agent.path.replace(
      /-[0-9a-f]{64}\.md$/,
      `-${digest(bytes)}.md`,
    );
    writeTree(
      root,
      { ...manifest, agents: [{ ...agent, path, sha256: digest(bytes) }] },
      [{ path, bytes }, ...payloads.slice(1)],
    );

    expectReadError(() => publicArtifacts.readArtifacts(root));
  });

  test("preserves a leading UTF-8 BOM in verified Markdown", () => {
    const artifacts = createArtifacts({
      agents: [
        {
          hostAgentId: "bom-agent",
          description: "BOM agent",
          prompt: "\ufeff# Prompt\n",
        },
      ],
      skills: [],
    });
    const root = project();
    writeTree(root, artifacts.manifest, artifacts.payloads);

    expect(publicArtifacts.readArtifacts(root)?.agents[0]?.prompt).toBe(
      "\ufeff# Prompt\n",
    );
  });

  test("does not block when a regular payload is replaced by a FIFO", async () => {
    if (process.platform === "win32") return;

    const { root, manifest } = validTree();
    const payload = manifest.agents[0]?.path;
    if (!payload) throw new Error("test fixture has no agent");
    const target = join(artifactDirectory(root), ...payload.split("/"));
    const fifo = `${target}.fifo`;
    execFileSync("mkfifo", [fifo]);

    const child = spawn(
      "bun",
      [
        "--eval",
        `import * as realFs from "node:fs";
const target = ${JSON.stringify(target)};
const fifo = ${JSON.stringify(fifo)};
let swapped = false;
const { readArtifacts } = await import("@atlante/builder/artifacts");
try {
  readArtifacts(${JSON.stringify(root)}, {
    afterPreflight(path) {
      if (!swapped && path === target) {
        swapped = true;
        realFs.renameSync(fifo, target);
      }
    },
  });
  process.exit(swapped ? 2 : 3);
} catch (error) {
  process.exit(swapped && error?.name === "ArtifactReadError" ? 0 : 4);
}`,
      ],
      { cwd: builderPackage, stdio: "ignore" },
    );
    const exited = new Promise<number>((resolve) =>
      child.once("exit", (code) => resolve(code ?? -1)),
    );
    const result = await Promise.race([
      exited.then((code) => ({ code, timedOut: false })),
      new Promise<{ code: number; timedOut: boolean }>((resolve) =>
        setTimeout(() => resolve({ code: -1, timedOut: true }), 1_500),
      ),
    ]);

    if (result.timedOut) {
      child.kill();
      await exited;
    }

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  });

  test("does not follow an ancestor symlink created after preflight", async () => {
    if (process.platform === "win32") return;

    const { root, manifest } = validTree();
    const payload = manifest.agents[0]?.path;
    if (!payload) throw new Error("test fixture has no agent");
    const agents = join(artifactDirectory(root), "agents");
    const agentsBackup = `${agents}.real`;
    const outside = join(root, "outside");
    const target = join(artifactDirectory(root), ...payload.split("/"));
    const outsidePayload = join(
      outside,
      payload.substring(payload.lastIndexOf("/") + 1),
    );
    mkdirSync(outside, { recursive: true });
    writeFileSync(outsidePayload, readFileSync(target));

    const child = spawn(
      "bun",
      [
        "--eval",
        `import * as realFs from "node:fs";
const target = ${JSON.stringify(join(artifactDirectory(root), ...payload.split("/")))};
const agents = ${JSON.stringify(agents)};
const agentsBackup = ${JSON.stringify(agentsBackup)};
const outside = ${JSON.stringify(outside)};
let swapped = false;
const { readArtifacts } = await import("@atlante/builder/artifacts");
try {
  readArtifacts(${JSON.stringify(root)}, {
    afterPreflight(path) {
      if (!swapped && path === target) {
        swapped = true;
        realFs.renameSync(agents, agentsBackup);
        realFs.symlinkSync(outside, agents);
      }
    },
  });
  process.exit(swapped ? 2 : 3);
} catch (error) {
  process.exit(swapped && error?.name === "ArtifactReadError" ? 0 : 4);
}`,
      ],
      { cwd: builderPackage, stdio: "ignore" },
    );
    const exited = new Promise<number>((resolve) =>
      child.once("exit", (code) => resolve(code ?? -1)),
    );
    const result = await Promise.race([
      exited.then((code) => ({ code, timedOut: false })),
      new Promise<{ code: number; timedOut: boolean }>((resolve) =>
        setTimeout(() => resolve({ code: -1, timedOut: true }), 1_500),
      ),
    ]);

    if (result.timedOut) {
      child.kill();
      await exited;
    }

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
  });
});
