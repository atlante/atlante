import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

test("CLI build no longer copies the removed bundled resource tree", () => {
  const build = readFileSync(join(ROOT, "scripts", "build.ts"), "utf8");
  const cliManifest = readFileSync(
    join(ROOT, "packages", "cli", "package.json"),
    "utf8",
  );
  const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");

  expect(build).not.toContain("packages/resources/bundled");
  expect(build).not.toContain('join(cli, "bundled")');
  expect(cliManifest).not.toContain('"bundled"');
  expect(gitignore).not.toContain("packages/cli/bundled/");
});

test("CLI dry-run package contains no bundled resource files", {
  timeout: 30_000,
}, async () => {
  const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: join(ROOT, "packages", "cli"),
    encoding: "utf8",
  });

  const report = JSON.parse(stdout) as Array<{
    files: Array<{ path: string }>;
  }>;
  const files = report[0]?.files.map(({ path }) => path) ?? [];
  expect(files.some((file) => file.startsWith("bundled/"))).toBe(false);
});
