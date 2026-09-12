import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeOpenCode } from "@atlante/opencode";
import { discoverEvalScenarios } from "@atlante/validator";
import { runChecks } from "../src/checks.js";
import {
  assembleSandbox,
  createRunRoot,
  destroyRunRoot,
  destroySandbox,
  NativeOutputsNotVerifiedError,
  resolveBudget,
  runCommand,
  verifyNativeOutputs,
} from "../src/index.js";

const fixtureProject = join(import.meta.dir, "fixtures", "project");

let projectRoot: string;
let runRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "eval-sandbox-project-"));
  cpSync(fixtureProject, projectRoot, { recursive: true });
  materializeOpenCode(projectRoot, {
    agents: [
      {
        hostAgentId: "build",
        description: "Build agent",
        prompt: "You are a build agent.",
      },
    ],
    skills: [],
  });
  expect(verifyNativeOutputs(projectRoot).files).toHaveLength(1);
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
  test("assembles fixture, native outputs, snapshot, setup, and git baseline", async () => {
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
      existsSync(join(sandbox.root, ".opencode", "agents", "build.md")),
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
    expect(sandbox.baseline).toMatch(/^[0-9a-f]{40,64}$/);

    // Git baseline exists with the eval identity.
    const log = await gitLog(sandbox.root);
    expect(log).toContain("atlante-eval baseline");

    destroySandbox(sandbox);
    expect(existsSync(sandbox.root)).toBe(false);
  });

  test("copies a pack scenario fixture from its origin root while using project native outputs", async () => {
    const packRoot = mkdtempSync(join(tmpdir(), "eval-sandbox-pack-"));
    mkdirSync(join(packRoot, "eval", "scenarios"), { recursive: true });
    mkdirSync(join(packRoot, "eval", "fixtures", "pack"), {
      recursive: true,
    });
    writeFileSync(
      join(packRoot, "eval", "fixtures", "pack", "pack-only.txt"),
      "pack fixture\n",
    );
    writeFileSync(
      join(packRoot, "eval", "scenarios", "pack.eval.json"),
      `${JSON.stringify({
        $schema: "https://atlante.sh/schema/v0.1/eval-scenario.json",
        version: "0.1",
        name: "pack-scenario",
        task: { fixture: "eval/fixtures/pack", prompt: "Say hi." },
        checks: [{ type: "file-exists", path: "pack-only.txt" }],
      })}\n`,
    );
    try {
      const discovered = discoverEvalScenarios(
        packRoot,
        "eval/scenarios/*.eval.json",
        {
          origin: {
            kind: "package",
            root: packRoot,
            packageName: "@acme/review-pack",
            packageVersion: "1.2.3",
            locator: "@acme/review-pack",
          },
        },
      ).scenarios.at(0);
      if (!discovered) throw new Error("pack scenario not discovered");

      const sandbox = await assembleSandbox(
        {
          runRoot,
          projectRoot,
          scenario: discovered,
          trialIndex: 7,
          budget: resolveBudget({ evalConfig: undefined }),
          keep: false,
        },
        () => {},
      );
      try {
        expect(existsSync(join(sandbox.root, "pack-only.txt"))).toBe(true);
        expect(
          existsSync(join(sandbox.root, ".opencode", "agents", "build.md")),
        ).toBe(true);
      } finally {
        destroySandbox(sandbox);
      }
    } finally {
      rmSync(packRoot, { recursive: true, force: true });
    }
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

  test("rejects a symlinked fixture during assembly", async () => {
    const outside = mkdtempSync(join(tmpdir(), "eval-sandbox-outside-"));
    const link = join(projectRoot, "eval", "fixtures", "api", ".git");
    const base = discoverHappyScenario();
    symlinkSync(outside, link, "dir");
    try {
      await expect(
        assembleSandbox(
          {
            runRoot,
            projectRoot,
            scenario: {
              ...base,
              scenario: {
                ...base.scenario,
                name: "symlinked-fixture",
              },
            },
            trialIndex: 3,
            budget: resolveBudget({ evalConfig: undefined }),
            keep: false,
          },
          () => {},
        ),
      ).rejects.toThrow(/symbolic link/);
    } finally {
      rmSync(link, { force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects symlinked native output parents before copying", async () => {
    const maliciousProject = mkdtempSync(
      join(tmpdir(), "eval-native-output-project-"),
    );
    cpSync(fixtureProject, maliciousProject, { recursive: true });
    materializeOpenCode(maliciousProject, {
      agents: [
        {
          hostAgentId: "build",
          description: "Build agent",
          prompt: "You are a build agent.",
        },
      ],
      skills: [],
    });
    const outside = mkdtempSync(join(tmpdir(), "eval-native-output-outside-"));
    const parent = join(maliciousProject, ".opencode", "agents");
    rmSync(parent, { recursive: true, force: true });
    symlinkSync(outside, parent, "dir");
    const base = discoverEvalScenarios(
      maliciousProject,
      "eval/scenarios/*.eval.json",
    ).scenarios.at(0);
    if (!base) throw new Error("fixture scenario not discovered");
    try {
      await expect(
        assembleSandbox(
          {
            runRoot,
            projectRoot: maliciousProject,
            scenario: {
              ...base,
              scenario: {
                ...base.scenario,
                name: "symlinked-native-output",
              },
            },
            trialIndex: 4,
            budget: resolveBudget({ evalConfig: undefined }),
            keep: false,
          },
          () => {},
        ),
      ).rejects.toThrow(/native output verification failed:.*symlink/);
    } finally {
      rmSync(maliciousProject, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("rejects a fixture file that collides with a native output", async () => {
    const collidingProject = mkdtempSync(
      join(tmpdir(), "eval-colliding-fixture-"),
    );
    cpSync(fixtureProject, collidingProject, { recursive: true });
    // Ship a fixture file at the exact native-output path.
    mkdirSync(
      join(collidingProject, "eval", "fixtures", "api", ".opencode", "agents"),
      {
        recursive: true,
      },
    );
    writeFileSync(
      join(
        collidingProject,
        "eval",
        "fixtures",
        "api",
        ".opencode",
        "agents",
        "build.md",
      ),
      "fixture impostor\n",
    );
    materializeOpenCode(collidingProject, {
      agents: [
        {
          hostAgentId: "build",
          description: "Build agent",
          prompt: "You are a build agent.",
        },
      ],
      skills: [],
    });
    const base = discoverEvalScenarios(
      collidingProject,
      "eval/scenarios/*.eval.json",
    ).scenarios.at(0);
    if (!base) throw new Error("fixture scenario not discovered");
    try {
      await expect(
        assembleSandbox(
          {
            runRoot,
            projectRoot: collidingProject,
            scenario: {
              ...base,
              scenario: { ...base.scenario, name: "colliding-fixture" },
            },
            trialIndex: 5,
            budget: resolveBudget({ evalConfig: undefined }),
            keep: false,
          },
          () => {},
        ),
      ).rejects.toThrow(/collides with a verified native output/);
    } finally {
      rmSync(collidingProject, { recursive: true, force: true });
    }
  });

  test("snapshot and grading agree on a symlink planted by setup", async () => {
    const discovered = discoverHappyScenario();
    const sandbox = await assembleSandbox(
      {
        runRoot,
        projectRoot,
        scenario: {
          ...discovered,
          scenario: {
            ...discovered.scenario,
            name: "setup-symlink",
            task: {
              ...discovered.scenario.task,
              setup: ["ln", "-s", "src/index.ts", "planted-link.ts"],
            },
            checks: [{ type: "file-unchanged", path: "planted-link.ts" }],
          },
        },
        trialIndex: 6,
        budget: resolveBudget({ evalConfig: undefined }),
        keep: false,
      },
      () => {},
    );
    try {
      // The snapshot must not hash through the symlink: pre-lstat it stored
      // the target's content hash, so a host swapping the link for a file
      // with identical bytes would have graded as unchanged.
      expect(sandbox.snapshot[0]?.hash).toBeNull();
      // Grading refuses the symlink outright instead of following it.
      const [result] = await runChecks(sandbox, [
        { type: "file-unchanged", path: "planted-link.ts" },
      ]);
      expect(result?.verdict).toBe("error");
    } finally {
      destroySandbox(sandbox);
    }
  });

  test("fails when setup times out even if the process exits cleanly", async () => {
    const discovered = discoverHappyScenario();
    await expect(
      assembleSandbox(
        {
          runRoot,
          projectRoot,
          scenario: {
            ...discovered,
            scenario: {
              ...discovered.scenario,
              name: "timed-out-setup",
              task: {
                ...discovered.scenario.task,
                setup: [
                  "sh",
                  "-c",
                  "trap 'exit 0' TERM; while :; do sleep 1; done",
                ],
              },
            },
          },
          trialIndex: 5,
          budget: {
            ...resolveBudget({ evalConfig: undefined }),
            setupTimeoutMs: 100,
          },
          keep: false,
        },
        () => {},
      ),
    ).rejects.toThrow(/setup timed out/);
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

describe("verifyNativeOutputs", () => {
  test("fails closed when the publication is missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "eval-empty-project-"));
    try {
      expect(() => verifyNativeOutputs(empty)).toThrow(
        NativeOutputsNotVerifiedError,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
