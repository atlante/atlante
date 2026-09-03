import { spawn } from "node:child_process";
import { URL } from "node:url";

export type CommandOutcome = {
  exit: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Spawn-level failure (binary missing); never routed through a shell. */
  spawnError?: string;
};

const DEFAULT_KILL_GRACE_MS = 5_000;

/**
 * Host environment variables that may reach a child process launched after a
 * model-controlled trial. Credentials travel through the isolated host state
 * directory, so only execution basics and sanitized proxy routing are kept.
 */
const ENV_ALLOWLIST = Object.freeze([
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const);

/**
 * Picks a safe subset of the host environment for children that execute after
 * model-controlled code. No-proxy lists are host names and CIDR ranges, not
 * URLs, so they pass through unchanged; proxy URLs lose userinfo, while
 * unparseable and scheme-less values are dropped.
 */
export function pickAllowedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const picked: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = env[key];
    if (value === undefined) continue;
    if (key.toLowerCase() === "no_proxy") {
      picked[key] = value;
      continue;
    }
    if (key.endsWith("_PROXY") || key.endsWith("_proxy")) {
      const sanitized = sanitizeProxyValue(value);
      if (sanitized !== undefined) picked[key] = sanitized;
      continue;
    }
    picked[key] = value;
  }
  return picked;
}

/** Keeps proxy routing while removing URL userinfo from a child env. */
function sanitizeProxyValue(value: string): string | undefined {
  try {
    const proxy = new URL(value);
    if (proxy.hostname === "") return undefined;
    proxy.username = "";
    proxy.password = "";
    return proxy.toString();
  } catch {
    return undefined;
  }
}

/**
 * Runs an argv array in a directory without a shell, with an in-flight
 * timeout: SIGTERM, a grace window, then SIGKILL. When the child was spawned
 * detached (own process group) the group is killed so subtrees cannot outlive
 * the trial.
 *
 * Windows caveat: `detached` is skipped on win32, so only the direct child
 * receives the kill signals; grandchildren (e.g. tool processes the host
 * spawned) can outlive a timed-out trial there. Revisit with `taskkill /T /F`
 * if Windows becomes a supported eval platform.
 */
export function runCommand(
  argv: readonly string[],
  options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    let timedOut = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const child = spawn(argv[0] ?? "", argv.slice(1), {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    let settled = false;
    const finish = (exit: number | null, spawnError?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
      resolve({
        exit,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        ...(spawnError ? { spawnError } : {}),
      });
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killTree(child, DEFAULT_KILL_GRACE_MS, (grace) => {
        graceTimer = grace;
      });
    }, options.timeoutMs);

    child.on("error", (cause) => {
      // The process never spawned (ENOENT and friends).
      finish(null, cause.message);
    });

    child.on("close", (exit) => finish(exit));
  });
}

/** SIGTERM, a grace window, then SIGKILL — group-wide on POSIX, child-only on Windows. */
export function killTree(
  child: ReturnType<typeof spawn>,
  graceMs: number,
  registerGraceTimer?: (timer: NodeJS.Timeout) => void,
): void {
  const signal = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined && process.platform !== "win32")
        process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // The group may already be gone.
      try {
        child.kill(signal);
      } catch {
        // Nothing left to kill.
      }
    }
  };
  signal("SIGTERM");
  const timer = setTimeout(() => signal("SIGKILL"), graceMs);
  registerGraceTimer?.(timer);
  child.once("close", () => clearTimeout(timer));
}
