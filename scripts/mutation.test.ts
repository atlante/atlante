import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { defaultSpawn, runMutation } from "./mutation";

type FakeChild = {
  exited: Promise<number>;
  kill: ReturnType<typeof vi.fn>;
};

function child(exitCode: number): FakeChild {
  return { exited: Promise.resolve(exitCode), kill: vi.fn() };
}

test.each(["schema", "resources", "validator"])(
  "accepts the %s workspace and forwards structured arguments",
  async (workspace) => {
    const children = [child(0), child(0)];
    const spawn = vi.fn(() => {
      const next = children.shift();
      if (!next) throw new Error("unexpected child process");
      return next;
    });

    const result = await runMutation([workspace], { spawn });

    expect(result).toBe(0);
    expect(spawn).toHaveBeenNthCalledWith(1, ["bun", "run", "test"], {
      shell: false,
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
      tempDirName: expect.stringMatching(/^mutation\/schema\/temp-/),
      cleanTempDir: "always",
    }),
  );
  expect(config).not.toHaveProperty("tempDir");
});

test("uses a process pool for Stryker's Vitest run", async () => {
  vi.stubEnv("ATLANTE_MUTATION_WORKSPACE", "schema");

  const { default: config } = await import("../vitest.config.ts");

  expect(config.test?.pool).toBe("forks");
});

test("runs the complete suite in one Stryker worker", async () => {
  vi.stubEnv("ATLANTE_MUTATION_WORKSPACE", "schema");

  const { default: config } = await import("../stryker.config.ts");

  expect(config.concurrency).toBe(1);
  expect(config.inPlace).toBe(false);
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
