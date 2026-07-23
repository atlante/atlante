import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";
import { runResolve, runValidate } from "../src/main.ts";

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
    expect(parsed).toHaveLength(1);
    expect(parsed[0].hostAgentId).toBe("planner");
    expect(parsed[0].prompt).toContain("You plan.");
  });

  test("an empty agents map resolves to an empty JSON array", async () => {
    const dir = project(emptyAgents);
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      expect(await runResolve(dir, { json: true })).toBe(0);
    } finally {
      console.log = original;
    }
    expect(JSON.parse(written.join("\n"))).toEqual([]);
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
});
