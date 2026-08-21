import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

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

test("CLI dry-run package contains no bundled resource files", async () => {
  const result = await Bun.$`npm pack --dry-run --json`
    .cwd(join(ROOT, "packages", "cli"))
    .quiet()
    .nothrow();
  expect(result.exitCode).toBe(0);

  const report = JSON.parse(result.stdout.toString()) as Array<{
    files: Array<{ path: string }>;
  }>;
  const files = report[0]?.files.map(({ path }) => path) ?? [];
  expect(files.some((file) => file.startsWith("bundled/"))).toBe(false);
});
