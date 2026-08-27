import { execFileSync, spawn as spawnProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  canonicalMutationVerdict,
  hashMutationVerdict,
  hashSourceFiles,
  type MutationReport,
  mutationVerdictCounts,
  RESOURCE_SOURCE_ALGORITHM,
  sourceFiles,
} from "./mutation-evidence";
import { acquireMutationCampaign, resolveMutationRoot } from "./mutation-root";

const MUTATION_WORKSPACES = ["schema", "resources", "validator"] as const;
export const MUTATION_PREFLIGHT_REFRESH_ENV =
  "ATLANTE_MUTATION_PREFLIGHT_REFRESH";
type MutationWorkspace = (typeof MUTATION_WORKSPACES)[number];

type Child = {
  exited: Promise<number>;
  kill: (signal?: NodeJS.Signals) => void;
  output?: Promise<{ stdout: string; stderr: string }>;
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

type ChildResult = {
  code: number;
  signal: NodeJS.Signals | null;
  output: string;
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
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    const text = chunk.toString();
    stderr += text;
    process.stderr.write(text);
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
    output: new Promise((resolve) =>
      child.once("close", () => resolve({ stdout, stderr })),
    ),
  };
}

export type VitestCounts = {
  testFiles: { passed: number; failed: number; total: number };
  tests: { passed: number; failed: number; total: number };
};

export function parseVitestCounts(output: string): VitestCounts | undefined {
  const files = output.match(
    /Test Files\s+(?:(\d+) failed\s+\|\s+)?(\d+) passed/,
  );
  const tests = output.match(/Tests\s+(?:(\d+) failed\s+\|\s+)?(\d+) passed/);
  if (!files || !tests) return undefined;
  const fileFailed = Number(files[1] ?? 0);
  const filePassed = Number(files[2]);
  const testFailed = Number(tests[1] ?? 0);
  const testPassed = Number(tests[2]);
  return {
    testFiles: {
      failed: fileFailed,
      passed: filePassed,
      total: fileFailed + filePassed,
    },
    tests: {
      failed: testFailed,
      passed: testPassed,
      total: testFailed + testPassed,
    },
  };
}

export type PreflightRecord = {
  schemaVersion: 1;
  campaignId: string;
  command: "bun run test";
  startedAt: string;
  endedAt: string;
  runtimeMs: number;
  exitCode: number;
  signal: NodeJS.Signals | null;
  status: "passed" | "failed";
  refreshMode: "ordinary" | "stale-source-bootstrap";
  counts?: VitestCounts;
  gitHead: string;
  sourceSha256: string;
  sourceAlgorithm: string;
  configSha256: string;
  toolVersions: { bun: string; node: string; vitest: string; stryker: string };
};

export function mutationPreflightRefreshEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env.ATLANTE_MUTATION_PHASE === "preflight" &&
    env[MUTATION_PREFLIGHT_REFRESH_ENV] === "1"
  );
}

export type CampaignRecord = {
  schemaVersion: 2;
  workspace: MutationWorkspace;
  campaignId: string;
  preflight: { identity: string; sha256: string };
  report: { identity: string; sha256?: string };
  verdict?: {
    identity: string;
    sha256: string;
    counts: ReturnType<typeof mutationVerdictCounts>;
  };
  source: { identity: string; sha256: string };
  config: { identity: string; sha256: string };
  stryker: { startedAt: string; endedAt: string; runtimeMs: number };
  exitCode: number;
  signal: NodeJS.Signals | null;
  gitHead: string;
  toolVersions: PreflightRecord["toolVersions"];
};

export async function writePreflightRecord(
  mutationRoot: string,
  workspace: MutationWorkspace,
  record: PreflightRecord,
): Promise<string> {
  const directory = join(mutationRoot, workspace, "preflight");
  const path = join(directory, `${record.campaignId}.json`);
  const temporary = `${path}.tmp-${process.pid}`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(temporary, path);
  return path;
}

