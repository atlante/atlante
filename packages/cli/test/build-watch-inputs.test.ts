import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as nodePath from "node:path";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_URI } from "@atlante/schema";
import {
  isWithinAnyRoot,
  resolveWatchFiles,
  type WatchFiles,
} from "../src/commands/build-watch-inputs.js";

const created: string[] = [];
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

function installFirstPartyPack(root: string): void {
  cpSync(firstPartyPackRoot, join(root, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-watch-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "atlante-watch-inputs-"));
  created.push(dir);
  return dir;
}

function canonical(path: string): string {
  return realpathSync(path, "utf8");
}

function allPaths(result: WatchFiles): string[] {
  return [
    ...(result.configPath ? [result.configPath] : []),
    ...(result.configCandidates ?? []),
    ...result.resourcePaths,
    ...result.unresolvedParents,
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
    expect(result.configCandidates).toEqual([
      join(dir, "atlante.jsonc"),
      join(dir, "atlante.json"),
    ]);
  });

  test("watches both root filenames for a selected local preset", () => {
    const dir = tempDir();
    const base = join(dir, "base");
    mkdirSync(base);
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "./base"
      }`,
    );
    writeFileSync(join(base, "atlante.jsonc"), '{"values": {"base": "yes"}}\n');

    const result = resolveWatchFiles(dir);

    expect(result.resourcePaths).toContain(
      canonical(join(base, "atlante.jsonc")),
    );
    expect(result.resourcePaths).toContain(join(base, "atlante.json"));
  });

  test("returns only selected transitive project resources", () => {
    const dir = tempDir();
    const resources = join(dir, "resources");
    const template = join(resources, "template");
    const instance = join(resources, "instance");
    mkdirSync(template, { recursive: true });
    mkdirSync(instance, { recursive: true });
    writeFileSync(
      join(template, "template.jsonc"),
      JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { value: { type: "string" } },
      }),
    );
    writeFileSync(join(template, "template.md"), "{{value}}\n");
    writeFileSync(
      join(instance, "instance.jsonc"),
      JSON.stringify({ $template: "../template", value: "local" }),
    );
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "agents": { "local": "./resources/instance" }
      }`,
    );
    const unrelated = join(resources, "unrelated");
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, "template.jsonc"), "{ malformed");
    writeFileSync(join(unrelated, "template.md"), "unrelated");

    const result = resolveWatchFiles(dir);

    expect(result.resourcePaths).toEqual(
      [
        join(dir, "atlante.jsonc"),
        join(instance, "instance.jsonc"),
        join(template, "template.jsonc"),
        join(template, "template.md"),
        join(dir, "atlante.json"),
      ]
        .map((path) =>
          path === join(dir, "atlante.json") ? path : canonical(path),
        )
        .sort(),
    );
    expect(result.resourcePaths).not.toContain(
      join(unrelated, "template.jsonc"),
    );
  });

  test("returns selected package resources without scanning unrelated siblings", () => {
    const dir = tempDir();
    installFirstPartyPack(dir);
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
         "agents": { "architect": { "$instance": "@atlante/pack/architect", "description": "Architect" } }
      }`,
    );

    const result = resolveWatchFiles(dir);

    expect(result.resourcePaths).toContain(
      canonical(
        join(
          dir,
          "node_modules",
          "@atlante",
          "pack",
          "architect",
          "instance.jsonc",
        ),
      ),
    );
    expect(result.resourcePaths).not.toContain(
      canonical(
        join(
          dir,
          "node_modules",
          "@atlante",
          "pack",
          "artifact",
          "template.jsonc",
        ),
      ),
    );
    for (const path of result.resourcePaths) {
      expect(
        path.startsWith(`${dir}${sep}`) ||
          path.startsWith(`${canonical(dir)}${sep}`) ||
          path.startsWith(`${join(dir, "node_modules")}${sep}`),
      ).toBe(true);
    }
  });

  test("returns unresolved parent directories for a missing local resource", () => {
    const dir = tempDir();
    const resources = join(dir, "resources");
    mkdirSync(resources);
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "agents": { "missing": "./resources/missing" }
      }`,
    );

    const result = resolveWatchFiles(dir);

    expect(result.unresolvedParents).toContain(canonical(resources));
    expect(result.resourcePaths).not.toContain(join(resources, "missing"));
  });

  test("every watch path lies within a known input root", () => {
    const dir = tempDir();
    installFirstPartyPack(dir);
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `{
        "$schema": "${SCHEMA_URI}",
        "extends": "@atlante/pack"
      }`,
    );

    const result = resolveWatchFiles(dir);

    const roots = [dir, canonical(dir)].map((root) => `${root}${sep}`);
    const paths = allPaths(result);
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(roots.some((root) => path.startsWith(root))).toBe(true);
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

  test("keeps a missing config limited to project candidates", () => {
    const dir = tempDir();

    const result = resolveWatchFiles(dir);

    expect(result.resourcePaths).toEqual([]);
    expect(result.unresolvedParents).toEqual([]);
    expect(result.configCandidates).toEqual([
      join(dir, "atlante.jsonc"),
      join(dir, "atlante.json"),
    ]);
  });
});

describe("isWithinAnyRoot", () => {
  test("rejects a Windows candidate on a different volume", () => {
    expect(isWithinAnyRoot("D:\\candidate", ["C:\\root"], nodePath.win32)).toBe(
      false,
    );
  });
});
