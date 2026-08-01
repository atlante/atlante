import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";
import packageJson from "../package.json" with { type: "json" };
import { createProgram, runBuild, runValidate } from "../src/main.js";

const created: string[] = [];

function project(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-cli-"));
  created.push(dir);
  writeFileSync(join(dir, "atlante.jsonc"), config);
  return dir;
}

const valid = `{
  "$schema": "${SCHEMA_URI}",
  "values": { "project": "demo" },
  "agents": {
    "reviewer": { "description": "Reviews changes.", "identity": "You review.", "mission": "Find defects." }
  }
}`;

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

test("reports the package manifest version", () => {
  expect(createProgram().version()).toBe(packageJson.version);
});

test("the published launcher runs with Node when Bun is unavailable", () => {
  const dir = mkdtempSync(join(tmpdir(), "atlante-node-launcher-"));
  created.push(dir);
  const executableDir = join(dir, "path");
  const distDir = join(dir, "dist");
  const binDir = join(distDir, "bin");
  mkdirSync(executableDir);
  mkdirSync(binDir, { recursive: true });
  symlinkSync(process.execPath, join(executableDir, "node"));
  // Mirror scripts/publish-packages.ts: the published launcher ships with a
  // node shebang even though the source bin runs under bun, so that Node-only
  // consumers (the documented engine contract) can run it.
  const source = readFileSync(
    new URL("../bin/atlante.ts", import.meta.url),
    "utf8",
  );
  writeFileSync(
    join(binDir, "atlante.js"),
    source.replace("#!/usr/bin/env bun", "#!/usr/bin/env node"),
  );
  chmodSync(join(binDir, "atlante.js"), 0o755);
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }');
  writeFileSync(
    join(distDir, "main.js"),
    'export function createProgram() { return { async parseAsync() { console.log("launched"); } }; }',
  );

  const result = spawnSync(join(binDir, "atlante.js"), [], {
    encoding: "utf8",
    env: { ...process.env, PATH: executableDir },
  });

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("launched");
});

describe("runValidate", () => {
  test("exits 0 on a valid project", async () => {
    expect(await runValidate(project(valid))).toBe(0);
  });

  test("exits 1 on an invalid prompt input", async () => {
    const dir = project(
      `{ "$schema": "${SCHEMA_URI}", "agents": { "a": { "identity": "x" } } }`,
    );
    expect(await runValidate(dir)).toBe(1);
  });

  test("exits 1 when no configuration exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "atlante-empty-"));
    created.push(dir);
    expect(await runValidate(dir)).toBe(1);
  });

  test("reports document-load failures", async () => {
    const dir = project('{ "agents": ');
    expect(await runValidate(dir)).toBe(1);
  });

  test("fails validation on preset expansion diagnostics", async () => {
    const dir = project(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "atlante/missing",
      "agents": {}
    }`);
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      expect(await runValidate(dir)).toBe(1);
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toContain("unknown-preset");
  });
});

describe("runBuild", () => {
  test("builds a valid project and publishes artifacts", async () => {
    const dir = project(valid);
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      expect(await runBuild(dir)).toBe(0);
    } finally {
      console.log = original;
    }
    expect(written.join("\n")).toContain("built");
  });

  test("accepts an explicit config-file target", async () => {
    const dir = project(valid);
    expect(await runBuild(join(dir, "atlante.jsonc"))).toBe(0);
  });

  test("reports preparation diagnostics and does not publish", async () => {
    const dir = project(
      `{ "$schema": "${SCHEMA_URI}", "agents": { "broken": { "description": "{{values.missing}}", "identity": "x", "mission": "y" } } }`,
    );
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      expect(await runBuild(dir)).toBe(1);
    } finally {
      console.error = original;
    }
    expect(existsSync(join(dir, ".atlante", "artifacts"))).toBe(false);
    expect(errors.join("\n")).toContain("missing-value");
  });
});

test("registers build, validate, and init, but not resolve", () => {
  expect(createProgram().commands.map((command) => command.name())).toEqual([
    "validate",
    "build",
    "init",
  ]);
});

test("the build command exposes a --watch option", () => {
  const build = createProgram().commands.find(
    (command) => command.name() === "build",
  );
  expect(build?.options.map((option) => option.long)).toContain("--watch");
});
