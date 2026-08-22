import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { discoverConfigPath } from "../src/index.js";

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
    expect(result.path).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("ambiguous-config");
  });

  test("reports nothing found when neither exists", () => {
    const result = discoverConfigPath(tempDir());
    expect(result.path).toBeUndefined();
    expect(result.diagnostics[0]?.code).toBe("config-not-found");
  });
});
