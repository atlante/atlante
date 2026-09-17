import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { readClaudeCodeNative } from "@atlante/claude-code";
import type {
  HostRunner,
  RunTrialInput,
  TrialRun,
  TrialRunOutcome,
} from "../runner.js";
import { killTree, pickAllowedEnv } from "../spawn.js";

export const CLAUDE_BINARY = "claude";
/** Grace window for the SIGTERM → SIGKILL escalation. */
const KILL_GRACE_MS = 5_000;
const ERROR_OUTPUT_LIMIT = 2_000;

export type ClaudeVersion = Readonly<{
  major: number;
  minor: number;
  patch: number;
  raw: string;
}>;

export type ClaudeVersionErrorCode =
  | "binary-unavailable"
  | "invalid-version"
  | "unsupported-version";

export class ClaudeVersionError extends Error {
  readonly code: ClaudeVersionErrorCode;
  readonly binaryPath?: string;
  readonly version?: ClaudeVersion;

  constructor(
    code: ClaudeVersionErrorCode,
    message: string,
    options: {
      binaryPath?: string;
      cause?: unknown;
      version?: ClaudeVersion;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ClaudeVersionError";
    this.code = code;
    this.binaryPath = options.binaryPath;
    this.version = options.version;
  }
}

export type ClaudeVersionProbe = (binaryPath: string) => string;

/** Parses output such as `2.1.218 (Claude Code)` or a bare semantic version. */
export function parseClaudeVersion(output: string): ClaudeVersion {
  const raw = output.trim();
  const match = raw.match(
    /(?:^|\s)v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:$|\s)/,
  );
  if (!match) {
    throw new ClaudeVersionError(
      "invalid-version",
      `could not determine a stable Claude Code version from: ${raw || "empty output"}`,
    );
  }

  const versionText = match[1];
  if (versionText === undefined) {
    throw new ClaudeVersionError(
      "invalid-version",
      `could not determine a stable Claude Code version from: ${raw || "empty output"}`,
    );
  }
  const components = versionText.split(".");
  const major = Number(components[0]);
  const minor = Number(components[1]);
  const patch = Number(components[2]);
  if (
    !Number.isSafeInteger(major) ||
    !Number.isSafeInteger(minor) ||
    !Number.isSafeInteger(patch)
  ) {
    throw new ClaudeVersionError(
      "invalid-version",
      `could not determine a stable Claude Code version from: ${raw || "empty output"}`,
    );
  }

  return { major, minor, patch, raw };
}

