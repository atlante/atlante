import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import {
  type CampaignRecord,
  defaultSpawn,
  finalizeCampaign,
  parseVitestCounts,
  runMutation,
  writePreflightRecord,
} from "./mutation";

type FakeChild = {
  exited: Promise<number>;
  kill: ReturnType<typeof vi.fn>;
};

const testMutationRoot = join(
  tmpdir(),
  `atlante-mutation-tests-${process.pid}`,
);

beforeEach(() => {
  vi.stubEnv("ATLANTE_MUTATION_ROOT", testMutationRoot);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(testMutationRoot, { recursive: true, force: true });
});

function child(exitCode: number): FakeChild {
  return { exited: Promise.resolve(exitCode), kill: vi.fn() };
}

test("parses ordinary Vitest file and test counts", () => {
  expect(
    parseVitestCounts("Test Files 53 passed (53)\nTests 776 passed (776)"),
  ).toEqual({
    testFiles: { failed: 0, passed: 53, total: 53 },
    tests: { failed: 0, passed: 776, total: 776 },
  });
  expect(
    parseVitestCounts(
      "Test Files 1 failed | 52 passed\nTests 2 failed | 774 passed",
    ),
  ).toEqual({
    testFiles: { failed: 1, passed: 52, total: 53 },
    tests: { failed: 2, passed: 774, total: 776 },
  });
});

test("writes a preflight record atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-preflight-"));
  try {
    const path = await writePreflightRecord(root, "schema", {
      schemaVersion: 1,
      campaignId: "campaign-1",
      command: "bun run test",
      startedAt: "2026-08-25T00:00:00.000Z",
      endedAt: "2026-08-25T00:00:01.000Z",
      runtimeMs: 1000,
      exitCode: 0,
      signal: null,
      status: "passed",
      gitHead: "abc",
      sourceSha256: "def",
      sourceAlgorithm: "sha256:path\\0bytes\\0:v1",
      configSha256: "ghi",
      toolVersions: { bun: "1", node: "22", vitest: "4", stryker: "10" },
    });
    await expect(readFile(path, "utf8")).resolves.toContain(
      '"campaignId": "campaign-1"',
    );
    await expect(readdir(join(root, "schema", "preflight"))).resolves.toEqual([
      "campaign-1.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes a campaign record atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-campaign-"));
  try {
    const record: CampaignRecord = {
      schemaVersion: 2,
      workspace: "schema",
      campaignId: "campaign-1",
      preflight: {
        identity: "preflight/campaign-1.json",
        sha256: "a".repeat(64),
      },
      report: {
        identity: "mutation/schema/mutation.json",
        sha256: "b".repeat(64),
      },
      verdict: {
        identity: "verdict/campaign-1.json",
        sha256: "e".repeat(64),
        counts: { entries: 0, files: 0, statuses: {} },
      },
      source: {
        identity: "packages/schema/src/**/*.ts",
        sha256: "c".repeat(64),
      },
      config: { identity: "stryker.config.ts", sha256: "d".repeat(64) },
      stryker: {
        startedAt: "2026-08-25T00:00:01.000Z",
        endedAt: "2026-08-25T00:00:02.000Z",
        runtimeMs: 1000,
      },
      exitCode: 0,
      signal: null,
      gitHead: "abc",
      toolVersions: { bun: "1", node: "22", vitest: "4", stryker: "10" },
    };
    const preflightBytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        campaignId: "campaign-1",
        status: "passed",
      }),
    );
    await mkdir(join(root, "schema", "preflight"), { recursive: true });
    await writeFile(
      join(root, "schema", "preflight", "campaign-1.json"),
      preflightBytes,
    );
    record.preflight.sha256 = createHash("sha256")
      .update(preflightBytes)
      .digest("hex");
    await mkdir(join(root, "schema"), { recursive: true });
    await writeFile(join(root, "schema", "mutation.json"), "{}", "utf8");
    const path = await finalizeCampaign(root, record);
    const written = JSON.parse(await readFile(path, "utf8")) as CampaignRecord;
    expect(written).toMatchObject({
      campaignId: "campaign-1",
      report: {
        identity: "mutation/schema/mutation.json",
        sha256: expect.any(String),
      },
      verdict: {
        identity: "mutation/schema/verdict/campaign-1.json",
        sha256: expect.any(String),
        counts: { entries: 0, files: 0, statuses: {} },
      },
    });
    await expect(
      readFile(join(root, "schema", "verdict", "campaign-1.json"), "utf8"),
    ).resolves.toContain('"campaignId": "campaign-1"');
    await expect(readdir(join(root, "schema", "campaign"))).resolves.toEqual([
      "campaign-1.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["schema", "resources", "validator"])(
  "accepts the %s workspace and forwards structured arguments",
  async (workspace) => {
    const children = [child(0), child(0)];
    const spawn = vi.fn((argv: string[]) => {
      const next = children.shift();
      if (!next) throw new Error("unexpected child process");
      if (argv[1] === "x") {
        writeFileSync(
          join(
            process.env.ATLANTE_MUTATION_ROOT ?? "mutation",
            workspace,
            "mutation.json",
          ),
          "{}",
          "utf8",
        );
      }
      return next;
    });

    const result = await runMutation([workspace], { spawn });

    expect(result).toBe(0);
    expect(spawn).toHaveBeenNthCalledWith(1, ["bun", "run", "test"], {
      shell: false,
      env: expect.objectContaining({
        ATLANTE_MUTATION_PHASE: "preflight",
        ATLANTE_MUTATION_CAMPAIGN_ID: expect.any(String),
      }),
    });
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      ["bun", "x", "stryker", "run", "stryker.config.ts"],
      expect.objectContaining({
        shell: false,
        env: expect.objectContaining({ ATLANTE_MUTATION_WORKSPACE: workspace }),
      }),
    );
  },
);

