import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

type PackReport =
  | Array<{ files: Array<{ path: string }> }>
  | Record<string, { files: Array<{ path: string }> }>;

function packedFiles(stdout: string): string[] {
  const report = JSON.parse(stdout) as PackReport;
  const files = Array.isArray(report)
    ? report[0]?.files
    : Object.values(report)[0]?.files;
  return files?.map(({ path }) => path) ?? [];
}

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

  const files = packedFiles(stdout);
  expect(files.some((file) => file.startsWith("bundled/"))).toBe(false);
});

test("CLI dry-run package contains the generated documentation catalog", {
  timeout: 30_000,
}, async () => {
  const stdout = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: join(ROOT, "packages", "cli"),
    encoding: "utf8",
  });

  const files = packedFiles(stdout);
  expect(files).toContain("dist/mcp/catalog.json");
});

test("catalog build entrypoint generates a fresh structured artifact", () => {
  const directory = mkdtempSync(join(tmpdir(), "atlante-catalog-build-"));
  const output = join(directory, "mcp", "catalog.json");
  try {
    execFileSync(
      process.execPath,
      [
        join(ROOT, "packages", "cli", "src", "mcp", "catalog-build.ts"),
        "--root",
        ROOT,
        "--output",
        output,
      ],
      { encoding: "utf8" },
    );

    const catalog = JSON.parse(readFileSync(output, "utf8")) as {
      schema_version?: unknown;
      source_hash?: unknown;
      documents?: Array<{ id?: unknown }>;
    };
    expect(catalog.schema_version).toBe("atlante-docs/v1");
    expect(catalog.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(catalog.documents?.some(({ id }) => id === "specification")).toBe(
      true,
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
