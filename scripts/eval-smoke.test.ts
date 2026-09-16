import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("eval-smoke skips with guidance when no authentication is available", async () => {
  const emptyHome = mkdtempSync(join(tmpdir(), "atlante-smoke-skip-"));
  const child = Bun.spawn(["bun", join(ROOT, "scripts", "eval-smoke.ts")], {
    env: {
      PATH: process.env.PATH ?? "",
      HOME: emptyHome,
      XDG_DATA_HOME: join(emptyHome, "data"),
      XDG_CONFIG_HOME: join(emptyHome, "config"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const output = `${stdout}\n${stderr}`;
  expect(exit).toBe(0);
  expect(output).toContain("skipped");
  expect(output).not.toContain("passed");
});
