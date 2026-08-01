import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginInput } from "@opencode-ai/plugin";

// These tests execute the real built plugin artifact (run `bun run build`
// first so dist/index.js and dist/api.js exist; CI runs full:check which
// builds before testing). They lock in the publication contract: a Bun
// bundle with @atlante/builder inlined and @opencode-ai/plugin external.
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const DIST_INDEX = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const DIST_API = fileURLToPath(new URL("../dist/api.js", import.meta.url));
const bundleIsBuilt = existsSync(DIST_INDEX) && existsSync(DIST_API);

// Bun splitting emits shared chunk-*.js files next to the entries, so the
// self-containment assertion scans every emitted runtime module instead of
// hardcoding chunk names.
function bundleSource(): string {
  return readdirSync(DIST)
    .filter((file) => file.endsWith(".js"))
    .map((file) => readFileSync(join(DIST, file), "utf8"))
    .join("\n");
}

function moduleSpecifiers(source: string): string[] {
  const specifier =
    /(?:from\s*|require\(\s*|import\(\s*|\bimport\s+)["']([^"']+)["']/g;
  return [...source.matchAll(specifier)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

test.skipIf(!bundleIsBuilt)(
  "the built bundle exposes the plugin entry as its default export",
  async () => {
    const entry = await import("../dist/index.js");

    expect(Object.keys(entry)).toEqual(["default"]);
    expect(typeof entry.default).toBe("function");
  },
);

test.skipIf(!bundleIsBuilt)(
  "the built bundle's default entry produces configuration hooks",
  async () => {
    const { default: AtlantePlugin } = await import("../dist/index.js");
    const hooks = await AtlantePlugin({ directory: "" } as PluginInput);

    expect(typeof hooks.config).toBe("function");
  },
);

test.skipIf(!bundleIsBuilt)(
  "the built bundle preserves the explicit api entry surface",
  async () => {
    const api = await import("../dist/api.js");
    const runtimeExports = Object.values(api).filter(
      (value) => typeof value === "function",
    );

    expect(runtimeExports).toHaveLength(4);
    for (const name of [
      "injectAgents",
      "AtlantePlugin",
      "createAtlantePlugin",
      "createSkillTool",
    ] as const) {
      expect(typeof api[name]).toBe("function");
    }
  },
);

test.skipIf(!bundleIsBuilt)(
  "the built bundle inlines @atlante/builder and keeps @opencode-ai/plugin external",
  () => {
    const specifiers = moduleSpecifiers(bundleSource());
    const hasAtlanteSpecifier = specifiers.some((name) =>
      name.startsWith("@atlante/"),
    );

    expect(hasAtlanteSpecifier).toBe(false);
    expect(specifiers).toContain("@opencode-ai/plugin");
  },
);

// ET1b: the published declarations are a consumer-facing contract. They may
// import only the plugin's own modules and @opencode-ai/plugin — never the
// private @atlante/builder/artifacts, which a consumer's node_modules would
// not contain. Plugin-owned structural types replace the builder types in
// public signatures; the ET1b source refactor ships them via
// src/artifacts.ts (emitted as dist/artifacts.d.ts) and re-exports them from
// the ./api entry.
const declarationsAreBuilt =
  bundleIsBuilt && readdirSync(DIST).some((file) => file.endsWith(".d.ts"));

function declarationSources(): { file: string; source: string }[] {
  return readdirSync(DIST)
    .filter((file) => file.endsWith(".d.ts"))
    .map((file) => ({
      file,
      source: readFileSync(join(DIST, file), "utf8"),
    }));
}

function exportedTypeNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(
    /export\s+(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)/g,
  )) {
    const name = match[1];
    if (name) names.add(name);
  }
  for (const match of source.matchAll(/export\s+type\s*\{([^}]+)\}/g)) {
    const list = match[1];
    if (!list) continue;
    for (const name of list.split(",")) {
      const bare = (name.trim().split(/\s+as\s+/)[0] ?? "").trim();
      if (bare) names.add(bare);
    }
  }
  return [...names];
}

const PLUGIN_ARTIFACT_TYPES = [
  "PluginAgentArtifact",
  "PluginSkillArtifact",
  "PluginArtifacts",
  "PluginArtifactsReader",
] as const;

test.skipIf(!declarationsAreBuilt)(
  "every dist/*.d.ts is self-contained: no @atlante/ module specifiers",
  () => {
    const declarations = declarationSources();
    expect(declarations.length).toBeGreaterThan(0);

    for (const { file, source } of declarations) {
      expect(
        source,
        `${file} contains a leaked @atlante/ string`,
      ).not.toContain("@atlante/");
      const foreign = moduleSpecifiers(source).filter(
        (specifier) =>
          !specifier.startsWith(".") && specifier !== "@opencode-ai/plugin",
      );
      expect(foreign, `${file} imports a non-plugin module`).toEqual([]);
    }
  },
);

test.skipIf(!declarationsAreBuilt)(
  "dist/artifacts.d.ts declares the plugin-owned artifact types",
  () => {
    const artifactsPath = join(DIST, "artifacts.d.ts");
    const source = existsSync(artifactsPath)
      ? readFileSync(artifactsPath, "utf8")
      : "";
    expect(source, "dist/artifacts.d.ts is missing").not.toBe("");

    const exported = exportedTypeNames(source);
    for (const name of PLUGIN_ARTIFACT_TYPES) {
      expect(exported, `dist/artifacts.d.ts does not export ${name}`).toContain(
        name,
      );
    }
  },
);

test.skipIf(!declarationsAreBuilt)(
  "dist/api.d.ts re-exports the plugin-owned artifact types",
  () => {
    const apiPath = join(DIST, "api.d.ts");
    const source = existsSync(apiPath) ? readFileSync(apiPath, "utf8") : "";
    expect(source, "dist/api.d.ts is missing").not.toBe("");

    const exported = exportedTypeNames(source);
    for (const name of PLUGIN_ARTIFACT_TYPES) {
      expect(exported, `dist/api.d.ts does not export ${name}`).toContain(name);
    }
  },
);
