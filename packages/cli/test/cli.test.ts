import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";
import packageJson from "../package.json" with { type: "json" };
import { createProgram, runResolve, runValidate } from "../src/main.js";

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
    "reviewer": { "identity": "You review.", "mission": "Find defects." }
  }
}`;

const twoAgents = `{
  "$schema": "${SCHEMA_URI}",
  "values": { "project": "demo" },
  "agents": {
    "reviewer": { "identity": "You review.", "mission": "Find defects." },
    "planner": { "identity": "You plan.", "mission": "Plan work." }
  }
}`;

const emptyAgents = `{
  "$schema": "${SCHEMA_URI}",
  "values": { "project": "demo" },
  "agents": {}
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
  copyFileSync(
    new URL("../bin/atlante.ts", import.meta.url),
    join(binDir, "atlante.js"),
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

  test("shares document-load failures with resolve", async () => {
    const dir = project('{ "agents": ');
    expect(await runValidate(dir)).toBe(1);
    expect(await runResolve(dir, {})).toBe(1);
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

describe("runResolve", () => {
  test("exits 0 and prints the rendered prompt", async () => {
    const dir = project(valid);
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      expect(await runResolve(dir, {})).toBe(0);
    } finally {
      console.log = original;
    }
    expect(written.join("\n")).toContain("You review.");
  });

  test("exits 1 when --agent does not match any binding", async () => {
    const dir = project(valid);
    expect(await runResolve(dir, { agent: "nope" })).toBe(1);
  });

  test("--agent renders only the matching binding", async () => {
    const dir = project(twoAgents);
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      expect(await runResolve(dir, { agent: "planner" })).toBe(0);
    } finally {
      console.log = original;
    }
    const output = written.join("\n");
    expect(output).toContain("You plan.");
    expect(output).not.toContain("You review.");
  });

  test("--json emits the selected artifact descriptors as JSON", async () => {
    const dir = project(twoAgents);
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      expect(await runResolve(dir, { agent: "planner", json: true })).toBe(0);
    } finally {
      console.log = original;
    }
    const parsed = JSON.parse(written.join("\n"));
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0].hostAgentId).toBe("planner");
    expect(parsed.agents[0].prompt).toContain("You plan.");
    expect(parsed.skills).toEqual([]);
    expect(parsed.diagnostics).toEqual([]);
  });

  test("--json emits separate agent and skill arrays", async () => {
    const dir = project(`{
      "$schema": "${SCHEMA_URI}",
      "agents": {
        "reviewer": { "identity": "You review.", "mission": "Find defects." }
      },
      "skills": {
        "testing": { "description": "Testing guidance", "content": "Run tests." }
      }
    }`);
    const output: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      expect(await runResolve(dir, { json: true })).toBe(0);
    } finally {
      console.log = original;
    }
    expect(JSON.parse(output.join("\n"))).toEqual({
      agents: [
        {
          hostAgentId: "reviewer",
          templateId: "atlante/agent",
          prompt: expect.any(String),
        },
      ],
      skills: [
        {
          skillId: "testing",
          description: "Testing guidance",
          templateId: "atlante/skill",
          content: "Run tests.",
        },
      ],
      diagnostics: [],
    });
  });

  test("--agent filters only agents while preserving global skills", async () => {
    const dir = project(`{
      "$schema": "${SCHEMA_URI}",
      "agents": {
        "reviewer": { "identity": "review", "mission": "review" },
        "planner": { "identity": "plan", "mission": "plan" }
      },
      "skills": { "testing": { "description": "Testing", "content": "Run tests." } }
    }`);
    const output: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      expect(await runResolve(dir, { agent: "planner", json: true })).toBe(0);
    } finally {
      console.log = original;
    }
    const envelope = JSON.parse(output.join("\n"));
    expect(envelope.agents).toHaveLength(1);
    expect(envelope.agents[0].hostAgentId).toBe("planner");
    expect(envelope.skills).toHaveLength(1);
  });

  test("human output includes project skills", async () => {
    const dir = project(`{
      "$schema": "${SCHEMA_URI}",
      "agents": { "reviewer": { "identity": "review", "mission": "review" } },
      "skills": { "testing": { "description": "Testing guidance", "content": "Run tests." } }
    }`);
    const output: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      expect(await runResolve(dir, {})).toBe(0);
    } finally {
      console.log = original;
    }
    const human = output.join("\n");
    expect(human).toContain("--- Skills ---");
    expect(human).toContain("--- testing (atlante/skill) ---");
    expect(human).toContain("Description: Testing guidance");
    expect(human).toContain("Run tests.");
  });

  test("an empty agents map resolves to an empty JSON envelope", async () => {
    const dir = project(emptyAgents);
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      expect(await runResolve(dir, { json: true })).toBe(0);
    } finally {
      console.log = original;
    }
    expect(JSON.parse(written.join("\n"))).toEqual({
      agents: [],
      skills: [],
      diagnostics: [],
    });
  });

  test("an empty agents map has no no-agent error without --agent", async () => {
    const dir = project(emptyAgents);
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      expect(await runResolve(dir, {})).toBe(0);
    } finally {
      console.error = original;
    }
    expect(errors).toEqual([]);
  });

  test("an explicit --agent still fails against an empty agents map", async () => {
    const dir = project(emptyAgents);
    expect(await runResolve(dir, { agent: "missing" })).toBe(1);
  });

  test("--json emits a failure envelope without stderr diagnostics", async () => {
    const dir = project(
      `{ "$schema": "${SCHEMA_URI}", "agents": { "broken": {} } }`,
    );
    const output: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      expect(await runResolve(dir, { json: true })).toBe(1);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    const envelope = JSON.parse(output.join("\n"));
    expect(envelope.agents).toEqual([]);
    expect(envelope.skills).toEqual([]);
    expect(envelope.diagnostics.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("--json emits preset expansion diagnostics without stderr output", async () => {
    const dir = project(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "atlante/missing",
      "agents": {}
    }`);
    const output: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    console.error = (...args: unknown[]) => errors.push(args.join(" "));
    try {
      expect(await runResolve(dir, { json: true })).toBe(1);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
    const envelope = JSON.parse(output.join("\n"));
    expect(envelope.agents).toEqual([]);
    expect(envelope.skills).toEqual([]);
    expect(envelope.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknown-preset" }),
      ]),
    );
    expect(errors).toEqual([]);
  });

  test("--json emits a failure envelope for invalid prompt input", async () => {
    const dir = project(
      `{ "$schema": "${SCHEMA_URI}", "agents": { "broken": { "identity": "only identity" } } }`,
    );
    const output: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => output.push(args.join(" "));
    try {
      expect(await runResolve(dir, { json: true })).toBe(1);
    } finally {
      console.log = original;
    }
    const envelope = JSON.parse(output.join("\n"));
    expect(envelope.agents).toEqual([]);
    expect(envelope.skills).toEqual([]);
    expect(envelope.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-prompt-input" }),
      ]),
    );
  });
});
