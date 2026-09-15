#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
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
// The trial needs a concrete model: an isolated eval sandbox has no global
// OpenCode config, so V2 hosts have no default model to fall back to. The
// model comes from EVAL_SMOKE_MODEL, or from the `model` field of your
// global OpenCode config. It skips with guidance when the host has no
// stored authentication or no resolvable model. Cold V2 sandboxes can also
// fail a trial while the host's provider routing warms up (an upstream
// console/config fetch that returns 401 during first boot); re-running the
// script usually clears it.
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
// Pinned for the same reason as opencode-smoke.ts: a floating latest would
// turn upstream changes into unreproducible spend. Defaults to the V2 pin;
// OPENCODE_PACKAGE_VERSION=1.18.29 runs the same smoke against the V1 pin.
const OPENCODE_PACKAGE_VERSION =
  process.env.OPENCODE_PACKAGE_VERSION ?? "2.0.3";
const CLI = join(ROOT, "packages", "cli", "dist", "bin", "atlante.js");
const AUTH_PATH = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
  "opencode",
  "auth.json",
);
// V2 stores host credentials in its SQLite database instead of auth.json.
const AUTH_DATABASE_PATH = join(
  process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
  "opencode",
  "opencode.db",
);

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

if (!existsSync(AUTH_PATH) && !existsSync(AUTH_DATABASE_PATH)) {
  console.log(
    `eval smoke skipped: no OpenCode authentication at ${AUTH_PATH} or ${AUTH_DATABASE_PATH}\n` +
      "authenticate the host once (run `opencode` and sign in), then re-run this script",
  );
  process.exit(0);
}

function resolveSmokeModel(): string | undefined {
  const override = process.env.EVAL_SMOKE_MODEL;
  if (override !== undefined && override !== "") return override;
  const configDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const path = join(configDir, "opencode", name);
    if (!existsSync(path)) continue;
    const match = readFileSync(path, "utf8").match(/"model"\s*:\s*"([^"]+)"/);
    if (match) return match[1];
  }
  return undefined;
}

const SMOKE_MODEL = resolveSmokeModel();
if (SMOKE_MODEL === undefined) {
  console.log(
    "eval smoke skipped: no model resolved for the isolated sandbox\n" +
      "set EVAL_SMOKE_MODEL=<provider/model> or a `model` field in your global OpenCode config",
  );
  process.exit(0);
}

const sandbox = await mkdtemp(join(tmpdir(), "atlante-eval-smoke-"));
try {
  assert(
    await Bun.file(CLI).exists(),
    "CLI dist is missing; run bun run build before the smoke test",
  );

  // Install the pinned host. V1 publishes one host-agnostic npm package; V2
  // ships per-platform npm packages behind its official installer, which
  // lands the binary inside the sandbox HOME.
  await Bun.write(
    join(sandbox, "package.json"),
    `${JSON.stringify({
      name: "eval-smoke-host",
      version: "0.0.0",
      private: true,
    })}\n`,
  );
  const major = Number.parseInt(
    OPENCODE_PACKAGE_VERSION.replace(/^opencode\s*v?/, ""),
    10,
  );
  let binDir: string;
  if (major >= 2) {
    const installer = Bun.spawn(
      [
        "bash",
        "-c",
        `curl -fsSL https://opencode.ai/v2/install | bash -s -- --version '${OPENCODE_PACKAGE_VERSION}' --no-modify-path`,
      ],
      {
        cwd: sandbox,
        env: { ...process.env, HOME: join(sandbox, "home") },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const exitCode = await installer.exited;
    assert(
      exitCode === 0,
      `the OpenCode V2 installer exited ${exitCode} for ${OPENCODE_PACKAGE_VERSION}`,
    );
    binDir = join(sandbox, "home", ".opencode", "bin");
  } else {
    await Bun.$`bun add opencode-ai@${OPENCODE_PACKAGE_VERSION}`
      .cwd(sandbox)
      .quiet();
    binDir = join(sandbox, "node_modules", ".bin");
  }
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
