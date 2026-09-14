import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_URI } from "@atlante/schema";
import packageJson from "../package.json" with { type: "json" };
import { createProgram, runBuild, runValidate } from "../src/main.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

function project(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-cli-"));
  created.push(dir);
  writeFileSync(join(dir, "atlante.jsonc"), config);
  cpSync(firstPartyPackRoot, join(dir, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "atlante-cli-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  return dir;
}

function projectWithoutUserPack(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-cli-no-pack-"));
  created.push(dir);
  writeFileSync(join(dir, "atlante.jsonc"), config);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "atlante-cli-no-pack-fixture",
      version: "1.0.0",
    })}\n`,
  );
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

// These tests execute a freshly built artifact under real node. They replace
// the old launcher simulation, which symlinked bun itself as `node` and never
// exercised the published bundle.
const CLI_ENTRY = fileURLToPath(new URL("../bin/atlante.ts", import.meta.url));
const LAUNCHER = fileURLToPath(
  new URL("../dist/bin/atlante.js", import.meta.url),
);
const REAL_NODE = process.execPath;

beforeAll(async () => {
  const outdir = fileURLToPath(new URL("../dist/bin/", import.meta.url));
  const built = spawnSync(
    "bun",
    [
      "build",
      CLI_ENTRY,
      "--target=node",
      "--external",
      "jsonc-parser",
      "--outdir",
      outdir,
    ],
    { encoding: "utf8" },
  );
  if (built.status !== 0)
    throw new Error(`could not build CLI launcher: ${built.stderr}`);
  if (!existsSync(LAUNCHER))
    throw new Error(
      "CLI launcher build completed without producing dist/bin/atlante.js",
    );
  if (!readFileSync(LAUNCHER, "utf8").startsWith("#!/usr/bin/env node"))
    throw new Error("built CLI launcher does not have the Node shebang");
});

function nodeExecutable(): string {
  return REAL_NODE;
}

test("the built launcher runs with Node when Bun is unavailable", () => {
  const dir = mkdtempSync(join(tmpdir(), "atlante-node-launcher-"));
  created.push(dir);
  const executableDir = join(dir, "path");
  mkdirSync(executableDir);
  symlinkSync(nodeExecutable(), join(executableDir, "node"));

  const result = spawnSync(LAUNCHER, ["--version"], {
    encoding: "utf8",
    env: { ...process.env, PATH: executableDir },
  });

  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(packageJson.version);
});

test("the built launcher honors init --no-mcp", () => {
  const dir = projectWithoutUserPack(`{
    "$schema": "${SCHEMA_URI}",
    "extends": "@atlante/pack"
  }`);
  rmSync(join(dir, "atlante.jsonc"));
  const executableDir = join(dir, "path");
  mkdirSync(executableDir);
  symlinkSync(nodeExecutable(), join(executableDir, "node"));

  const result = spawnSync(LAUNCHER, ["init", dir, "--no-mcp"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: executableDir },
  });

  expect(result.status).toBe(0);
  expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
  expect(existsSync(join(dir, "opencode.jsonc"))).toBe(false);
  expect(existsSync(join(dir, "opencode.json"))).toBe(false);
});

test("the built launcher honors init --opencode-version", () => {
  const dir = projectWithoutUserPack(`{
    "$schema": "${SCHEMA_URI}",
    "extends": "@atlante/pack"
  }`);
  rmSync(join(dir, "atlante.jsonc"));
  const executableDir = join(dir, "path");
  mkdirSync(executableDir);
  symlinkSync(nodeExecutable(), join(executableDir, "node"));

  const result = spawnSync(
    LAUNCHER,
    ["init", dir, "--opencode-version", "1.18.29"],
    {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: executableDir },
    },
  );

  expect(result.status).toBe(0);
  const config = JSON.parse(
    readFileSync(join(dir, "opencode.jsonc"), "utf8"),
  ) as {
    mcp?: {
      atlante?: { enabled?: boolean };
      servers?: Record<string, unknown>;
    };
  };
  expect(config.mcp?.atlante?.enabled).toBe(true);
  expect(config.mcp?.servers).toBeUndefined();
});

test("the built launcher builds a project under Node", () => {
  const dir = project(valid);
  const executableDir = join(dir, "path");
  mkdirSync(executableDir);
  symlinkSync(nodeExecutable(), join(executableDir, "node"));

  const result = spawnSync(LAUNCHER, ["build", dir], {
    encoding: "utf8",
    env: { ...process.env, PATH: executableDir },
  });

  expect(result.status).toBe(0);
  expect(existsSync(join(dir, ".opencode", "agents", "reviewer.md"))).toBe(
    true,
  );
  expect(existsSync(join(dir, ".atlante", "opencode-native.json"))).toBe(true);
});

test("the built launcher resolves the first-party pack without a project declaration", () => {
  const dir = projectWithoutUserPack(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "@atlante/pack"
    }`);
  const executableDir = join(dir, "path");
  mkdirSync(executableDir);
  symlinkSync(nodeExecutable(), join(executableDir, "node"));

  const result = spawnSync(LAUNCHER, ["validate", dir], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: executableDir },
  });

  expect(result.status).toBe(0);
});

