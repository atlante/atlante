import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { readOpenCodeNative } from "@atlante/opencode";
import { openCodeConfigPaths } from "@atlante/opencode/config";
import { parseJsonc } from "@atlante/validator";
import type {
  HostRunner,
  RunTrialInput,
  TrialRun,
  TrialRunOutcome,
} from "../runner.js";
import { killTree, pickAllowedEnv } from "../spawn.js";

export const OPENCODE_BINARY = "opencode";
/** Grace window for the SIGTERM → SIGKILL escalation. */
const KILL_GRACE_MS = 5_000;
const ERROR_OUTPUT_LIMIT = 2_000;

export type OpenCodeRunnerOptions = {
  projectRoot: string;
  /** Host binary; default resolves `opencode` from PATH. */
  binaryPath?: string;
  /** Host auth.json location; default is the user data dir. */
  authPath?: string;
  /** Base environment for the spawned host; default is process.env. */
  baseEnv?: NodeJS.ProcessEnv;
};

function defaultAuthPath(): string {
  const dataHome =
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "auth.json");
}

/**
 * Run-preventing infrastructure preflight: reports whether the host has
 * stored credentials, so a missing auth file fails the run before any trial
 * executes instead of failing every trial individually.
 */
export function checkOpenCodeAuth(authPath?: string): {
  path: string;
  authenticated: boolean;
} {
  const path = authPath ?? defaultAuthPath();
  return { path, authenticated: existsSync(path) };
}

/**
 * Containment is opencode tool-level policy, NOT OS-level isolation, and it
 * is identical for every compared variant. The forced denials below close the
 * host's own web/search/external-directory tools and the most destructive
 * bash prefixes, but the bash tool still runs with ordinary user access to
 * the network and host filesystem. Fixture content is exactly the
 * prompt-injection surface eval grades, so the child environment is
 * allowlisted separately by `pickAllowedEnv`: model-controlled bash can read
 * its own process env, and it must not be able to read the host's secrets.
 */
const FORCED_DENIALS = Object.freeze({
  webfetch: "deny",
  websearch: "deny",
  external_directory: "deny",
} as const);

const FORCED_BASH_DENIALS = Object.freeze({
  "rm -rf *": "deny",
  "rm -fr *": "deny",
  "sudo *": "deny",
} as const);

/** Defaults applied when neither the project nor the agent sets a policy. */
const BASELINE_DEFAULTS = Object.freeze({
  edit: "allow",
  read: "allow",
  glob: "allow",
  grep: "allow",
  list: "allow",
  task: "allow",
  skill: "allow",
  lsp: "allow",
  question: "allow",
  todowrite: "allow",
  doom_loop: "allow",
} as const);
const PERMISSION_ACTIONS = new Set(["allow", "deny", "ask"]);

