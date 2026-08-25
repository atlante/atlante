import { spawn as spawnProcess } from "node:child_process";
import { acquireMutationCampaign, resolveMutationRoot } from "./mutation-root";

export const MUTATION_WORKSPACES = [
  "schema",
  "resources",
  "validator",
] as const;
type MutationWorkspace = (typeof MUTATION_WORKSPACES)[number];

type Child = {
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
};

type Spawn = (
  argv: string[],
  options: { shell: false; env?: NodeJS.ProcessEnv },
) => Child;

type Dependencies = {
  spawn?: Spawn;
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => () => void;
  escalationMs?: number;
};

const usage = "usage: bun run mutation:test <schema|resources|validator>";

function validateWorkspace(args: string[] | undefined): MutationWorkspace {
  if (
    args?.length !== 1 ||
    !MUTATION_WORKSPACES.includes(args[0] as MutationWorkspace)
  ) {
    throw new Error(
      `${usage}\nvalid workspaces: ${MUTATION_WORKSPACES.join(", ")}`,
    );
  }
  return args[0] as MutationWorkspace;
}

export function defaultSpawn(
  [command, ...args]: string[],
  options: { shell: false; env?: NodeJS.ProcessEnv },
): Child {
  const child = spawnProcess(command, args, {
    ...options,
    detached: process.platform !== "win32",
    stdio: "inherit",
  });
  return {
    exited: new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
    }),
    kill: (signal) => {
      if (process.platform !== "win32" && child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The group may have already exited; fall back to the child handle.
        }
      }
      child.kill(signal);
    },
  };
}

async function runChild(
  argv: string[],
  options: { shell: false; env?: NodeJS.ProcessEnv },
  dependencies: Required<Dependencies>,
): Promise<number> {
  const child = dependencies.spawn(argv, options);
  let interruption: NodeJS.Signals | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const handleSignal = (signal: NodeJS.Signals) => {
    if (interruption) return;
    interruption = signal;
    child.kill(signal);
    escalation = setTimeout(
      () => child.kill("SIGKILL"),
      dependencies.escalationMs,
    );
  };
  const removeSignals = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) =>
    dependencies.onSignal(signal, () => handleSignal(signal)),
  );
  try {
    const code = await child.exited;
    if (!interruption) return code;
    return interruption === "SIGINT"
      ? 130
      : interruption === "SIGTERM"
        ? 143
        : 129;
  } finally {
    if (escalation) clearTimeout(escalation);
    for (const removeSignal of removeSignals) removeSignal();
  }
}

export async function runMutation(
  args: string[] | undefined,
  dependencies: Dependencies = {},
): Promise<number> {
  const workspace = validateWorkspace(args);
  const resolved: Required<Dependencies> = {
    spawn: dependencies.spawn ?? defaultSpawn,
    onSignal:
      dependencies.onSignal ??
      ((signal, handler) => {
        process.once(signal, handler);
        return () => process.off(signal, handler);
      }),
    escalationMs: dependencies.escalationMs ?? 5_000,
  };
  const mutationRoot = resolveMutationRoot(
    process.env.ATLANTE_MUTATION_ROOT,
    process.cwd(),
  );
  const preflight = await runChild(
    ["bun", "run", "test"],
    { shell: false },
    resolved,
  );
  if (preflight !== 0) return preflight;

  const release = await acquireMutationCampaign(mutationRoot, workspace);
  try {
    return runChild(
      ["bun", "x", "stryker", "run", "stryker.config.ts"],
      {
        shell: false,
        env: { ...process.env, ATLANTE_MUTATION_WORKSPACE: workspace },
      },
      resolved,
    );
  } finally {
    await release();
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runMutation(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
