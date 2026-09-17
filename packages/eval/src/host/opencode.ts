import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { readOpenCodeNative } from "@atlante/opencode";
import { openCodeConfigPaths } from "@atlante/opencode/config";
import {
  detectOpenCode,
  type OpenCodeDialect,
  type OpenCodeVersionProbe,
  openCodeDialectDescriptor,
} from "@atlante/opencode/dialect";
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
  /** Host V2 database location; default follows OpenCode's resolved path. */
  authDatabasePath?: string;
  /** Base environment for the spawned host; default is process.env. */
  baseEnv?: NodeJS.ProcessEnv;
  /** Injectable version probe for tests; defaults to `${binary} --version`. */
  versionProbe?: OpenCodeVersionProbe;
  /** Injectable V2 database-path probe; defaults to `debug paths db`. */
  databasePathProbe?: OpenCodeDatabasePathProbe;
};

export type OpenCodeDatabasePathProbe = (
  binaryPath: string,
  env: NodeJS.ProcessEnv,
) => string;

export type OpenCodeAuthStatus = Readonly<{
  path: string;
  databasePath: string;
  authenticated: boolean;
}>;

export type OpenCodeHostRunner = HostRunner &
  Readonly<{
    dialect: OpenCodeDialect;
    auth: OpenCodeAuthStatus;
  }>;

function defaultDataDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(dataHome, "opencode");
}

function defaultAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultDataDirectory(env), "auth.json");
}

function defaultAuthDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultDataDirectory(env), "opencode.db");
}