const PERMISSION_KEYS = [
  ...Object.keys(BASELINE_DEFAULTS),
  ...Object.keys(FORCED_DENIALS),
  "bash",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PermissionMap = Record<string, unknown>;

/**
 * Agent-map access restricted to own properties: a native or config agent
 * id like `__proto__` must never read through the prototype or disappear into
 * the prototype setter, or it would silently lose its containment baseline.
 */
function ownAgentEntry(
  agents: Record<string, unknown>,
  name: string,
): Record<string, unknown> | undefined {
  if (!Object.hasOwn(agents, name)) return undefined;
  const value = agents[name];
  return isObject(value) ? value : undefined;
}

function setOwnAgentEntry(
  agents: Record<string, unknown>,
  name: string,
  value: Record<string, unknown>,
): void {
  Object.defineProperty(agents, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/**
 * Merges the permission baseline into one agent's existing block: the agent's
 * own policy wins everywhere except the forced containment denials, which
 * always apply, and the pattern map keeps forced denials on top.
 */
export function mergePermissionBaseline(existing: unknown): PermissionMap {
  const base = isObject(existing) ? existing : {};
  const baseBash = isObject(base.bash) ? base.bash : {};
  const scalarDefault =
    typeof existing === "string" && PERMISSION_ACTIONS.has(existing)
      ? existing
      : "allow";
  const bashDefault =
    typeof base.bash === "string" && PERMISSION_ACTIONS.has(base.bash)
      ? base.bash
      : typeof baseBash["*"] === "string" &&
          PERMISSION_ACTIONS.has(baseBash["*"])
        ? baseBash["*"]
        : scalarDefault;
  const customBash = Object.fromEntries(
    Object.entries(baseBash).filter(
      ([key]) => key !== "*" && !Object.hasOwn(FORCED_BASH_DENIALS, key),
    ),
  );
  return {
    ...Object.fromEntries(
      PERMISSION_KEYS.map((permission) => [permission, scalarDefault]),
    ),
    ...base,
    ...FORCED_DENIALS,
    bash: {
      ...FORCED_BASH_DENIALS,
      "*": bashDefault,
      ...customBash,
    },
  };
}

type HostConfig = Readonly<{
  path: string;
  value: Record<string, unknown>;
}>;

function readHostConfig(projectRoot: string): HostConfig {
  const path =
    openCodeConfigPaths(projectRoot).find(existsSync) ??
    join(projectRoot, "opencode.json");
  if (!existsSync(path)) return { path, value: {} };
  const filename = relative(projectRoot, path).replaceAll("\\", "/");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(
      `could not read ${filename}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  // The existing configuration contract treats JSONC as the serialized
  // format with strict JSON as a subset (`atlante init` parses both
  // filenames with comments and trailing commas allowed), so `eval` must
  // accept the same documents.
  const parsed = parseJsonc(text, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`host configuration ${filename} is malformed`);
  }
  if (!isObject(parsed.value)) {
    throw new Error(`host configuration ${filename} must contain an object`);
  }
  return { path, value: parsed.value };
}

/**
 * The OpenCode host runner: spawns `opencode run` headless against the
 * sandbox, parses the JSON event stream (cumulative tokens, cost, model
 * identifiers), and enforces the in-flight budget (timeout and maxTokens).
 */
export function createOpenCodeRunner(
  options: OpenCodeRunnerOptions,
): HostRunner {
  const { projectRoot } = options;
  const binaryPath = options.binaryPath ?? OPENCODE_BINARY;
  const authPath = options.authPath ?? defaultAuthPath();
  const baseEnv = options.baseEnv ?? process.env;

  return {
    name: "opencode",

    prepareHostIntegration(sandbox, context) {
      // Verify the source publication before authoring any sandbox host state.
      const nativeAgentIds = readNativeAgentIds(projectRoot);
      const hostConfig = readHostConfig(projectRoot);
      const config = hostConfig.value;
      config.$schema = "https://opencode.ai/config.json";

      // A fixture-provided config at any supported precedence path would
      // silently bypass the generated host integration.
      const fixtureConfig = openCodeConfigPaths(sandbox.root)
        .slice(0, -1)
        .find(existsSync);
      if (fixtureConfig) {
        throw new Error(
          `the fixture provides ${relative(sandbox.root, fixtureConfig).replaceAll("\\", "/")}, which OpenCode would prefer over the generated host configuration; remove it from the fixture`,
        );
      }

      // Auth injection: credentials stay with the host; the sandbox data dir
      // is where the redirected XDG_DATA_HOME will look for them.
      const authTarget = join(
        sandbox.stateDir,
        "data",
        "opencode",
        "auth.json",
      );
      if (existsSync(authPath)) {
        mkdirSync(dirname(authTarget), { recursive: true });
        copyFileSync(authPath, authTarget);
      } else {
        throw new Error(
          `opencode authentication not found at ${authPath}; authenticate the host once before running eval`,
        );
      }

      const agents = isObject(config.agent) ? config.agent : {};
      const agentNames = new Set<string>(["build"]);
      if (context.agent) agentNames.add(context.agent);
      if (typeof config.default_agent === "string")
        agentNames.add(config.default_agent);
      for (const name of Object.keys(agents)) agentNames.add(name);
      for (const agent of nativeAgentIds) agentNames.add(agent);
      for (const name of agentNames) {
        const existing = ownAgentEntry(agents, name);
        setOwnAgentEntry(agents, name, {
          ...existing,
          permission: mergePermissionBaseline(existing?.permission),
        });
      }
      config.agent = agents;

      // Safety net for agents without an explicit block; agent-level rules
      // still take precedence where they exist.
      config.permission = mergePermissionBaseline(config.permission);

      mkdirSync(sandbox.root, { recursive: true });
      // Host integration is authoritative: this generated config intentionally
      // replaces the selected project config in the sandbox.
      const target = join(sandbox.root, relative(projectRoot, hostConfig.path));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
    },

    async runTrial(input: RunTrialInput): Promise<TrialRun> {
      const argv = [
        binaryPath,
        "run",
        "--dir",
        input.sandbox.root,
        "--format",
        "json",
        ...(input.agent ? ["--agent", input.agent] : []),
        ...(input.model ? ["--model", input.model] : []),
        input.prompt,
      ];
      // Allowlisted inheritance only: the rest of the host environment
      // (API keys, tokens, shell state) never reaches the child process,
      // whose env the model can read through its bash tool.
      const env: NodeJS.ProcessEnv = {
        ...pickAllowedEnv(baseEnv),
        XDG_CONFIG_HOME: join(input.sandbox.stateDir, "config"),
        XDG_DATA_HOME: join(input.sandbox.stateDir, "data"),
        XDG_CACHE_HOME: join(input.sandbox.stateDir, "cache"),
      };

      const startedAt = Date.now();
      const result = await spawnHost(argv, {
        cwd: input.sandbox.root,
        env,
        timeoutMs: input.timeoutMs,
        maxTokens: input.maxTokens,
      });
      const durationMs = Date.now() - startedAt;

      const trial: TrialRun = { outcome: result.outcome, durationMs };
      if (result.tokens !== undefined) trial.tokens = result.tokens;
      if (result.cost !== undefined) trial.cost = result.cost;
      if (result.model !== undefined) trial.model = result.model;
      if (result.modelVersion !== undefined)
        trial.modelVersion = result.modelVersion;
      if (result.error !== undefined) trial.error = result.error;
      // Fail-open guard: the maxTokens budget only binds when the stream
      // carries usage events. A host that stopped emitting them would
      // otherwise silently disable the budget behind the timeout.
      if (
        result.tokens === undefined &&
        (result.outcome === "completed" || result.outcome === "timeout")
      ) {
        trial.budgetUnmonitored = true;
      }
      return trial;
    },
  };
}

function readNativeAgentIds(projectRoot: string): string[] {
  return readOpenCodeNative(projectRoot)
    .files.filter((file) => file.kind === "agent")
    .map((file) => file.id);
}

type HostStreamResult = {
  outcome: TrialRunOutcome;
  tokens?: number;
  cost?: number;
  model?: string;
  modelVersion?: string;
  error?: string;
};

function tail(text: string): string {
  return text.length > ERROR_OUTPUT_LIMIT
    ? text.slice(-ERROR_OUTPUT_LIMIT)
    : text;
}

/**
 * Spawns the host and consumes its NDJSON event stream. Cumulative usage is
 * taken from the latest usage-bearing event; aborting on timeout or
 * maxTokens kills the whole process group (TERM → grace → KILL).
 */
function spawnHost(
  argv: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    maxTokens: number;
  },
): Promise<HostStreamResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0] ?? "", argv.slice(1), {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (cause) {
      resolve({
        outcome: "infra-error",
        error: `could not spawn the opencode host: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      return;
    }

    let settled = false;
    let aborted: "timeout" | "budget-exceeded" | null = null;
    let tokens: number | undefined;
    let cost: number | undefined;
    let model: string | undefined;
    let modelVersion: string | undefined;
    let stderrText = "";
    let graceTimer: NodeJS.Timeout | undefined;

    const finish = (outcome: TrialRunOutcome, error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(graceTimer);
      resolve({
        outcome,
        ...(tokens !== undefined ? { tokens } : {}),
        ...(cost !== undefined ? { cost } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(modelVersion !== undefined ? { modelVersion } : {}),
        ...(error ? { error } : {}),
      });
    };

    const abort = (kind: "timeout" | "budget-exceeded") => {
      if (aborted) return;
      aborted = kind;
      killTree(child, KILL_GRACE_MS, (timer) => {
        graceTimer = timer;
      });
    };

    const timeoutTimer = setTimeout(() => abort("timeout"), options.timeoutMs);

    child.on("error", (cause) => {
      finish(
        "infra-error",
        `could not run the opencode host: ${cause.message}`,
      );
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString("utf8");
    });

    let lineBuffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      lineBuffer += chunk.toString("utf8");
      let newline = lineBuffer.indexOf("\n");
      while (newline >= 0) {
        const line = lineBuffer.slice(0, newline).trim();
        lineBuffer = lineBuffer.slice(newline + 1);
        if (line.length > 0) consumeEvent(line);
        newline = lineBuffer.indexOf("\n");
      }
    });

    const consumeEvent = (line: string): void => {
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        // Non-JSON output (logs) is not part of the event contract.
        return;
      }
      if (!isObject(event)) return;

      // Budget enforcement is in-flight: compare the latest cumulative count.
      // Real 1.18.x streams nest usage inside the event's `part` object; the
      // top-level shape stays a defensive fallback for other host versions.
      const part = isObject(event.part) ? event.part : undefined;
      const eventTokens =
        (part ? normalizeTokens(part.tokens) : undefined) ??
        normalizeTokens(event.tokens);
      if (eventTokens !== undefined) tokens = eventTokens;
      // Cost is taken as the latest cumulative value: real 1.18.x streams
      // report per-session cumulative cost on step_finish. A host version
      // emitting per-message cost would under-count reported spend — the
      // same trust assumption as the token total above.
      const eventCost =
        (part && typeof part.cost === "number" ? part.cost : undefined) ??
        (typeof event.cost === "number" ? event.cost : undefined);
      if (eventCost !== undefined) cost = eventCost;

      const identifiers = extractModelIdentifiers(event);
      if (model === undefined && identifiers?.provider && identifiers?.model) {
        model = `${identifiers.provider}/${identifiers.model}`;
        modelVersion = identifiers.model;
      }

      if (tokens !== undefined && tokens > options.maxTokens) {
        abort("budget-exceeded");
      }
    };

    child.on("close", (exit) => {
      if (aborted === "timeout") {
        finish("timeout", `trial exceeded ${options.timeoutMs}ms`);
        return;
      }
      if (aborted === "budget-exceeded") {
        finish("budget-exceeded", `trial exceeded ${options.maxTokens} tokens`);
        return;
      }
      if (exit !== 0) {
        finish(
          "infra-error",
          `opencode run exited ${exit}: ${tail(stderrText.trim()) || "no stderr output"}`,
        );
        return;
      }
      finish("completed");
    });
  });
}

