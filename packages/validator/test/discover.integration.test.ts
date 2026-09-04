import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfigPath, findConfigFile } from "../src/index.js";

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-"));
  created.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("discoverConfigPath", () => {
  test("finds atlante.jsonc", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "atlante.jsonc"), "{}");
    expect(discoverConfigPath(dir).path).toBe(join(dir, "atlante.jsonc"));
  });

  test("finds atlante.json", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "atlante.json"), "{}");
    expect(discoverConfigPath(dir).path).toBe(join(dir, "atlante.json"));
  });

  test("reports ambiguity when both exist instead of choosing", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "atlante.jsonc"), "{}");
    writeFileSync(join(dir, "atlante.json"), "{}");
    const result = discoverConfigPath(dir);
    expect(result).toEqual({
      diagnostics: [
        {
          severity: "error",
          code: "ambiguous-config",
          message:
            "both atlante.jsonc and atlante.json exist in the project root; pass an explicit path",
          source: "atlante.jsonc/atlante.json",
        },
      ],
    });
  });

  test("reports nothing found when neither exists", () => {
    const result = discoverConfigPath(tempDir());
    expect(result).toEqual({
      diagnostics: [
        {
          severity: "error",
          code: "config-not-found",
          message: "no atlante.jsonc or atlante.json found in the project root",
          source: "atlante.jsonc/atlante.json",
        },
      ],
    });
  });

  test("reads a directly addressed canonical config file", () => {
    const dir = tempDir();
    const path = join(dir, "atlante.jsonc");
    writeFileSync(path, '{"$schema":"schema"}');

    expect(findConfigFile(path)).toEqual({
      path,
      text: '{"$schema":"schema"}',
    });
  });

  test("discovers and reads a config from a directory", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "atlante.json"), "{}");

    expect(findConfigFile(dir)).toEqual({
      path: join(dir, "atlante.json"),
      text: "{}",
    });
  });

  test("does not read a directly addressed file with a non-canonical basename", () => {
    const dir = tempDir();
    const path = join(dir, "config.json");
    writeFileSync(path, "{}");

    expect(findConfigFile(path)).toBeNull();
  });

  test("returns null when a canonical direct target cannot be read", () => {
    const dir = tempDir();
    const path = join(dir, "atlante.jsonc");
    mkdirSync(path);

    expect(findConfigFile(path)).toBeNull();
  });

  test("returns null when the discovered config cannot be read", () => {
    const dir = tempDir();
    mkdirSync(join(dir, "atlante.jsonc"));

    expect(findConfigFile(dir)).toBeNull();
  });
});