const defaultVersionProbe: ClaudeVersionProbe = (binaryPath) =>
  execFileSync(binaryPath, ["--version"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

/**
 * Resolves the supported Claude Code line. Only the 2.x line is admitted;
 * a future major establishes a new contract after validating the flow.
 */
function resolveClaudeVersion(version: ClaudeVersion): void {
  if (version.major === 2) return;
  throw new ClaudeVersionError(
    "unsupported-version",
    `unsupported Claude Code version ${version.raw}; supported versions are >=2.0.0 <3.0.0`,
    { version },
  );
}

/** Detects the host version through one `--version` invocation. */
function detectClaude(
  binaryPath = CLAUDE_BINARY,
  probe: ClaudeVersionProbe = defaultVersionProbe,
): { version: ClaudeVersion } {
  let output: string;
  try {
    output = probe(binaryPath);
  } catch (cause) {
    throw new ClaudeVersionError(
      "binary-unavailable",
      `could not run ${binaryPath} --version`,
      { binaryPath, cause },
    );
  }

  let version: ClaudeVersion;
  try {
    version = parseClaudeVersion(output);
  } catch (cause) {
    if (cause instanceof ClaudeVersionError) {
      throw new ClaudeVersionError(
        cause.code,
        `${cause.message} (${binaryPath})`,
        { binaryPath, cause },
      );
    }
    throw cause;
  }

  try {
    resolveClaudeVersion(version);
  } catch (cause) {
    if (cause instanceof ClaudeVersionError) {
      throw new ClaudeVersionError(
        cause.code,
        `${cause.message} (${binaryPath})`,
        { binaryPath, cause, version },
      );
    }
    throw cause;
  }
  return { version };
}

export type ClaudeAuthMethod =
  | "api-key"
  | "oauth"
  | "bedrock"
  | "vertex"
  | "foundry"
  | "auth-status"
  | "none";

export type ClaudeAuthStatus = Readonly<{
  authenticated: boolean;
  method: ClaudeAuthMethod;
}>;

export type ClaudeAuthStatusProbe = () => { loggedIn: boolean };

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function flagSet(value: string | undefined): boolean {
  if (!present(value)) return false;
  const normalized = (value as string).trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "no";
}

/**
 * Run-preventing infrastructure preflight: reports whether the host has
 * usable credentials, so missing auth fails the run before any trial
 * executes instead of failing every trial individually. Only the credential
 * mode is reported — never secret values.
 *
 * Precedence follows the host documentation: cloud-provider flags, bearer or
 * API key env, OAuth token env, then the host's own auth status.
 */
export function checkClaudeAuth(
  env: NodeJS.ProcessEnv = process.env,
  options: { authStatusProbe?: ClaudeAuthStatusProbe } = {},
): ClaudeAuthStatus {
  if (flagSet(env.CLAUDE_CODE_USE_BEDROCK))
    return { authenticated: true, method: "bedrock" };
  if (flagSet(env.CLAUDE_CODE_USE_VERTEX))
    return { authenticated: true, method: "vertex" };
  if (flagSet(env.CLAUDE_CODE_USE_FOUNDRY))
    return { authenticated: true, method: "foundry" };
  if (present(env.ANTHROPIC_AUTH_TOKEN) || present(env.ANTHROPIC_API_KEY))
    return { authenticated: true, method: "api-key" };
  if (present(env.CLAUDE_CODE_OAUTH_TOKEN))
    return { authenticated: true, method: "oauth" };
  try {
    if (options.authStatusProbe?.().loggedIn === true)
      return { authenticated: true, method: "auth-status" };
  } catch {
    // A failing probe means no usable subscription login.
  }
  return { authenticated: false, method: "none" };
}

function defaultAuthStatusProbe(
  binaryPath: string,
  env: NodeJS.ProcessEnv,
): ClaudeAuthStatusProbe {
  return () => {
    try {
      const output = execFileSync(binaryPath, ["auth", "status", "--json"], {
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return {
        loggedIn:
          (JSON.parse(output) as { loggedIn?: unknown }).loggedIn === true,
      };
    } catch {
      return { loggedIn: false };
    }
  };
}

export type ClaudeRunnerOptions = {
  projectRoot: string;
  /** Host binary; default resolves `claude` from PATH. */
  binaryPath?: string;
  /** Base environment for probes and the spawned host; default is process.env. */
  baseEnv?: NodeJS.ProcessEnv;
  /** Injectable version probe for tests; defaults to `${binary} --version`. */
  versionProbe?: ClaudeVersionProbe;
  /** Injectable auth-status probe for tests; defaults to `auth status --json`. */
  authStatusProbe?: ClaudeAuthStatusProbe;
  /** Host credentials file location; default follows the host config dir. */
  credentialsPath?: string;
};

export type ClaudeHostRunner = HostRunner &
  Readonly<{
    version: ClaudeVersion;
    auth: ClaudeAuthStatus;
  }>;

function homeDir(env: NodeJS.ProcessEnv): string {
  return env.HOME ?? homedir();
}

function defaultCredentialsPath(env: NodeJS.ProcessEnv): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim();
  if (configDir) return join(configDir, ".credentials.json");
  return join(homeDir(env), ".claude", ".credentials.json");
}

/**
 * Containment is host tool-level policy, NOT OS-level isolation, and it is
 * identical for every compared variant. The denies below close the host's
 * own web tools, interactive questions, and the most destructive shell
 * prefixes, while the allow list keeps file and shell work usable
 * non-interactively. Fixture content is exactly the prompt-injection surface
 * eval grades, so the child environment is allowlisted separately by
 * `pickAllowedEnv` plus the auth-only additions below.
 */
const CLAUDE_ALLOW_POLICY = Object.freeze([
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash",
  "Skill",
  "Agent",
]);

const CLAUDE_DENY_POLICY = Object.freeze([
  "Bash(rm -rf *)",
  "Bash(rm -fr *)",
  "Bash(sudo *)",
  "WebFetch",
  "WebSearch",
  "AskUserQuestion",
]);

/** Auth-only env additions for the spawned host; values are never logged. */
const CLAUDE_AUTH_ENV_KEYS = Object.freeze([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const);

function pickClaudeAuthEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const picked: NodeJS.ProcessEnv = {};
  for (const key of CLAUDE_AUTH_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

/**
 * The Claude Code host runner: spawns `claude -p` headless against the
 * sandbox, parses the stream-json event stream (usage, cost, model
 * identifiers), and enforces the in-flight budget (timeout and maxTokens).
 */
export function createClaudeRunner(
  options: ClaudeRunnerOptions,
): ClaudeHostRunner {
  const { projectRoot } = options;
  const binaryPath = options.binaryPath ?? CLAUDE_BINARY;
  const baseEnv = options.baseEnv ?? process.env;
  const { version } = detectClaude(binaryPath, options.versionProbe);
  const auth = checkClaudeAuth(baseEnv, {
    authStatusProbe:
      options.authStatusProbe ?? defaultAuthStatusProbe(binaryPath, baseEnv),
  });
  const credentialsPath =
    options.credentialsPath ?? defaultCredentialsPath(baseEnv);

  return {
    name: "claude-code",
    version,
    auth,

    prepareHostIntegration(sandbox, _context) {
      // Verify the source publication before authoring any sandbox host state.
      readClaudeCodeNative(projectRoot);

      // The generated settings are authoritative: fixture MCP or settings
      // would merge with them and could reintroduce project tooling.
      if (existsSync(join(sandbox.root, ".mcp.json"))) {
        throw new Error(
          "the fixture provides .mcp.json, which Claude Code would load alongside the generated host configuration; remove it from the fixture",
        );
      }
      for (const file of ["settings.json", "settings.local.json"]) {
        if (existsSync(join(sandbox.root, ".claude", file))) {
          throw new Error(
            `the fixture provides .claude/${file}, which Claude Code would merge with the generated host configuration; remove it from the fixture`,
          );
        }
      }

      if (!auth.authenticated) {
        throw new Error(
          "claude-code authentication not found; set ANTHROPIC_API_KEY, generate a token with `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN), or run `claude auth login` once before running eval",
        );
      }

      // Auth injection: credentials stay with the host; the sandbox config
      // dir is where the redirected CLAUDE_CONFIG_DIR will look for them.
      // Only the credentials file is copied — never session history or
      // unrelated user configuration.
      if (existsSync(credentialsPath)) {
        const target = join(
          sandbox.stateDir,
          "claude-config",
          ".credentials.json",
        );
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(credentialsPath, target);
        chmodSync(target, 0o600);
      }

      const settings = {
        permissions: {
          allow: [...CLAUDE_ALLOW_POLICY],
          deny: [...CLAUDE_DENY_POLICY],
        },
      };
      const target = join(sandbox.root, ".claude", "settings.json");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(settings, null, 2)}\n`);

      // Workspace trust: the host ignores allow entries from settings files
      // in an untrusted workspace and exits before any model call. The
      // acceptance is pre-authored in the redirected config dir and trusts
      // only the ephemeral sandbox root — never the real project or home.
      // The host resolves symlinks before the lookup (e.g. macOS
      // /var→/private/var), so the key must be the real path.
      const trust = {
        projects: {
          [realpathSync(sandbox.root)]: { hasTrustDialogAccepted: true },
        },
      };
      const trustTarget = join(
        sandbox.stateDir,
        "claude-config",
        ".claude.json",
      );
      mkdirSync(dirname(trustTarget), { recursive: true });
      writeFileSync(trustTarget, `${JSON.stringify(trust, null, 2)}\n`);
    },

    async runTrial(input: RunTrialInput): Promise<TrialRun> {
      const argv = [
        binaryPath,
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--setting-sources",
        "project",
        ...(input.agent ? ["--agent", input.agent] : []),
        ...(input.model ? ["--model", input.model] : []),
        input.prompt,
      ];
      // Allowlisted inheritance only: the rest of the host environment
      // (tokens, shell state) never reaches the child process, whose env
      // the model can read through its bash tool. Auth credentials travel
      // explicitly; everything else stays with the host.
      const stateConfigDir = join(input.sandbox.stateDir, "claude-config");
      const env: NodeJS.ProcessEnv = {
        ...pickAllowedEnv(baseEnv),
        ...pickClaudeAuthEnv(baseEnv),
        HOME: join(input.sandbox.stateDir, "home"),
        CLAUDE_CONFIG_DIR: stateConfigDir,
        XDG_CONFIG_HOME: join(input.sandbox.stateDir, "config"),
        XDG_DATA_HOME: join(input.sandbox.stateDir, "data"),
        XDG_CACHE_HOME: join(input.sandbox.stateDir, "cache"),
        XDG_STATE_HOME: join(input.sandbox.stateDir, "state"),
      };
      for (const directory of [
        env.HOME,
        stateConfigDir,
        env.XDG_CONFIG_HOME,
        env.XDG_DATA_HOME,
        env.XDG_CACHE_HOME,
        env.XDG_STATE_HOME,
      ]) {
        if (directory !== undefined) mkdirSync(directory, { recursive: true });
      }

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
      const model = result.model ?? input.model;
      if (model !== undefined) trial.model = model;
      const modelVersion =
        result.modelVersion ??
        (input.model !== undefined
          ? modelVersionFromReference(input.model)
          : undefined);
      if (modelVersion !== undefined) trial.modelVersion = modelVersion;
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
 * Spawns the host and consumes its stream-json event stream. Usage from the
 * latest event wins (the `result` event carries run totals); aborting on
 * timeout or maxTokens kills the whole process group (TERM → grace → KILL).
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
        error: `could not spawn the claude-code host: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
      return;
    }

    let settled = false;
    let aborted: "timeout" | "budget-exceeded" | null = null;
    let tokens: number | undefined;
    let cost: number | undefined;
    let model: string | undefined;
    let modelVersion: string | undefined;
    let hostError: string | undefined;
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
        `could not run the claude-code host: ${cause.message}`,
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

      const eventError = extractHostError(event);
      if (eventError !== undefined) hostError = eventError;

      // Budget enforcement is in-flight: the latest usage object carries
      // the run totals (the trailing `result` event is authoritative).
      const eventTokens = extractUsageTokens(event);
      if (eventTokens !== undefined) {
        tokens = eventTokens;
      }
      const eventCost = extractCost(event);
      if (eventCost !== undefined) {
        cost = eventCost;
      }

      if (model === undefined) {
        const identifier = extractModelIdentifier(event);
        if (identifier !== undefined) {
          model = identifier;
          modelVersion = modelVersionFromReference(identifier);
        }
      }

      if (tokens !== undefined && tokens > options.maxTokens) {
        abort("budget-exceeded");
      }
    };

    child.on("close", (exit) => {
      const trailingLine = lineBuffer.trim();
      if (trailingLine.length > 0) consumeEvent(trailingLine);
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
          `claude run exited ${exit}: ${hostError ?? (tail(stderrText.trim()) || "no stderr output")}`,
        );
        return;
      }
      if (hostError !== undefined) {
        finish("infra-error", hostError);
        return;
      }
      finish("completed");
    });
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extracts only a bounded failure summary from a host result event. */
function extractHostError(event: Record<string, unknown>): string | undefined {
  if (event.type !== "result") return undefined;
  const subtype =
    typeof event.subtype === "string" && event.subtype.length > 0
      ? event.subtype
      : undefined;
  if (subtype === undefined || subtype === "success") return undefined;
  const detail =
    typeof event.error === "string" && event.error.length > 0
      ? `: ${event.error}`
      : typeof event.message === "string" && event.message.length > 0
        ? `: ${event.message}`
        : "";
  return boundedErrorText(`claude run ${subtype}${detail}`);
}

function boundedErrorText(value: string): string {
  return value.length > ERROR_OUTPUT_LIMIT
    ? `${value.slice(0, ERROR_OUTPUT_LIMIT)}… truncated`
    : value;
}

function nestedCandidates(event: Record<string, unknown>): unknown[] {
  const candidates: unknown[] = [event];
  for (const key of ["message", "result"]) {
    const nested = event[key];
    if (isObject(nested)) candidates.push(nested);
  }
  return candidates;
}

/** Finds the first usage object in the event and normalizes it to a total. */
function extractUsageTokens(
  event: Record<string, unknown>,
): number | undefined {
  for (const candidate of nestedCandidates(event)) {
    if (!isObject(candidate)) continue;
    const usage = candidate.usage;
    if (usage === undefined) continue;
    const normalized = normalizeClaudeUsage(usage);
    if (normalized !== undefined) return normalized;
  }
  return undefined;
}

/** Finds the run cost (`total_cost_usd`) in the event. */
function extractCost(event: Record<string, unknown>): number | undefined {
  for (const candidate of nestedCandidates(event)) {
    if (!isObject(candidate)) continue;
    for (const key of ["total_cost_usd", "totalCostUsd", "cost"]) {
      const value = candidate[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

/** Extracts the model identifier from init, message, or result events. */
function extractModelIdentifier(
  event: Record<string, unknown>,
): string | undefined {
  for (const candidate of nestedCandidates(event)) {
    if (!isObject(candidate)) continue;
    const value = candidate.model;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Normalizes Claude usage shapes: a numeric total, underscore token fields
 * (`input_tokens`, `output_tokens`, cache fields), or the component object
 * (`input`/`output`/`reasoning` plus cache read/write).
 */
export function normalizeClaudeUsage(usage: unknown): number | undefined {
  if (typeof usage === "number" && Number.isFinite(usage)) return usage;
  if (!isObject(usage)) return undefined;
  if (typeof usage.total === "number" && Number.isFinite(usage.total)) {
    return usage.total;
  }
  let sum = 0;
  let seen = false;
  for (const key of [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ]) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      seen = true;
    }
  }
  if (seen) return sum;
  for (const key of ["input", "output", "reasoning"]) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      sum += value;
      seen = true;
    }
  }
  if (isObject(usage.cache)) {
    for (const key of ["read", "write"]) {
      const value = usage.cache[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        sum += value;
        seen = true;
      }
    }
  }
  return seen ? sum : undefined;
}

function modelVersionFromReference(reference: string): string {
  const model = reference.split("/").slice(1).join("/") || reference;
  return model.split("#", 1)[0] ?? model;
}