/**
 * Normalizes opencode usage shapes: a numeric cumulative total, a
 * precomputed `total` field (real 1.18.x usage objects carry one), or the
 * documented component object (input/output/reasoning/cache read+write).
 */
export function normalizeTokens(tokens: unknown): number | undefined {
  if (typeof tokens === "number" && Number.isFinite(tokens)) return tokens;
  if (!isObject(tokens)) return undefined;
  if (typeof tokens.total === "number" && Number.isFinite(tokens.total)) {
    return tokens.total;
  }
  let sum = 0;
  let seen = false;
  for (const key of ["input", "output", "reasoning"]) {
    const value = tokens[key];
    if (typeof value === "number") {
      sum += value;
      seen = true;
    }
  }
  if (isObject(tokens.cache)) {
    for (const key of ["read", "write"]) {
      const value = tokens.cache[key];
      if (typeof value === "number") {
        sum += value;
        seen = true;
      }
    }
  }
  return seen ? sum : undefined;
}

/** Extracts provider/model identifiers from a session or message event. */
export function extractModelIdentifiers(
  event: Record<string, unknown>,
): { provider?: string; model?: string } | undefined {
  const scopes: Record<string, unknown>[] = [event];
  for (const key of ["info", "message", "part", "data", "properties"]) {
    const nested = event[key];
    if (isObject(nested)) scopes.push(nested);
  }
  for (const scope of scopes) {
    const provider = scope.providerID ?? scope.providerId;
    const model = scope.modelID ?? scope.modelId;
    if (typeof provider === "string" && typeof model === "string") {
      return { provider, model };
    }
  }
  return undefined;
}