const defaultDatabasePathProbe: OpenCodeDatabasePathProbe = (binaryPath, env) =>
  execFileSync(binaryPath, ["debug", "paths", "db"], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

function databasePathOverride(env: NodeJS.ProcessEnv): string | undefined {
  const configured = env.OPENCODE_DB?.trim();
  if (!configured) return undefined;
  if (configured === ":memory:") return configured;
  return isAbsolute(configured)
    ? configured
    : resolve(defaultDataDirectory(env), configured);
}

function resolveOpenCodeDatabasePath(
  binaryPath: string,
  env: NodeJS.ProcessEnv,
  probe: OpenCodeDatabasePathProbe = defaultDatabasePathProbe,
): string {
  const override = databasePathOverride(env);
  if (override !== undefined) return override;
  try {
    const probed = probe(binaryPath, env).trim();
    if (probed.length > 0 && probed !== ":memory:") {
      return isAbsolute(probed)
        ? probed
        : resolve(defaultDataDirectory(env), probed);
    }
  } catch {
    // Older or test host binaries may not expose `debug paths db`; the stable
    // V2 default remains a safe fallback when no channel-specific path exists.
  }
  return defaultAuthDatabasePath(env);
}

function isolatedAuthDatabasePath(stateDir: string): string {
  return join(stateDir, "data", "opencode", "opencode.db");
}

/**
 * Run-preventing infrastructure preflight: reports whether the host has
 * stored credentials, so missing auth state fails the run before any trial
 * executes instead of failing every trial individually.
 */
export function checkOpenCodeAuth(
  authPath?: string,
  authDatabasePath?: string,
  options: {
    binaryPath?: string;
    env?: NodeJS.ProcessEnv;
    databasePathProbe?: OpenCodeDatabasePathProbe;
    dialect?: OpenCodeDialect;
  } = {},
): OpenCodeAuthStatus {
  const env = options.env ?? process.env;
  const path = authPath ?? defaultAuthPath(env);
  const databasePath =
    authDatabasePath ??
    (options.dialect === "v1"
      ? defaultAuthDatabasePath(env)
      : resolveOpenCodeDatabasePath(
          options.binaryPath ?? OPENCODE_BINARY,
          env,
          options.databasePathProbe,
        ));
  return {
    path,
    databasePath,
    authenticated:
      existsSync(path) ||
      (options.dialect !== "v1" && existsSync(databasePath)),
  };
}

/**
 * Containment is OpenCode tool-level policy, NOT OS-level isolation, and it is
 * identical for every compared variant. The forced denials below close the
 * host's own web/search/external-directory tools and the most destructive
 * shell prefixes, but the shell tool still runs with ordinary user access to
 * the network and host filesystem. Fixture content is exactly the
 * prompt-injection surface eval grades, so the child environment is
 * allowlisted separately by `pickAllowedEnv`.
 */
const FORCED_SHELL_DENIALS = Object.freeze({
  "rm -rf *": "deny",
  "rm -fr *": "deny",
  "sudo *": "deny",
} as const);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setOwnValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
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

type V2PermissionRule = Readonly<{
  action: string;
  resource: string;
  effect: "allow" | "deny" | "ask";
}>;

const V1_READ_POLICY = Object.freeze({
  "*": "allow",
  "*.env": "deny",
  "*.env.*": "deny",
  "*.env.example": "allow",
});

/**
 * V2 stores credentials in SQLite. The database can contain a large session
 * history, so the eval state receives its schema, credential rows, and the
 * migration journal only — never a byte-for-byte copy of the user's
 * database. The helper runs under the invoking runtime: Bun uses its native
 * SQLite API, while Node uses the built-in module with the release-specific
 * experimental flag when required.
 */
const COPY_AUTH_DATABASE_SCRIPT = `
import { chmodSync } from "node:fs";

const isBun = Boolean(process.versions.bun);
const sqlite = await import(isBun ? "bun:sqlite" : "node:sqlite");
const Database = sqlite.Database ?? sqlite.DatabaseSync;

const [sourcePath, targetPath] = process.argv.slice(1);
if (!sourcePath || !targetPath) throw new Error("missing database paths");

const quote = (value) => '"' + value.replaceAll('"', '""') + '"';
const source = new Database(
  sourcePath,
  isBun ? { readonly: true } : { readOnly: true },
);
const target = new Database(targetPath);

try {
  target.exec("PRAGMA foreign_keys = OFF");
  const schema = source
    .prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 WHEN 'trigger' THEN 3 WHEN 'view' THEN 4 ELSE 5 END, name",
    )
    .all();
  for (const entry of schema) target.exec(entry.sql);

  const copyRows = (table, where = "") => {
    const columns = source
      .prepare("PRAGMA table_info(" + quote(table) + ")")
      .all()
      .map((column) => column.name);
    if (columns.length === 0) return;
    const names = columns.map(quote).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const insert = target.prepare(
      "INSERT INTO " + quote(table) + " (" + names + ") VALUES (" + placeholders + ")",
    );
    for (const row of source
      .prepare("SELECT " + names + " FROM " + quote(table) + " " + where)
      .all()) {
      insert.run(...columns.map((column) => row[column]));
    }
  };

  copyRows("migration");
  // OpenCode seeds its new migration table from the legacy drizzle journal
  // when that table is empty, so the journal rows must survive the copy or
  // an already-migrated database would be treated as unmigrated.
  if (
    source
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
      )
      .get()
  ) {
    copyRows("__drizzle_migrations");
  }
  copyRows("credential");
  if (
    source
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv'")
      .get()
  ) {
    copyRows("kv", "WHERE key = 'wellknown:sources'");
  }
  target.exec("PRAGMA foreign_keys = ON");
} finally {
  target.close();
  source.close();
}
chmodSync(targetPath, 0o600);
`;

/** Returns the Node flags needed by the built-in SQLite module for a release. */
export function sqliteRuntimeArguments(nodeVersion = process.versions.node): {
  supported: boolean;
  args: string[];
} {
  const match = nodeVersion.match(/^(\d+)\.(\d+)\./);
  if (!match) return { supported: false, args: [] };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major < 22 || (major === 22 && minor < 5))
    return { supported: false, args: [] };
  const needsFlag = (major === 22 && minor < 13) || (major === 23 && minor < 4);
  return {
    supported: true,
    args: needsFlag ? ["--experimental-sqlite"] : [],
  };
}