test("CLI validates and builds local shorthand, selectors, and local extends", async () => {
  const dir = project(`{
    "$schema": "${SCHEMA_URI}",
    "extends": "./base",
    "agents": {
      "shorthand": "./local-instance",
      "selected": { "$instance": "./local-instance", "description": "Selected" }
    }
  }`);
  mkdirSync(join(dir, "base"));
  writeFileSync(
    join(dir, "base", "atlante.jsonc"),
    `{
      "$schema": "${SCHEMA_URI}",
      "agents": { "inherited": { "$template": "../local-template", "description": "Inherited", "identity": "Identity", "mission": "Mission" } }
    }`,
  );
  mkdirSync(join(dir, "local-template"));
  writeFileSync(
    join(dir, "local-template", "template.jsonc"),
    JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        identity: { type: "string" },
        mission: { type: "string" },
      },
      required: ["identity", "mission"],
      additionalProperties: false,
    }),
  );
  writeFileSync(
    join(dir, "local-template", "template.md"),
    "{{identity}}\n{{mission}}\n",
  );
  mkdirSync(join(dir, "local-instance"));
  writeFileSync(
    join(dir, "local-instance", "instance.jsonc"),
    JSON.stringify({
      $template: "../local-template",
      description: "Local",
      identity: "Identity",
      mission: "Mission",
    }),
  );

  expect(await runValidate(dir)).toBe(0);
  expect(await runBuild(dir)).toBe(0);
  expect(existsSync(join(dir, ".atlante", "opencode-native.json"))).toBe(true);
});

test("CLI resolves first-party package resource facets", async () => {
  const dir = project(`{
    "$schema": "${SCHEMA_URI}",
    "values": { "project": "demo", "workflow-root": ".atlante/workflows" },
    "agents": {
      "architect": { "$instance": "@atlante/pack/architect", "description": "Architect" },
      "agent": { "$template": "@atlante/pack/agent", "description": "Agent", "identity": "Identity", "mission": "Mission" }
    },
    "skills": {
      "plan": { "$instance": "@atlante/pack/plan", "description": "Plan" },
      "review": { "$instance": "@atlante/pack/review", "description": "Review" },
      "skill": { "$template": "@atlante/pack/skill", "description": "Skill", "title": "Skill", "overview": "Overview", "sections": [{ "markdown": [{ "type": "paragraph", "children": [{ "type": "text", "value": "Body" }] }] }] }
    }
  }`);

  expect(await runValidate(dir)).toBe(0);
  expect(await runBuild(dir)).toBe(0);
});

test("CLI validate and build trust the installed first-party pack without a user declaration", async () => {
  const dir = projectWithoutUserPack(`{
    "$schema": "${SCHEMA_URI}",
    "extends": "@atlante/pack"
  }`);

  expect(await runValidate(dir)).toBe(0);
  expect(runBuild(dir)).toBe(0);
  expect(existsSync(join(dir, ".atlante", "opencode-native.json"))).toBe(true);
});

describe("runValidate", () => {
  test("exits 0 on a valid project", async () => {
    expect(await runValidate(project(valid))).toBe(0);
  });

  test("prints the validated success grammar", async () => {
    const dir = project(valid);
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      expect(await runValidate(dir)).toBe(0);
    } finally {
      console.log = original;
    }
    expect(written).toEqual([`validated ${join(dir, "atlante.jsonc")}`]);
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
      "extends": "@atlante/pack/missing",
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
    expect(errors.join("\n")).toContain("missing-package-subpath");
  });

  test("accepts config filenames and relative project directories from any cwd", async () => {
    const dir = project(valid);
    const relativeDir = relative(tmpdir(), dir);
    const first = spawnSync(LAUNCHER, ["validate", "atlante.jsonc"], {
      cwd: dir,
      encoding: "utf8",
    });
    const second = spawnSync(LAUNCHER, ["validate", "."], {
      cwd: dir,
      encoding: "utf8",
    });
    const third = spawnSync(LAUNCHER, ["validate", relativeDir], {
      cwd: tmpdir(),
      encoding: "utf8",
    });

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(third.status).toBe(0);
  });
});

describe("runBuild", () => {
  test("builds a valid project and materializes native outputs", async () => {
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

  test("reports preparation diagnostics and does not materialize", async () => {
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
    expect(existsSync(join(dir, ".opencode"))).toBe(false);
    expect(existsSync(join(dir, ".atlante", "opencode-native.json"))).toBe(
      false,
    );
    expect(errors.join("\n")).toContain("missing-value");
  });
});

test("registers validate, build, mcp, init, import, pack, and eval, but not resolve", () => {
  expect(createProgram().commands.map((command) => command.name())).toEqual([
    "validate",
    "build",
    "mcp",
    "init",
    "import",
    "pack",
    "eval",
  ]);
});

test("registers the pack lifecycle subcommands", () => {
  const pack = createProgram().commands.find(
    (command) => command.name() === "pack",
  );
  expect(pack?.commands.map((command) => command.name())).toEqual([
    "install",
    "uninstall",
    "list",
  ]);
});

test("the build command exposes a --watch option", () => {
  const build = createProgram().commands.find(
    (command) => command.name() === "build",
  );
  expect(build?.options.map((option) => option.long)).toContain("--watch");
});

test("init pack help describes a pack locator rather than starter", () => {
  const init = createProgram().commands.find(
    (command) => command.name() === "init",
  );
  const pack = init?.options.find((option) => option.long === "--pack");

  expect(pack?.description).toContain("pack locator");
  expect(pack?.description).not.toContain("starter");
});

test("init no longer exposes the removed --preset option", () => {
  const init = createProgram().commands.find(
    (command) => command.name() === "init",
  );
  expect(init?.options.map((option) => option.long)).not.toContain("--preset");
});

test("init exposes the --no-mcp opt-out", () => {
  const init = createProgram().commands.find(
    (command) => command.name() === "init",
  );

  expect(init?.options.map((option) => option.long)).toContain("--no-mcp");
});

test("init exposes the OpenCode version override", () => {
  const init = createProgram().commands.find(
    (command) => command.name() === "init",
  );

  expect(init?.options.map((option) => option.long)).toContain(
    "--opencode-version",
  );
});
