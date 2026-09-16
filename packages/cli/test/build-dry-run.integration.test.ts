import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_URI } from "@atlante/schema";
import { createProgram, runBuild } from "../src/main.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

function project(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-dry-run-"));
  created.push(dir);
  writeFileSync(join(dir, "atlante.jsonc"), config);
  cpSync(firstPartyPackRoot, join(dir, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({
      name: "atlante-dry-run-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  return dir;
}

const valid = `{
  "$schema": "${SCHEMA_URI}",
  "agents": {
    "reviewer": { "description": "Reviews changes.", "identity": "You review.", "mission": "Find defects." }
  }
}`;

function captureLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("build --dry-run", () => {
  test("reports planned writes without writing anything", () => {
    const dir = project(valid);
    const { lines, restore } = captureLog();
    let code = 1;
    try {
      code = runBuild(dir, { dryRun: true });
    } finally {
      restore();
    }

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("would write opencode:");
    expect(lines.join("\n")).toContain("would build");
    expect(lines.join("\n")).not.toContain("wrote opencode:");
    expect(existsSync(join(dir, ".opencode"))).toBe(false);
    expect(existsSync(join(dir, ".atlante"))).toBe(false);
  });

  test("returns an empty plan for up-to-date outputs without rewriting", () => {
    const dir = project(valid);
    expect(runBuild(dir)).toBe(0);
    const agentPath = join(dir, ".opencode", "agents", "reviewer.md");
    const before = readFileSync(agentPath);

    const { lines, restore } = captureLog();
    let code = 1;
    try {
      code = runBuild(dir, { dryRun: true });
    } finally {
      restore();
    }

    expect(code).toBe(0);
    expect(lines.join("\n")).not.toContain("would write");
    expect(lines.join("\n")).not.toContain("would remove");
    expect(lines.join("\n")).toContain("would build");
    expect(readFileSync(agentPath)).toEqual(before);
  });

  test("reports stale removals without deleting anything", () => {
    const dir = project(
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          old: {
            description: "Old.",
            identity: "Old.",
            mission: "Old.",
          },
        },
      }),
    );
    expect(runBuild(dir)).toBe(0);
    writeFileSync(
      join(dir, "atlante.jsonc"),
      JSON.stringify({
        $schema: SCHEMA_URI,
        agents: {
          new: { description: "New.", identity: "New.", mission: "New." },
        },
      }),
    );

    const { lines, restore } = captureLog();
    let code = 1;
    try {
      code = runBuild(dir, { dryRun: true });
    } finally {
      restore();
    }

    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("would write opencode:");
    expect(lines.join("\n")).toContain("would remove opencode:");
    expect(existsSync(join(dir, ".opencode", "agents", "old.md"))).toBe(true);
    expect(existsSync(join(dir, ".opencode", "agents", "new.md"))).toBe(false);
  });

  test("exits 1 on a would-be collision without writing", () => {
    const dir = project(valid);
    const agentDirectory = join(dir, ".opencode", "agents");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(join(agentDirectory, "reviewer.md"), "user-authored\n");
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };
    const { lines, restore } = captureLog();
    let code = 0;
    try {
      code = runBuild(dir, { dryRun: true });
    } finally {
      console.error = original;
      restore();
    }

    expect(code).toBe(1);
    expect(errors.join("\n")).toContain("materialization-collision");
    expect(lines.join("\n")).not.toContain("would write");
    expect(readFileSync(join(agentDirectory, "reviewer.md"), "utf8")).toBe(
      "user-authored\n",
    );
    expect(existsSync(join(dir, ".atlante", "opencode-native.json"))).toBe(
      false,
    );
  });

  test("rejects --dry-run with --watch without writing", async () => {
    const dir = project(valid);
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.join(" "));
    };
    const previousExitCode = process.exitCode;
    process.exitCode = 0;
    try {
      await createProgram().parseAsync([
        "node",
        "atlante",
        "build",
        dir,
        "--dry-run",
        "--watch",
      ]);
      expect(process.exitCode).toBe(1);
    } finally {
      console.error = originalError;
      process.exitCode = previousExitCode ?? 0;
    }

    expect(errors.join("\n")).toContain(
      "--dry-run cannot be used with --watch",
    );
    expect(existsSync(join(dir, ".opencode"))).toBe(false);
    expect(existsSync(join(dir, ".atlante"))).toBe(false);
  });
});
