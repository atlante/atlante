import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

async function runEvalSmoke(
  script: string,
  env: NodeJS.ProcessEnv,
): Promise<{ exit: number; output: string }> {
  const child = Bun.spawn(["bun", join(ROOT, "scripts", script)], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exit, output: `${stdout}\n${stderr}` };
}

function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const emptyHome = mkdtempSync(join(tmpdir(), "atlante-smoke-skip-"));
  return {
    PATH: process.env.PATH ?? "",
    HOME: emptyHome,
    XDG_DATA_HOME: join(emptyHome, "data"),
    XDG_CONFIG_HOME: join(emptyHome, "config"),
    ...extra,
  };
}

test("claude-eval-smoke skips with guidance when no authentication is available", async () => {
  const { exit, output } = await runEvalSmoke(
    "claude-eval-smoke.ts",
    isolatedEnv(),
  );
  expect(exit).toBe(0);
  expect(output).toContain("skipped");
  expect(output).toContain("authentication");
  expect(output).not.toContain("passed");
});

test("claude-eval-smoke skips with guidance when no model is set", async () => {
  // Authenticated via env presence alone, but spend stays reviewable: no
  // model means no run. The probe value never reaches the output.
  const { exit, output } = await runEvalSmoke(
    "claude-eval-smoke.ts",
    isolatedEnv({ ANTHROPIC_API_KEY: "test-key-that-must-not-leak" }),
  );
  expect(exit).toBe(0);
  expect(output).toContain("skipped");
  expect(output).toContain("EVAL_SMOKE_MODEL");
  expect(output).not.toContain("test-key-that-must-not-leak");
  expect(output).not.toContain("passed");
});