export async function finalizeCampaign(
  mutationRoot: string,
  record: CampaignRecord,
): Promise<string> {
  const preflightPath = resolve(
    mutationRoot,
    record.workspace,
    "preflight",
    `${record.campaignId}.json`,
  );
  const preflightBytes = await readFile(preflightPath);
  if (hashBytes(preflightBytes) !== record.preflight.sha256) {
    throw new Error("mutation campaign preflight digest mismatch");
  }
  const preflight = JSON.parse(
    preflightBytes.toString("utf8"),
  ) as PreflightRecord;
  if (preflight.campaignId !== record.campaignId) {
    throw new Error("mutation campaign preflight linkage mismatch");
  }
  const reportPath = join(mutationRoot, record.workspace, "mutation.json");
  let reportBytes: Buffer | undefined;
  try {
    reportBytes = await readFile(reportPath);
  } catch (error) {
    if (record.exitCode === 0) {
      throw new Error("successful mutation campaign requires a report", {
        cause: error,
      });
    }
  }
  const finalRecord = reportBytes
    ? await finalizeReport(mutationRoot, record, reportBytes)
    : record;
  const directory = join(mutationRoot, record.workspace, "campaign");
  const path = join(directory, `${record.campaignId}.json`);
  const temporary = `${path}.tmp-${process.pid}`;
  await mkdir(directory, { recursive: true });
  await writeFile(
    temporary,
    `${JSON.stringify(finalRecord, null, 2)}\n`,
    "utf8",
  );
  await rename(temporary, path);
  return path;
}

