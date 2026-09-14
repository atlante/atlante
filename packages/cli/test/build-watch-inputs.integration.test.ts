import { afterEach, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
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
         "agents": { "atlante": { "$instance": "@atlante/pack/atlante", "description": "Atlante" } }
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
          "atlante",
          "instance.jsonc",
        ),
      ),
    );
    expect(result.resourcePaths).toContain(
      canonical(
        join(
          dir,
          "node_modules",
          "@atlante",
          "pack",
          "workflow",
          "template.jsonc",
        ),
      ),
    );
    expect(result.resourcePaths).toContain(
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
    expect(result.resourcePaths).not.toContain(
      canonical(
        join(
          dir,
          "node_modules",
          "@atlante",
          "pack",
          "skill",
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

  test("authorizes selected external package files and exposes both pack roots", () => {
    const dir = tempDir();
    const workspace = tempDir();
    const packageRoot = join(workspace, "review-pack");
    const installed = join(dir, "node_modules", "review-pack");
    const agent = join(packageRoot, "agent");
    mkdirSync(agent, { recursive: true });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    symlinkSync(packageRoot, installed, "dir");
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({
        name: "atlante-watch-fixture",
        version: "1.0.0",
        dependencies: { "review-pack": "file:workspace" },
      })}\n`,
    );
    writeFileSync(
      join(dir, "atlante.jsonc"),
      `${JSON.stringify({
        $schema: SCHEMA_URI,
        extends: "review-pack",
        agents: {
          reviewer: {
            $template: "review-pack/agent",
            description: "Review",
            identity: "Identity",
          },
        },
      })}\n`,
    );
    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "review-pack",
        version: "1.2.3",
        atlante: { format: 1 },
      })}\n`,
    );
    writeFileSync(join(packageRoot, "atlante.jsonc"), "{}\n");
    writeFileSync(
      join(agent, "template.jsonc"),
      `${JSON.stringify({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { identity: { type: "string" } },
        required: ["identity"],
        additionalProperties: false,
      })}\n`,
    );
    writeFileSync(join(agent, "template.md"), "{{identity}}\n");
    const unrelated = join(packageRoot, "broken");
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, "template.jsonc"), "{ broken\n");
    writeFileSync(join(unrelated, "template.md"), "unrelated\n");

    const result = resolveWatchFiles(dir);

    expect(result.resourcePaths).toEqual(
      expect.arrayContaining([
        realpathSync(join(packageRoot, "package.json")),
        join(installed, "package.json"),
        realpathSync(join(agent, "template.jsonc")),
        realpathSync(join(agent, "template.md")),
      ]),
    );
    expect(result.resourcePaths).toContain(installed);
    expect(result.resourcePaths).not.toContain(
      realpathSync(join(unrelated, "template.jsonc")),
    );
    expect(result.trustedRoots).toContainEqual({
      canonical: realpathSync(packageRoot),
      lexical: installed,
    });
  });

  test("retains a canonical workspace ancestor for missing pack dependencies", () => {
    for (const packageName of ["missing-pack", "@scope/missing-pack"]) {
      const dir = tempDir();
      const workspace = tempDir();
      const packageRoot = join(workspace, "author-pack");
      const installed = join(dir, "node_modules", "author-pack");
      const workspaceNodeModules = join(workspace, "node_modules");
      mkdirSync(packageRoot, { recursive: true });
      mkdirSync(join(dir, "node_modules"), { recursive: true });
      mkdirSync(workspaceNodeModules);
      const localNodeModules = join(packageRoot, "node_modules");
      mkdirSync(localNodeModules);
      symlinkSync(packageRoot, installed, "dir");
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify({
          name: "atlante-watch-fixture",
          version: "1.0.0",
          dependencies: { "author-pack": "file:workspace" },
        })}\n`,
      );
      writeFileSync(
        join(dir, "atlante.jsonc"),
        `${JSON.stringify({ $schema: SCHEMA_URI, extends: "author-pack" })}\n`,
      );
      writeFileSync(
        join(packageRoot, "package.json"),
        `${JSON.stringify({
          name: "author-pack",
          version: "1.0.0",
          atlante: { format: 1 },
          dependencies: { [packageName]: "1.0.0" },
        })}\n`,
      );
      writeFileSync(
        join(packageRoot, "atlante.jsonc"),
        `${JSON.stringify({ extends: packageName })}\n`,
      );

      const result = resolveWatchFiles(dir);
      const expectedRoot = {
        canonical: canonical(workspaceNodeModules),
        lexical: workspaceNodeModules,
      };

      expect(result.resourceResolutionSucceeded).toBe(false);
      expect(result.resourcePaths).toEqual(
        expect.arrayContaining([
          canonical(join(dir, "package.json")),
          canonical(join(packageRoot, "package.json")),
          join(installed, "package.json"),
        ]),
      );
      expect(result.unresolvedParents).toEqual(
        expect.arrayContaining([
          canonical(localNodeModules),
          expectedRoot.canonical,
        ]),
      );
      expect(result.trustedRoots).toContainEqual(expectedRoot);
      expect(result.trustedRoots).not.toContainEqual({
        canonical: canonical(localNodeModules),
        lexical: localNodeModules,
      });

      const outside = tempDir();
      const outsideFile = join(outside, "outside.jsonc");
      writeFileSync(outsideFile, "{}\n");
      const filtered = resolveWatchFiles(dir, {
        dependencies: [...result.resourcePaths, outsideFile],
        unresolvedParents: [...result.unresolvedParents, outside],
        trustedRoots: result.trustedRoots,
      });
      expect(filtered.resourcePaths).not.toContain(outsideFile);
      expect(filtered.unresolvedParents).not.toContain(outside);
    }
  });

  test("rejects absolute failure paths outside project and trusted pack roots", () => {
    const dir = tempDir();
    const trusted = tempDir();
    const outside = tempDir();
    writeFileSync(join(dir, "atlante.jsonc"), valid);
    const trustedFile = join(trusted, "trusted.jsonc");
    const outsideFile = join(outside, "failure.jsonc");
    writeFileSync(trustedFile, "{}\n");
    writeFileSync(outsideFile, "{}\n");

    const result = resolveWatchFiles(dir, {
      dependencies: [trustedFile, outsideFile],
      unresolvedParents: [trusted, outside],
      trustedRoots: [{ canonical: trusted, lexical: trusted }],
    });

    expect(result.resourcePaths).toContain(trustedFile);
    expect(result.unresolvedParents).toContain(trusted);
    expect(result.resourcePaths).not.toContain(outsideFile);
    expect(result.unresolvedParents).not.toContain(outside);
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
