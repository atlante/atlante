import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runInit, runValidate } from "../src/main.ts";

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-init-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("runInit", () => {
  test("writes a bare config that validates", async () => {
    const dir = tempDir();
    expect(await runInit(dir, {})).toBe(0);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(await runValidate(dir)).toBe(0);
  });

  test("the bare config has no workflow slot", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    const text = readFileSync(join(dir, "atlante.jsonc"), "utf8");
    expect(text).not.toContain("workflow");
  });

  test("scaffolds the code-review preset", async () => {
    const dir = tempDir();
    expect(await runInit(dir, { preset: "code-review" })).toBe(0);
    const text = readFileSync(join(dir, "atlante.jsonc"), "utf8");
    expect(text).toContain("Find defects");
    expect(await runValidate(dir)).toBe(0);
  });

  test("registers the plugin in opencode.jsonc", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    const opencode = JSON.parse(
      readFileSync(join(dir, "opencode.jsonc"), "utf8"),
    );
    expect(opencode.plugin).toContain("@atlante/opencode-plugin");
  });

  test("preserves an existing opencode.jsonc", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "opencode.jsonc"),
      `{ "model": "anthropic/claude-sonnet-5" }`,
    );
    await runInit(dir, {});
    const opencode = JSON.parse(
      readFileSync(join(dir, "opencode.jsonc"), "utf8"),
    );
    expect(opencode.model).toBe("anthropic/claude-sonnet-5");
    expect(opencode.plugin).toContain("@atlante/opencode-plugin");
  });

  test("reports a fresh plugin registration", async () => {
    const dir = tempDir();
    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      await runInit(dir, {});
    } finally {
      console.log = original;
    }
    expect(written.join("\n")).toContain("registered @atlante/opencode-plugin");
  });

  test("reports that the plugin was already registered, rather than claiming a fresh registration", async () => {
    const dir = tempDir();
    await runInit(dir, {});

    const written: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => written.push(args.join(" "));
    try {
      await runInit(dir, { force: true });
    } finally {
      console.log = original;
    }
    expect(written.join("\n")).toContain("already registered");
  });

  test("--force overwrites altered configuration contents", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    const target = join(dir, "atlante.jsonc");
    writeFileSync(target, "altered contents");

    expect(await runInit(dir, { force: true })).toBe(0);
    const contents = readFileSync(target, "utf8");
    expect(contents).not.toBe("altered contents");
    expect(contents).toContain('"$schema"');
    expect(contents).toContain(`"${basename(dir)}"`);
  });

  test("refuses to overwrite an existing config without --force", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    expect(await runInit(dir, {})).toBe(1);
  });

  test("refuses when only atlante.json already exists", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "atlante.json"),
      JSON.stringify({
        $schema: "https://atlante.sh/schema/v0.1/schema.json",
        agents: {},
      }),
    );
    expect(await runInit(dir, {})).toBe(1);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(false);
  });

  test("refuses an ambiguous pre-state without --force", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    writeFileSync(join(dir, "atlante.json"), "{}");

    expect(await runInit(dir, {})).toBe(1);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "atlante.json"))).toBe(true);
  });

  test("--force writes the default file and removes an alternate config", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "atlante.json"),
      JSON.stringify({
        $schema: "https://atlante.sh/schema/v0.1/schema.json",
        agents: {},
      }),
    );

    expect(await runInit(dir, { force: true })).toBe(0);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "atlante.json"))).toBe(false);
    expect(await runValidate(dir)).toBe(0);
  });

  test("--force resolves an ambiguous pre-state without leaving both files", async () => {
    const dir = tempDir();
    await runInit(dir, {});
    writeFileSync(
      join(dir, "atlante.json"),
      JSON.stringify({
        $schema: "https://atlante.sh/schema/v0.1/schema.json",
        agents: {},
      }),
    );

    expect(await runInit(dir, { force: true })).toBe(0);
    expect(existsSync(join(dir, "atlante.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "atlante.json"))).toBe(false);
  });

  test("rejects an unknown preset name", async () => {
    expect(await runInit(tempDir(), { preset: "nope" })).toBe(1);
  });
});
