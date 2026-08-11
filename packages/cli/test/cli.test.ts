import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

// These tests execute the real built artifact under real node (run `bun run
// build` first so dist/bin/atlante.js exists; CI runs full:check which builds
// before testing). They replace the old launcher simulation, which symlinked
// bun itself as `node` and never exercised the published bundle.
const LAUNCHER = fileURLToPath(
  new URL("../dist/bin/atlante.js", import.meta.url),
);
const BUNDLED = fileURLToPath(new URL("../bundled", import.meta.url));
const REAL_NODE = Bun.which("node");
const launcherIsBuilt = existsSync(LAUNCHER) && REAL_NODE !== null;
const bundledIsBuilt = existsSync(join(BUNDLED, "resources"));

test.skipIf(!bundledIsBuilt)(
  "the built CLI ships one unified resource pack",
  () => {
    expect(existsSync(join(BUNDLED, "resources"))).toBe(true);
    expect(existsSync(join(BUNDLED, "templates"))).toBe(false);
    expect(existsSync(join(BUNDLED, "presets"))).toBe(false);
  },
);

test.skipIf(!launcherIsBuilt)(
  "the built launcher runs with Node when Bun is unavailable",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "atlante-node-launcher-"));
    created.push(dir);
    const executableDir = join(dir, "path");
    mkdirSync(executableDir);
    if (!REAL_NODE) throw new Error("real node not found via Bun.which");
    symlinkSync(REAL_NODE, join(executableDir, "node"));

    const result = spawnSync(LAUNCHER, ["--version"], {
      encoding: "utf8",
      env: { ...process.env, PATH: executableDir },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  },
);

test.skipIf(!launcherIsBuilt)(
  "the built launcher builds a project under Node",
  () => {
    const dir = project(valid);
    const executableDir = join(dir, "path");
    mkdirSync(executableDir);
    if (!REAL_NODE) throw new Error("real node not found via Bun.which");
    symlinkSync(REAL_NODE, join(executableDir, "node"));

    const result = spawnSync(LAUNCHER, ["build", dir], {
      encoding: "utf8",
      env: { ...process.env, PATH: executableDir },
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(dir, ".atlante", "artifacts"))).toBe(true);
  },
);

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
  expect(existsSync(join(dir, ".atlante", "artifacts", "manifest.json"))).toBe(
    true,
  );
});

test("CLI resolves bundled resource facets without package lookup", async () => {
  const dir = project(`{
    "$schema": "${SCHEMA_URI}",
    "values": { "project": "demo", "quick-check": "quick", "full-check": "full" },
    "agents": {
      "architect": { "$instance": "atlante/architect", "description": "Architect" },
      "agent": { "$template": "atlante/agent", "description": "Agent", "identity": "Identity", "mission": "Mission" }
    },
    "skills": {
      "brainstorming": { "$instance": "atlante/brainstorming", "description": "Brainstorming" },
      "workflow": { "$instance": "atlante/delivery-workflow", "description": "Workflow" },
      "skill": { "$template": "atlante/skill", "description": "Skill", "title": "Skill", "overview": "Overview", "sections": [{ "markdown": "Body" }] }
    }
  }`);

  expect(await runValidate(dir)).toBe(0);
  expect(await runBuild(dir)).toBe(0);
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
    expect(errors.join("\n")).toContain("missing-target");
  });

  test("accepts config filenames and relative project directories from any cwd", async () => {
    const dir = project(valid);
    const previous = process.cwd();
    try {
      process.chdir(dir);
      expect(await runValidate("atlante.jsonc")).toBe(0);
      expect(await runValidate(".")).toBe(0);

      process.chdir(tmpdir());
      expect(await runValidate(dir.slice(tmpdir().length + 1))).toBe(0);
    } finally {
      process.chdir(previous);
    }
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
