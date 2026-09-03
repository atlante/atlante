#!/usr/bin/env bun
import { existsSync } from "node:fs";
// Manual eval smoke: runs the real `atlante eval` pipeline end to end —
// native-output verification, sandbox assembly, a headless OpenCode session with
// live credentials, and deterministic grading — against one tiny scenario
// (1 scenario x 1 trial, trivial prompt, tiny budget).
//
// This is a DEVELOPER-ONLY script, intentionally not referenced by CI or
// `full:check`: it downloads the pinned OpenCode host (network) and spends a
// real, authenticated model call. Run it by hand:
//
//   bun run build && bun scripts/eval-smoke.ts
//
// It skips with guidance when the host has no stored authentication.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// Pinned for the same reason as opencode-smoke.ts: a floating latest would
// turn upstream changes into unreproducible spend.
const OPENCODE_PACKAGE_VERSION = "1.18.26";
const CLI = join(ROOT, "packages", "cli", "dist", "bin", "atlante.js");
const AUTH_PATH = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
  "opencode",
  "auth.json",
);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

if (!existsSync(AUTH_PATH)) {
  console.log(
    `eval smoke skipped: no OpenCode authentication at ${AUTH_PATH}\n` +
      "authenticate the host once (run `opencode` and sign in), then re-run this script",
  );
  process.exit(0);
}

const sandbox = await mkdtemp(join(tmpdir(), "atlante-eval-smoke-"));
try {
  assert(
    await Bun.file(CLI).exists(),
    "CLI dist is missing; run bun run build before the smoke test",
  );

  // Install the pinned host and put its binary on PATH for the eval run.
  await Bun.write(
    join(sandbox, "package.json"),
    `${JSON.stringify({
      name: "eval-smoke-host",
      version: "0.0.0",
      private: true,
    })}\n`,
  );
  await Bun.$`bun add opencode-ai@${OPENCODE_PACKAGE_VERSION}`
    .cwd(sandbox)
    .quiet();

  // Author a real eval-enabled project the way `atlante init` would. The pack
  // is a project dependency; the CLI bundles the native materializer and eval
  // reader, so the project does not need a runtime plugin dependency.
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
      name: "eval-smoke-project",
      version: "0.0.0",
      private: true,
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  await Bun.write(
    join(project, "atlante.jsonc"),
    `${JSON.stringify({
      $schema: "https://atlante.sh/schema/v0.1/schema.json",
      extends: "@atlante/pack",
      values: { project: "eval-smoke" },
      agents: {
        reviewer: {
          description: "Reviews changes.",
          identity: "You review.",
          mission: "Find defects.",
        },
      },
      eval: {
        host: "opencode",
        scenarios: "eval/scenarios/*.eval.json",
        budget: {
          trials: 1,
          timeoutMs: 180_000,
          maxSessions: 1,
          maxTokens: 50_000,
        },
      },
    })}\n`,
  );
  await Bun.write(
    join(project, "opencode.json"),
    `${JSON.stringify({
      $schema: "https://opencode.ai/config.json",
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

  const binDir = join(sandbox, "node_modules", ".bin");
  const run = Bun.spawn(["node", CLI, "eval", "--json"], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
    },
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
  console.log("eval smoke passed");
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
