import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createArtifacts,
  publishArtifacts,
  readArtifacts,
} from "@atlante/artifacts";
import { discoverEvalScenarios } from "@atlante/validator";
import {
  ArtifactsNotVerifiedError,
  assembleSandbox,
  createRunRoot,
  destroyRunRoot,
  destroySandbox,
  resolveBudget,
  runCommand,
  verifyArtifacts,
} from "../src/index.js";

const fixtureProject = join(import.meta.dir, "fixtures", "project");

let projectRoot: string;
let runRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "eval-sandbox-project-"));
  cpSync(fixtureProject, projectRoot, { recursive: true });
  // Publish a minimal but fully verified artifact publication.
  const created = createArtifacts({
    agents: [
      {
        hostAgentId: "build",
        description: "Build agent",
        prompt: "You are a build agent.",
      },
    ],
    skills: [],
  });
  publishArtifacts(projectRoot, created);
  verifyArtifacts(projectRoot);
  expect(readArtifacts(projectRoot)?.agents).toHaveLength(1);
  runRoot = createRunRoot();
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  destroyRunRoot(runRoot);
});

async function gitLog(root: string): Promise<string> {
  const outcome = await runCommand(["git", "log", "--oneline"], {
    cwd: root,
    timeoutMs: 30_000,
  });
  return outcome.stdout;
}

function discoverHappyScenario() {
  const { scenarios, diagnostics } = discoverEvalScenarios(
    projectRoot,
    "eval/scenarios/*.eval.json",
  );
  if (diagnostics.length > 0 || scenarios.length !== 1) {
    throw new Error(
      `fixture scenario discovery failed: ${JSON.stringify(diagnostics)}`,
    );
  }
  const discovered = scenarios.at(0);
  if (!discovered) throw new Error("fixture scenario not discovered");
  return discovered;
}

describe("assembleSandbox", () => {
  test("assembles fixture, artifacts, snapshot, setup, and git baseline", async () => {
    const discovered = discoverHappyScenario();
    const budget = resolveBudget({ evalConfig: undefined });
    const sandbox = await assembleSandbox(
      {
        runRoot,
        projectRoot,
        scenario: discovered,
        trialIndex: 0,
        budget,
        keep: false,
      },
      () => {},
    );

    expect(existsSync(join(sandbox.root, "src", "index.ts"))).toBe(true);
    expect(
      existsSync(join(sandbox.root, ".atlante", "artifacts", "manifest.json")),
    ).toBe(true);
    // Setup ran after the fixture copy and before the snapshot.
    expect(existsSync(join(sandbox.root, "setup-ran.txt"))).toBe(true);

    // Snapshot: present file hashes; missing file records null.
    const indexHash = sandbox.snapshot.find(
      (entry) => entry.path === "src/index.ts",
    );
    expect(indexHash?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      sandbox.snapshot.find((entry) => entry.path === "src/missing.ts")?.hash,
    ).toBeNull();

    // Git baseline exists with the eval identity.
    const log = await gitLog(sandbox.root);
    expect(log).toContain("atlante-eval baseline");

    destroySandbox(sandbox);
    expect(existsSync(sandbox.root)).toBe(false);
  });

  test("kept sandboxes survive destruction", async () => {
    const discovered = discoverHappyScenario();
    const sandbox = await assembleSandbox(
      {
        runRoot,
        projectRoot,
        scenario: discovered,
        trialIndex: 1,
        budget: resolveBudget({ evalConfig: undefined }),
        keep: true,
      },
      () => {},
    );
    destroySandbox(sandbox);
    expect(existsSync(sandbox.root)).toBe(true);
    rmSync(join(sandbox.root, ".."), { recursive: true, force: true });
  });

  test("the host integration hook receives the sandbox before setup", async () => {
    const discovered = discoverHappyScenario();
    const seen: string[] = [];
    const sandbox = await assembleSandbox(
      {
        runRoot,
        projectRoot,
        scenario: discovered,
        trialIndex: 2,
        budget: resolveBudget({ evalConfig: undefined }),
        keep: false,
      },
      (received) => {
        seen.push(received.root);
        // Host config written by the hook is visible to setup and the baseline.
        const { writeFileSync } =
          require("node:fs") as typeof import("node:fs");
        writeFileSync(join(received.root, "opencode.json"), "{}\n");
      },
    );
    expect(seen).toEqual([sandbox.root]);
    expect(existsSync(join(sandbox.root, "opencode.json"))).toBe(true);
    const status = await runCommand(["git", "status", "--porcelain"], {
      cwd: sandbox.root,
      timeoutMs: 30_000,
    });
    // The host config is part of the baseline commit: agent edits to it would
    // surface in diff checks.
    expect(status.stdout).toBe("");
    destroySandbox(sandbox);
  });
});

describe("verifyArtifacts", () => {
  test("fails closed when the publication is missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "eval-empty-project-"));
    try {
      expect(() => verifyArtifacts(empty)).toThrow(ArtifactsNotVerifiedError);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