function copyOpenCodeAuthDatabase(
  sourcePath: string,
  targetPath: string,
): void {
  if (resolve(sourcePath) === resolve(targetPath)) {
    throw new Error(
      "the OpenCode auth database source and target are identical",
    );
  }
  if (existsSync(targetPath)) {
    throw new Error(
      `the OpenCode auth database target already exists at ${targetPath}`,
    );
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  const bun = Boolean(process.versions.bun);
  const runtime = bun ? undefined : sqliteRuntimeArguments();
  if (runtime !== undefined && !runtime.supported) {
    throw new Error(
      "copying OpenCode V2 authentication requires Node.js 22.5 or newer, or Bun",
    );
  }
  try {
    execFileSync(
      process.execPath,
      [
        ...(runtime?.args ?? []),
        ...(bun ? [] : ["--input-type=module"]),
        "-e",
        COPY_AUTH_DATABASE_SCRIPT,
        sourcePath,
        targetPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (cause) {
    try {
      rmSync(targetPath, { force: true });
    } catch {
      // Preserve the original copy error; the run root is disposable.
    }
    throw new Error(
      `could not copy OpenCode V2 authentication database from ${sourcePath}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { cause },
    );
  }
}

/** Builds the same containment intent in the selected OpenCode dialect. */
export function createEvalPermissionPolicy(
  dialect: OpenCodeDialect,
): Record<string, unknown> | V2PermissionRule[] {
  const descriptor = openCodeDialectDescriptor(dialect);
  if (dialect === "v1") {
    return {
      edit: "allow",
      read: { ...V1_READ_POLICY },
      glob: "allow",
      grep: "allow",
      list: "allow",
      [descriptor.subagentAction]: "allow",
      skill: "allow",
      lsp: "allow",
      // Eval runs are non-interactive; an unanswered question suspends the
      // V2 session and makes the host report a shutdown instead of a verdict.
      question: "deny",
      todowrite: "allow",
      doom_loop: "allow",
      webfetch: "deny",
      websearch: "deny",
      external_directory: "deny",
      [descriptor.shellAction]: {
        "*": "allow",
        ...FORCED_SHELL_DENIALS,
      },
    };
  }

  return [
    { action: "edit", resource: "*", effect: "allow" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "deny" },
    { action: "read", resource: "*.env.*", effect: "deny" },
    { action: "read", resource: "*.env.example", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "grep", resource: "*", effect: "allow" },
    { action: descriptor.subagentAction, resource: "*", effect: "allow" },
    { action: "skill", resource: "*", effect: "allow" },
    // Eval runs are non-interactive; do not leave a host session waiting for
    // an answer that the runner cannot provide.
    { action: "question", resource: "*", effect: "deny" },
    { action: descriptor.shellAction, resource: "*", effect: "allow" },
    { action: "webfetch", resource: "*", effect: "deny" },
    { action: "websearch", resource: "*", effect: "deny" },
    { action: "external_directory", resource: "*", effect: "deny" },
    ...Object.entries(FORCED_SHELL_DENIALS).map(([resource, effect]) => ({
      action: descriptor.shellAction,
      resource,
      effect: effect as "deny",
    })),
  ];
}

function selectedHostConfigPath(projectRoot: string): string {
  return (
    openCodeConfigPaths(projectRoot).find(existsSync) ??
    join(projectRoot, "opencode.jsonc")
  );
}

/**
 * The OpenCode host runner: spawns `opencode run` headless against the
 * sandbox, parses the JSON event stream (cumulative tokens, cost, model
 * identifiers), and enforces the in-flight budget (timeout and maxTokens).
 */
export function createOpenCodeRunner(
  options: OpenCodeRunnerOptions,
): OpenCodeHostRunner {
  const { projectRoot } = options;
  const binaryPath = options.binaryPath ?? OPENCODE_BINARY;
  const baseEnv = options.baseEnv ?? process.env;
  const host = detectOpenCode(binaryPath, options.versionProbe);
  const authPath = options.authPath ?? defaultAuthPath(baseEnv);
  const authDatabasePath =
    options.authDatabasePath ??
    (host.dialect === "v2"
      ? resolveOpenCodeDatabasePath(
          binaryPath,
          baseEnv,
          options.databasePathProbe,
        )
      : defaultAuthDatabasePath(baseEnv));
  const auth = checkOpenCodeAuth(authPath, authDatabasePath, {
    dialect: host.dialect,
  });

  return {
    name: "opencode",
    ownedDirectory: ".opencode/",
    dialect: host.dialect,
    auth,

    prepareHostIntegration(sandbox, context) {
      // Verify the source publication before authoring any sandbox host state.
      const nativeAgentIds = readNativeAgentIds(projectRoot);
      const hostConfigPath = selectedHostConfigPath(projectRoot);

      // The generated file may replace a fixture file at its exact target,
      // but every other supported config path would remain visible to
      // OpenCode and could reintroduce project or fixture MCP settings.
      const target = join(sandbox.root, relative(projectRoot, hostConfigPath));
      const fixtureConfig = openCodeConfigPaths(sandbox.root)
        .filter((path) => path !== target)
        .find(existsSync);
      if (fixtureConfig) {
        throw new Error(
          `the fixture provides ${relative(sandbox.root, fixtureConfig).replaceAll("\\", "/")}, which OpenCode would prefer over the generated host configuration; remove it from the fixture`,
        );
      }

      // Auth injection: credentials stay with the host; the sandbox data dir
      // is where the redirected XDG_DATA_HOME will look for them. V2 moved
      // active credentials into SQLite, so copy only its auth tables rather
      // than exposing the user's session history to the trial.
      const authTarget = join(
        sandbox.stateDir,
        "data",
        "opencode",
        "auth.json",
      );
      const authDatabaseTarget = isolatedAuthDatabasePath(sandbox.stateDir);
      let hasAuth = false;
      if (existsSync(authPath)) {
        mkdirSync(dirname(authTarget), { recursive: true });
        copyFileSync(authPath, authTarget);
        chmodSync(authTarget, 0o600);
        hasAuth = true;
      }

      let hasAuthDatabase = false;
      if (host.dialect === "v2" && existsSync(authDatabasePath)) {
        copyOpenCodeAuthDatabase(authDatabasePath, authDatabaseTarget);
        hasAuthDatabase = true;
      }

      if (!hasAuth && !hasAuthDatabase) {
        const source =
          host.dialect === "v2"
            ? `${authPath} or ${authDatabasePath}`
            : authPath;
        throw new Error(
          `opencode authentication not found at ${source}; authenticate the host once before running eval`,
        );
      } else {
        // The database copy creates this directory itself. Keep the explicit
        // mkdir for auth.json-only V2 installs, where OpenCode performs its
        // own legacy migration on startup.
        mkdirSync(dirname(authTarget), { recursive: true });
      }

      const descriptor = openCodeDialectDescriptor(host.dialect);
      const policy = createEvalPermissionPolicy(host.dialect);
      const agentNames = new Set<string>(["build"]);
      if (context.agent) agentNames.add(context.agent);
      for (const agent of nativeAgentIds) agentNames.add(agent);
      const agents: Record<string, unknown> = {};
      for (const name of agentNames) {
        setOwnAgentEntry(agents, name, {
          [descriptor.permissionsKey]: createEvalPermissionPolicy(host.dialect),
        });
      }
      const config: Record<string, unknown> = {
        $schema: "https://opencode.ai/config.json",
        default_agent: "build",
      };
      setOwnValue(config, descriptor.permissionsKey, policy);
      setOwnValue(config, descriptor.agentsKey, agents);

      mkdirSync(sandbox.root, { recursive: true });
      // Host integration is authoritative: this generated config intentionally
      // replaces the selected project config in the sandbox.
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
    },

    async runTrial(input: RunTrialInput): Promise<TrialRun> {
      const argv = [
        binaryPath,
        "run",
        ...(host.dialect === "v2" ? ["--standalone"] : []),
        "--format",
        "json",
        "--agent",
        input.agent ?? "build",
        ...(input.model ? ["--model", input.model] : []),
        input.prompt,
      ];
      // Allowlisted inheritance only: the rest of the host environment
      // (API keys, tokens, shell state) never reaches the child process,
      // whose env the model can read through its bash tool.
      const env: NodeJS.ProcessEnv = {
        ...pickAllowedEnv(baseEnv),
        HOME: join(input.sandbox.stateDir, "home"),
        XDG_CONFIG_HOME: join(input.sandbox.stateDir, "config"),
        XDG_DATA_HOME: join(input.sandbox.stateDir, "data"),
        XDG_CACHE_HOME: join(input.sandbox.stateDir, "cache"),
        XDG_STATE_HOME: join(input.sandbox.stateDir, "state"),
        ...(host.dialect === "v2"
          ? { OPENCODE_DB: isolatedAuthDatabasePath(input.sandbox.stateDir) }
          : {}),
      };
      for (const directory of [
        env.HOME,
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
 * Spawns the host and consumes its NDJSON event stream. Usage from each
 * processing step is accumulated; aborting on timeout or maxTokens kills the
 * whole process group (TERM → grace → KILL).
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
    let stepTokens = 0;
    let stepUsageSeen = false;
    let latestNonStepTokens: number | undefined;
    let cost: number | undefined;
    let stepCost = 0;
    let stepCostSeen = false;
    let latestNonStepCost: number | undefined;
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

      const eventError = extractHostError(event);
      if (eventError !== undefined) hostError = eventError;

      // Budget enforcement is in-flight: compare the latest cumulative count.
      // Real 1.18.x streams nest usage inside the event's `part` object; the
      // top-level shape stays a defensive fallback for other host versions.
      const part = isObject(event.part) ? event.part : undefined;
      const eventTokens =
        (part ? normalizeTokens(part.tokens) : undefined) ??
        normalizeTokens(event.tokens);
      const isStepFinish =
        event.type === "step_finish" || event.type === "step-finish";
      if (eventTokens !== undefined) {
        if (isStepFinish) {
          stepTokens += eventTokens;
          stepUsageSeen = true;
          tokens = stepTokens;
        } else if (!stepUsageSeen) {
          latestNonStepTokens = eventTokens;
          tokens = latestNonStepTokens;
        }
      }
      // V1 and V2 report one cost for each processing step. Aggregate those
      // values; non-step usage objects are treated as already cumulative and
      // remain a defensive fallback for other host versions.
      const eventCost =
        (part && typeof part.cost === "number" ? part.cost : undefined) ??
        (typeof event.cost === "number" ? event.cost : undefined);
      if (eventCost !== undefined) {
        if (isStepFinish) {
          stepCost += eventCost;
          stepCostSeen = true;
          cost = stepCost;
        } else if (!stepCostSeen) {
          latestNonStepCost = eventCost;
          cost = latestNonStepCost;
        }
      }

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
          `opencode run exited ${exit}: ${hostError ?? (tail(stderrText.trim()) || "no stderr output")}`,
        );
        return;
      }
      finish("completed");
    });
  });
}

const SAFE_ERROR_NAMES = new Set([
  "APIError",
  "AuthenticationError",
  "Error",
  "NetworkError",
  "TimeoutError",
]);

const HTTP_ERROR_REASONS = new Map<number, string>([
  [400, "bad request"],
  [401, "authentication failed"],
  [403, "permission denied"],
  [404, "not found"],
  [408, "request timed out"],
  [429, "rate limited"],
  [500, "host service error"],
  [502, "host service error"],
  [503, "host service unavailable"],
  [504, "host service timed out"],
]);

/** Extracts only bounded, allowlisted summary fields from a host error event. */
function extractHostError(event: Record<string, unknown>): string | undefined {
  if (event.type !== "error" || !isObject(event.error)) return undefined;
  const value = event.error;
  const data = isObject(value.data) ? value.data : undefined;
  const name = safeErrorName(value.name);
  const statusCode = errorStatusCode(value, data);
  const reason = errorReason(statusCode);
  const summary = [
    name,
    reason,
    statusCode === undefined ? undefined : `status ${statusCode}`,
  ].filter((part): part is string => part !== undefined);
  return summary.length > 0 ? boundedErrorText(summary.join(": ")) : undefined;
}

function safeErrorName(value: unknown): string | undefined {
  const name = stringValue(value);
  return name !== undefined && SAFE_ERROR_NAMES.has(name) ? name : undefined;
}

function isHttpStatusCode(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
  );
}

function errorStatusCode(
  value: Record<string, unknown>,
  data: Record<string, unknown> | undefined,
): number | undefined {
  if (isHttpStatusCode(value.statusCode)) return value.statusCode;
  return data !== undefined && isHttpStatusCode(data.statusCode)
    ? data.statusCode
    : undefined;
}

function errorReason(statusCode: number | undefined): string | undefined {
  return statusCode === undefined
    ? undefined
    : (HTTP_ERROR_REASONS.get(statusCode) ?? "host request failed");
}

function boundedErrorText(value: string): string {
  return value.length > ERROR_OUTPUT_LIMIT
    ? `${value.slice(0, ERROR_OUTPUT_LIMIT)}… truncated`
    : value;
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

const MODEL_CONTAINER_KEYS = new Set(["model", "modelInfo", "modelRef"]);

function modelReference(
  value: string,
): { provider: string; model: string } | undefined {
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return {
    provider: value.slice(0, separator),
    model: value.slice(separator + 1),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Extracts provider/model identifiers from a session or message event. */
export function extractModelIdentifiers(
  event: Record<string, unknown>,
): { provider?: string; model?: string } | undefined {
  const visited = new Set<object>();

  const visit = (
    value: unknown,
    key?: string,
  ): { provider: string; model: string } | undefined => {
    if (typeof value === "string") {
      return MODEL_CONTAINER_KEYS.has(key ?? "")
        ? modelReference(value)
        : undefined;
    }
    if (typeof value !== "object" || value === null) return undefined;
    if (visited.has(value)) return undefined;
    visited.add(value);

    if (isObject(value)) {
      const provider =
        stringValue(value.providerID) ?? stringValue(value.providerId);
      const model = stringValue(value.modelID) ?? stringValue(value.modelId);
      if (provider && model) return { provider, model };
      if (provider && typeof value.model === "string") {
        const reference = modelReference(value.model);
        return {
          provider: reference?.provider ?? provider,
          model: reference?.model ?? value.model,
        };
      }
      if (provider && MODEL_CONTAINER_KEYS.has(key ?? "")) {
        const id = stringValue(value.id);
        if (id) return { provider, model: id };
      }
    }

    const children = Array.isArray(value)
      ? value.map((child, index) => [String(index), child] as const)
      : Object.entries(value);
    // Model containers are the most precise shape and should win over an
    // unrelated nested session/message id when both are present.
    for (const [childKey, child] of children) {
      if (!MODEL_CONTAINER_KEYS.has(childKey)) continue;
      const result = visit(child, childKey);
      if (result) return result;
    }
    for (const [childKey, child] of children) {
      if (MODEL_CONTAINER_KEYS.has(childKey)) continue;
      const result = visit(child, childKey);
      if (result) return result;
    }
    return undefined;
  };

  const result = visit(event);
  if (result) return result;
  return undefined;
}

function modelVersionFromReference(reference: string): string {
  const model = reference.split("/").slice(1).join("/") || reference;
  return model.split("#", 1)[0] ?? model;
}