async function finalizeReport(
  mutationRoot: string,
  record: CampaignRecord,
  reportBytes: Buffer,
): Promise<CampaignRecord> {
  const report = JSON.parse(reportBytes.toString("utf8")) as MutationReport;
  const verdict = canonicalMutationVerdict(report);
  const counts = mutationVerdictCounts(verdict);
  const rawReportSha256 = hashBytes(reportBytes);
  const verdictSha256 = hashMutationVerdict(verdict);
  const manifestPath = join(
    mutationRoot,
    record.workspace,
    "verdict",
    `${record.campaignId}.json`,
  );
  await mkdir(join(mutationRoot, record.workspace, "verdict"), {
    recursive: true,
  });
  const temporary = `${manifestPath}.tmp-${process.pid}`;
  await writeFile(
    temporary,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        campaignId: record.campaignId,
        workspace: record.workspace,
        algorithm: "sha256:json(sorted-source-mutantId-status):v1",
        rawReportSha256,
        verdictSha256,
        counts,
        verdict,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await rename(temporary, manifestPath);
  return {
    ...record,
    report: { ...record.report, sha256: rawReportSha256 },
    verdict: {
      identity: `mutation/${record.workspace}/verdict/${record.campaignId}.json`,
      sha256: verdictSha256,
      counts,
    },
  };
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toolVersions(): PreflightRecord["toolVersions"] {
  return {
    bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
    node: execFileSync("node", ["--version"], { encoding: "utf8" }).trim(),
    vitest: "4.1.11",
    stryker: "10.0.0",
  };
}

async function preflightRecord(
  mutationRoot: string,
  workspace: MutationWorkspace,
  campaignId: string,
  startedAt: number,
  endedAt: number,
  exitCode: number,
  signal: NodeJS.Signals | null,
  output: string,
  refreshMode: PreflightRecord["refreshMode"],
): Promise<string> {
  const files = await sourceFiles(".", `packages/${workspace}/src`);
  const config = await readFile("stryker.config.ts");
  const record: PreflightRecord = {
    schemaVersion: 1,
    campaignId,
    command: "bun run test",
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    runtimeMs: endedAt - startedAt,
    exitCode,
    signal,
    status: exitCode === 0 ? "passed" : "failed",
    refreshMode,
    counts: parseVitestCounts(output),
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    sourceSha256: hashSourceFiles(files),
    sourceAlgorithm: RESOURCE_SOURCE_ALGORITHM,
    configSha256: hashSourceFiles([
      { path: "stryker.config.ts", bytes: config },
    ]),
    toolVersions: toolVersions(),
  };
  return writePreflightRecord(mutationRoot, workspace, record);
}

async function runChild(
  argv: string[],
  options: { shell: false; env?: NodeJS.ProcessEnv },
  dependencies: Required<Dependencies>,
): Promise<ChildResult> {
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
    const normalizedCode = !interruption
      ? code
      : interruption === "SIGINT"
        ? 130
        : interruption === "SIGTERM"
          ? 143
          : 129;
    const output = child.output
      ? await child.output
      : { stdout: "", stderr: "" };
    return {
      code: normalizedCode,
      signal: interruption ?? null,
      output: `${output.stdout}\n${output.stderr}`,
    };
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
  const mutationRoot = resolveMutationRoot(process.env.ATLANTE_MUTATION_ROOT);
  const campaignId = randomUUID();
  const preflightStarted = Date.now();
  const preflightEnv = {
    ...process.env,
    ATLANTE_MUTATION_PHASE: "preflight",
    ATLANTE_MUTATION_CAMPAIGN_ID: campaignId,
    [MUTATION_PREFLIGHT_REFRESH_ENV]: "1",
  };
  const preflight = await runChild(
    ["bun", "run", "test"],
    {
      shell: false,
      env: preflightEnv,
    },
    resolved,
  );
  const preflightEnded = Date.now();
  const preflightPath = await preflightRecord(
    mutationRoot,
    workspace,
    campaignId,
    preflightStarted,
    preflightEnded,
    preflight.code,
    preflight.signal,
    preflight.output,
    mutationPreflightRefreshEnabled(preflightEnv)
      ? "stale-source-bootstrap"
      : "ordinary",
  );
  if (preflight.code !== 0) return preflight.code;

  const preflightBytes = await readFile(preflightPath);
  const release = await acquireMutationCampaign(mutationRoot, workspace);
  const strykerStarted = Date.now();
  let stryker: ChildResult;
  try {
    const campaignEnv = { ...process.env };
    delete campaignEnv[MUTATION_PREFLIGHT_REFRESH_ENV];
    stryker = await runChild(
      ["bun", "x", "stryker", "run", "stryker.config.ts"],
      {
        shell: false,
        env: {
          ...campaignEnv,
          ATLANTE_MUTATION_WORKSPACE: workspace,
          ATLANTE_MUTATION_CAMPAIGN_ID: campaignId,
          ATLANTE_MUTATION_PREFLIGHT: preflightPath,
        },
      },
      resolved,
    );
  } finally {
    await release();
  }
  const strykerEnded = Date.now();
  const preflightRecordData = JSON.parse(
    preflightBytes.toString("utf8"),
  ) as PreflightRecord;
  await finalizeCampaign(mutationRoot, {
    schemaVersion: 2,
    workspace,
    campaignId,
    preflight: {
      identity: relative(process.cwd(), preflightPath).split("\\").join("/"),
      sha256: hashBytes(preflightBytes),
    },
    report: {
      identity: `mutation/${workspace}/mutation.json`,
    },
    source: {
      identity: `packages/${workspace}/src/**/*.ts`,
      sha256: preflightRecordData.sourceSha256,
    },
    config: {
      identity: "stryker.config.ts",
      sha256: preflightRecordData.configSha256,
    },
    stryker: {
      startedAt: new Date(strykerStarted).toISOString(),
      endedAt: new Date(strykerEnded).toISOString(),
      runtimeMs: strykerEnded - strykerStarted,
    },
    exitCode: stryker.code,
    signal: stryker.signal,
    gitHead: preflightRecordData.gitHead,
    toolVersions: preflightRecordData.toolVersions,
  });
  return stryker.code;
}

if (import.meta.main) {
  try {
    process.exitCode = await runMutation(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
