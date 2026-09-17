#!/usr/bin/env bun
// Manual Claude eval smoke: runs the real `atlante eval` pipeline end to
// end — native-output verification, sandbox assembly, a headless Claude Code
// session with live credentials, and deterministic grading — against one tiny
// scenario (1 scenario x 1 trial, trivial prompt, tiny budget).
//
// This is a DEVELOPER-ONLY script, intentionally not referenced by CI or
// `full:check`: it needs the `claude` binary on PATH (network only for the
// install you already did) and spends a real, authenticated model call. Run
// it by hand:
//
//   bun run build && bun scripts/claude-eval-smoke.ts
//
// The trial needs a concrete model so spend stays reviewable: it comes from
// EVAL_SMOKE_MODEL (for example `sonnet` or `haiku`). The script skips with
// guidance when the host has no usable authentication or no model is set. It
// never prints credential values and never claims a live pass when the run
// was skipped.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin", "atlante.js");

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function present(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function flagSet(value: string | undefined): boolean {
  if (!present(value)) return false;
  const normalized = (value as string).trim().toLowerCase();
  return normalized !== "0" && normalized !== "false" && normalized !== "no";
}

/** Credential modes only — values are never printed or asserted on. */
function hasEnvCredentials(env: NodeJS.ProcessEnv): boolean {
  return (
    flagSet(env.CLAUDE_CODE_USE_BEDROCK) ||
    flagSet(env.CLAUDE_CODE_USE_VERTEX) ||
    flagSet(env.CLAUDE_CODE_USE_FOUNDRY) ||
    present(env.ANTHROPIC_AUTH_TOKEN) ||
    present(env.ANTHROPIC_API_KEY) ||
    present(env.CLAUDE_CODE_OAUTH_TOKEN)
  );
}

async function hasSubscriptionLogin(): Promise<boolean> {
  try {
    const probe = Bun.spawn(["claude", "auth", "status", "--json"], {
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([
      new Response(probe.stdout).text(),
      probe.exited,
    ]);
    if (exitCode !== 0) return false;
    return (JSON.parse(stdout) as { loggedIn?: unknown }).loggedIn === true;
  } catch {
    return false;
  }
}

if (!hasEnvCredentials(process.env) && !(await hasSubscriptionLogin())) {
  console.log(
    "claude eval smoke skipped: no Claude Code authentication found\n" +
      "set ANTHROPIC_API_KEY, generate a token with `claude setup-token` " +
      "(CLAUDE_CODE_OAUTH_TOKEN), or run `claude auth login` once, then re-run this script",
  );
  process.exit(0);
}

const SMOKE_MODEL = process.env.EVAL_SMOKE_MODEL;
if (SMOKE_MODEL === undefined || SMOKE_MODEL === "") {
  console.log(
    "claude eval smoke skipped: no model set for the trial\n" +
      "set EVAL_SMOKE_MODEL=<model> (for example `sonnet`) to keep spend reviewable",
  );
  process.exit(0);
}

const sandbox = await mkdtemp(join(tmpdir(), "atlante-claude-eval-smoke-"));
try {
  assert(
    await Bun.file(CLI).exists(),
    "CLI dist is missing; run bun run build before the smoke test",
  );

  // Author a real eval-enabled project the way `atlante init` would. The
  // pack is a project dependency; the CLI bundles the native materializer
  // and eval reader, so the project does not need a runtime plugin
  // dependency. The developer's own `claude` binary runs the trial, so no
  // host is installed here.
  const project = join(sandbox, "project");
  await mkdir(join(project, "node_modules", "@atlante"), { recursive: true });
  await cp(
    join(ROOT, "packages", "pack"),
    join(project, "node_modules", "@atlante", "pack"),
    { recursive: true },
  );
  await Bun.write(
    join(project, "package.json"),
    `${JSON.stringify({
      name: "claude-eval-smoke-project",
      version: "0.0.0",
      private: true,
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  await Bun.write(
    join(project, "atlante.jsonc"),
    `${JSON.stringify({
      $schema: "https://atlante.sh/schema/v0.2/schema.json",
      extends: "@atlante/pack",
      hosts: ["claude-code"],
      values: { project: "claude-eval-smoke" },
      agents: {
        reviewer: {
          description: "Reviews changes.",
          identity: "You review.",
          mission: "Find defects.",
        },
      },
      eval: {
        host: "claude-code",
        scenarios: "eval/scenarios/*.eval.json",
        model: SMOKE_MODEL,
        budget: {
          trials: 1,
          timeoutMs: 180_000,
          maxSessions: 1,
          maxTokens: 50_000,
        },
      },
    })}\n`,
  );
  await mkdir(join(project, "eval", "scenarios"), { recursive: true });
  await Bun.write(
    join(project, "eval", "scenarios", "smoke.eval.json"),
    `${JSON.stringify({
      $schema: "https://atlante.sh/schema/v0.1/eval-scenario.json",
      version: "0.1",
      name: "eval-smoke",
      description: "Manual real-host smoke scenario.",
      task: {
        fixture: "eval/fixtures/empty",
        prompt:
          "Create a file named hello.txt in the current directory whose contents are exactly: hello",
      },
      checks: [{ type: "file-contains", path: "hello.txt", pattern: "hello" }],
    })}\n`,
  );
  await mkdir(join(project, "eval", "fixtures", "empty"), { recursive: true });

  // The eval flow refuses to run without verified native outputs.
  await Bun.$`node ${CLI} build`.cwd(project).quiet();

  const run = Bun.spawn(["node", CLI, "eval", "--json"], {
    cwd: project,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `atlante eval exited ${exitCode}\nstdout: ${stdout.slice(-2000)}\nstderr: ${stderr.slice(-2000)}`,
    );
  }

  const report = JSON.parse(stdout) as {
    runId: string;
    meta: { model?: string; modelVersion?: string };
    scenarios: Record<
      string,
      {
        passRate: number;
        trials: {
          verdict: string;
          durationMs: number;
          tokens?: number;
          cost?: number;
        }[];
      }
    >;
  };
  const scenario = report.scenarios["eval-smoke"];
  assert(scenario !== undefined, "report is missing the smoke scenario");
  const trial = scenario.trials[0];
  assert(trial !== undefined, "report is missing the smoke trial");
  console.log("claude eval smoke passed");
  console.log(`  run:     ${report.runId}`);
  console.log(
    `  model:   ${report.meta.model ?? "unknown"} (${report.meta.modelVersion ?? "unknown version"})`,
  );
  console.log(
    `  verdict: ${trial.verdict} (pass rate ${scenario.passRate * 100}%)`,
  );
  console.log(
    `  usage:   ${trial.tokens ?? "?"} tokens · $${trial.cost?.toFixed(4) ?? "?"} · ${trial.durationMs}ms`,
  );
} finally {
  await rm(sandbox, { recursive: true, force: true });
}
