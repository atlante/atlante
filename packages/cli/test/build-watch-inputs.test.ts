import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { PRESETS_DIR } from "@atlante/presets";
import { SCHEMA_URI } from "@atlante/schema";
import { BUNDLED_TEMPLATES_DIR } from "@atlante/templates";
import {
  bundledTemplatePaths,
  resolveWatchFiles,
  type WatchFiles,
} from "../src/commands/build-watch-inputs.js";

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-watch-inputs-"));
  created.push(dir);
  return dir;
}

function allPaths(result: WatchFiles): string[] {
  return [
    ...(result.configPath ? [result.configPath] : []),
    ...(result.configCandidates ?? []),
    ...result.presetPaths,
    ...result.templatePaths,
  ];
}

const valid = `{
  "$schema": "${SCHEMA_URI}",
  "values": { "project": "demo" }
}`;

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("resolveWatchFiles", () => {
  test("returns the discovered config path for a directory target", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "atlante.jsonc"), valid);

    const result = resolveWatchFiles(dir);

    expect(result.projectDir).toBe(dir);
    expect(result.configPath).toBe(join(dir, "atlante.jsonc"));
    expect(result.configCandidates).toBeUndefined();
  });

  test('maps an "extends": "atlante/<name>" config to the preset file under PRESETS_DIR', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "atlante/starter"
      }`,
    );

    const result = resolveWatchFiles(dir);

    expect(result.presetPaths).toEqual([
      join(PRESETS_DIR, "starter", "atlante.jsonc"),
    ]);
  });

  test("lists bundled template.json and template.md paths from BUNDLED_TEMPLATES_DIR", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "atlante.jsonc"), valid);

    const result = resolveWatchFiles(dir);

    expect(result.templatePaths).toContain(
      join(BUNDLED_TEMPLATES_DIR, "agent", "template.json"),
    );
    expect(result.templatePaths).toContain(
      join(BUNDLED_TEMPLATES_DIR, "workflow", "template.md"),
    );
    for (const path of result.templatePaths) {
      expect(path.startsWith(`${BUNDLED_TEMPLATES_DIR}${sep}`)).toBe(true);
      expect(["template.json", "template.md"]).toContain(
        path.slice(path.lastIndexOf(sep) + 1),
      );
    }
  });

  test("returns no template paths when the templates directory is missing", () => {
    const dir = tempDir();

    expect(bundledTemplatePaths(join(dir, "missing"))).toEqual([]);
  });

  test("never returns paths under the project .atlante directory", () => {
    // By-construction contract: the watch list is an explicit file set built
    // from fixed package dirs plus config paths under projectDir, so no entry
    // can carry a ".atlante" path segment. This asserts that contract; it
    // cannot fail today and there is no ignore-list logic to exercise.
    const dir = tempDir();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "atlante/starter"
      }`,
    );

    const result = resolveWatchFiles(dir);

    const paths = allPaths(result);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.split(sep)).not.toContain(".atlante");
    }
  });

  test("returns the would-be config paths when no config exists", () => {
    const dir = tempDir();

    const result = resolveWatchFiles(dir);

    expect(result.projectDir).toBe(dir);
    expect(result.configPath).toBeUndefined();
    expect(result.configCandidates).toEqual([
      join(dir, "atlante.jsonc"),
      join(dir, "atlante.json"),
    ]);
    expect(result.presetPaths).toEqual([]);
  });

  test("resolves an explicit config-file target", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "atlante.json"), valid);

    const result = resolveWatchFiles(join(dir, "atlante.json"));

    expect(result.projectDir).toBe(dir);
    expect(result.configPath).toBe(join(dir, "atlante.json"));
  });

  test("treats a non-existent config-filename target as a would-be config file", () => {
    const dir = tempDir();

    const result = resolveWatchFiles(join(dir, "atlante.jsonc"));

    expect(result.projectDir).toBe(dir);
    expect(result.configPath).toBeUndefined();
    expect(result.configCandidates).toEqual([
      join(dir, "atlante.jsonc"),
      join(dir, "atlante.json"),
    ]);
  });

  test("treats an existing directory named like a config file as a directory", () => {
    const dir = tempDir();
    const nested = join(dir, "atlante.jsonc");
    mkdirSync(nested);
    writeFileSync(join(nested, "atlante.json"), valid);

    const result = resolveWatchFiles(nested);

    expect(result.projectDir).toBe(nested);
    expect(result.configPath).toBe(join(nested, "atlante.json"));
  });

  test("skips unresolvable presets while keeping the config path", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "atlante/missing"
      }`,
    );

    const result = resolveWatchFiles(dir);

    expect(result.configPath).toBe(join(dir, "atlante.jsonc"));
    expect(result.presetPaths).toEqual([]);
  });

  test("skips a preset id that fails the name pattern", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "atlante/../.."
      }`,
    );

    const result = resolveWatchFiles(dir);

    expect(result.configPath).toBe(join(dir, "atlante.jsonc"));
    expect(result.presetPaths).toEqual([]);
  });

  test("returns no preset paths for a config without extends", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "atlante.jsonc"), valid);

    expect(resolveWatchFiles(dir).presetPaths).toEqual([]);
  });
});