test("loads a workspace-specific Stryker temp directory with unconditional cleanup", async () => {
  vi.stubEnv("ATLANTE_MUTATION_WORKSPACE", "schema");

  const { default: config } = await import("../stryker.config.ts");

  expect(config).toEqual(
    expect.objectContaining({
      tempDirName: expect.stringContaining(
        join(
          process.env.ATLANTE_MUTATION_ROOT ?? "mutation",
          "schema",
          "temp-",
        ),
      ),
      cleanTempDir: "always",
    }),
  );
  expect(config).not.toHaveProperty("tempDir");
});

test("uses the official Vitest runner without a custom fork pool", async () => {
  vi.stubEnv("ATLANTE_MUTATION_WORKSPACE", "schema");

  const { default: config } = await import("../vitest.config.ts");

  expect(config.test?.pool).toBeUndefined();
});

test("runs the complete suite in one Stryker worker with bounded reuse", async () => {
  vi.stubEnv("ATLANTE_MUTATION_WORKSPACE", "schema");

  const { default: config } = await import("../stryker.config.ts");

  expect(config.concurrency).toBe(1);
  expect(config.timeoutMS).toBe(5_000);
  expect(config.maxTestRunnerReuse).toBe(50);
  expect(config.inPlace).toBe(false);
});

test("keeps mutation sandboxes out of recursive test discovery", async () => {
  vi.stubEnv("ATLANTE_MUTATION_WORKSPACE", "schema");

  const { default: config } = await import("../stryker.config.ts");

  // Regression guard for the prior recursive sandbox scan that observed
  // roughly 445k generated files and exhausted the Node heap.
  expect(config.ignorePatterns).toContain("mutation/**");
  expect(config.ignorePatterns).not.toContain("/mutation/**");
});

test("keeps Vitest's complete recursive suite out of mutation artifacts", async () => {
  const { default: config } = await import("../vitest.config.ts");

  expect(config.test?.include).toContain("**/*.test.ts");
  expect(config.test?.exclude).toContain("**/mutation/**");
});

test.each([[], ["schema", "resources"], ["unknown"]])(
  "rejects invalid command arguments: %j",
  async (args) => {
    const spawn = vi.fn();

    await expect(runMutation(args, { spawn })).rejects.toThrow(
      "usage: bun run mutation:test <schema|resources|validator>",
    );
    expect(spawn).not.toHaveBeenCalled();
  },
);

test("does not start Stryker when the Vitest preflight fails", async () => {
  const preflight = child(1);
  const spawn = vi.fn(() => preflight);

  await expect(runMutation(["schema"], { spawn })).resolves.toBe(1);
  expect(spawn).toHaveBeenCalledTimes(1);
});

test("records a failed preflight without acquiring a campaign or starting Stryker", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-preflight-"));
  vi.stubEnv("ATLANTE_MUTATION_ROOT", root);
  try {
    const spawn = vi.fn(() => child(1));
    await expect(runMutation(["schema"], { spawn })).resolves.toBe(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    const records = await readdir(join(root, "schema", "preflight"));
    expect(records).toHaveLength(1);
    await expect(
      readFile(join(root, "schema", ".campaign-lock")),
    ).rejects.toThrow();
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

test("records a failed campaign after Stryker exits", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-campaign-"));
  vi.stubEnv("ATLANTE_MUTATION_ROOT", root);
  try {
    const children = [child(0), child(7)];
    await expect(
      runMutation(["schema"], {
        spawn: vi.fn(() => {
          const next = children.shift();
          if (!next) throw new Error("unexpected child process");
          return next;
        }),
      }),
    ).resolves.toBe(7);
    const campaigns = await readdir(join(root, "schema", "campaign"));
    expect(campaigns).toHaveLength(1);
    const campaign = campaigns.at(0);
    if (!campaign) throw new Error("campaign record was not written");
    const record = JSON.parse(
      await readFile(join(root, "schema", "campaign", campaign), "utf8"),
    ) as CampaignRecord;
    expect(record.exitCode).toBe(7);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects successful finalization when the report is missing", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-campaign-"));
  try {
    const preflightBytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        campaignId: "campaign-1",
        status: "passed",
      }),
    );
    await mkdir(join(root, "schema", "preflight"), { recursive: true });
    await writeFile(
      join(root, "schema", "preflight", "campaign-1.json"),
      preflightBytes,
    );
    await expect(
      finalizeCampaign(root, {
        schemaVersion: 2,
        workspace: "schema",
        campaignId: "campaign-1",
        preflight: {
          identity: "preflight/campaign-1.json",
          sha256: createHash("sha256").update(preflightBytes).digest("hex"),
        },
        report: { identity: "schema/mutation.json" },
        source: { identity: "source", sha256: "c".repeat(64) },
        config: { identity: "config", sha256: "d".repeat(64) },
        stryker: {
          startedAt: "2026-08-25T00:00:01.000Z",
          endedAt: "2026-08-25T00:00:02.000Z",
          runtimeMs: 1000,
        },
        exitCode: 0,
        signal: null,
        gitHead: "abc",
        toolVersions: { bun: "1", node: "22", vitest: "4", stryker: "10" },
      }),
    ).rejects.toThrow("successful mutation campaign requires a report");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("associates the Stryker campaign with its preflight record", async () => {
  const root = await mkdtemp(join(tmpdir(), "atlante-preflight-"));
  vi.stubEnv("ATLANTE_MUTATION_ROOT", root);
  try {
    const children = [child(0), child(0)];
    const spawn = vi.fn(
      (argv: string[], options: { env?: NodeJS.ProcessEnv }) => {
        const next = children.shift();
        if (!next) throw new Error("unexpected child process");
        if (argv[1] === "x") {
          expect(options.env?.ATLANTE_MUTATION_CAMPAIGN_ID).toBeTruthy();
          expect(options.env?.ATLANTE_MUTATION_PREFLIGHT).toContain(
            "preflight",
          );
          writeFileSync(join(root, "schema", "mutation.json"), "{}", "utf8");
        }
        return next;
      },
    );
    await expect(runMutation(["schema"], { spawn })).resolves.toBe(0);
    const recordPath = join(
      root,
      "schema",
      "preflight",
      (await readdir(join(root, "schema", "preflight")))[0],
    );
    const record = JSON.parse(await readFile(recordPath, "utf8")) as {
      campaignId: string;
    };
    const strykerEnv = spawn.mock.calls[1]?.[1].env;
    expect(strykerEnv?.ATLANTE_MUTATION_CAMPAIGN_ID).toBe(record.campaignId);
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

test("propagates a Stryker failure", async () => {
  const spawn = vi.fn(() => child(spawn.mock.calls.length === 0 ? 0 : 7));

  await expect(runMutation(["schema"], { spawn })).resolves.toBe(7);
});

test("propagates a child spawn error instead of waiting for exit", async () => {
  const child = defaultSpawn(["definitely-not-a-real-command"], {
    shell: false,
  });

  await expect(child.exited).rejects.toThrow("ENOENT");
});

test.each([
  ["SIGINT", 130],
  ["SIGTERM", 143],
  ["SIGHUP", 129],
] as const)(
  "forwards %s to the active child and normalizes its status",
  async (signal, status) => {
    let release: (code: number) => void = () => undefined;
    const active = {
      exited: new Promise<number>((resolve) => (release = resolve)),
      kill: vi.fn(),
    };
    const handlers = new Map<NodeJS.Signals, () => void>();
    const spawn = vi.fn(() => active);
    const onSignal = vi.fn((next: NodeJS.Signals, handler: () => void) => {
      handlers.set(next, handler);
      return () => handlers.delete(next);
    });

    const run = runMutation(["schema"], { spawn, onSignal });
    await Promise.resolve();
    handlers.get(signal)?.();
    expect(active.kill).toHaveBeenCalledWith(signal);
    release(0);
    await expect(run).resolves.toBe(status);
  },
);

test("escalates a stuck child to SIGKILL and awaits its eventual exit", async () => {
  vi.useFakeTimers();
  try {
    let release: (code: number) => void = () => undefined;
    const active = {
      exited: new Promise<number>((resolve) => (release = resolve)),
      kill: vi.fn(),
    };
    const handlers = new Map<NodeJS.Signals, () => void>();
    const spawn = vi.fn(() => active);
    const onSignal = vi.fn((signal: NodeJS.Signals, handler: () => void) => {
      handlers.set(signal, handler);
      return () => handlers.delete(signal);
    });

    const run = runMutation(["schema"], {
      spawn,
      onSignal,
      escalationMs: 10,
    });
    await Promise.resolve();
    handlers.get("SIGTERM")?.();
    await vi.advanceTimersByTimeAsync(10);
    expect(active.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
    release(137);
    await expect(run).resolves.toBe(143);
  } finally {
    vi.useRealTimers();
  }
});

test.skipIf(process.platform === "win32")(
  "interrupts a descendant process with the mutation child group",
  async () => {
    const pidFile = join(
      tmpdir(),
      `atlante-mutation-descendant-${process.pid}`,
    );
    const script = [
      'const { spawn } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      "writeFileSync(process.env.ATLANTE_DESCENDANT_FILE, String(descendant.pid));",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    let descendantPid: number | undefined;

    const spawn = vi.fn(
      (argv: string[], options: { shell: false; env?: NodeJS.ProcessEnv }) => {
        if (argv[0] === "bun" && argv[1] === "run") {
          return defaultSpawn([process.execPath, "-e", script], {
            shell: false,
            env: { ...options.env, ATLANTE_DESCENDANT_FILE: pidFile },
          });
        }
        return child(0);
      },
    );
    const onSignal = vi.fn((signal: NodeJS.Signals, handler: () => void) => {
      if (signal !== "SIGINT") return () => undefined;
      const waitForDescendant = async () => {
        while (true) {
          try {
            descendantPid = Number(await readFile(pidFile, "utf8"));
            handler();
            return;
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
      };
      void waitForDescendant();
      return () => undefined;
    });

    try {
      await expect(runMutation(["schema"], { spawn, onSignal })).resolves.toBe(
        130,
      );
      expect(descendantPid).toBeDefined();
      if (descendantPid !== undefined) {
        expect(() => process.kill(descendantPid, 0)).toThrow();
      }
    } finally {
      await unlink(pidFile).catch(() => undefined);
    }
  },
);
