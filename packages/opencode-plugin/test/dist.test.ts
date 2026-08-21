import { afterEach, beforeAll, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "@atlante/builder";
import { SCHEMA_URI } from "@atlante/schema";
import type { PluginInput } from "@opencode-ai/plugin";

type HostConfig = {
  agent?: Record<string, Record<string, unknown>>;
  permission?: Record<string, unknown>;
};

const created: string[] = [];
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PLUGIN_SOURCE_ROOT = join(ROOT, "packages", "opencode-plugin", "src");
const BUILDER_SOURCE_ROOT = join(ROOT, "packages", "builder", "src");
const PRODUCTION_ENTRYPOINTS = [
  join(PLUGIN_SOURCE_ROOT, "index.ts"),
  join(PLUGIN_SOURCE_ROOT, "api.ts"),
];
const ARTIFACT_READER = join(BUILDER_SOURCE_ROOT, "artifacts-public.ts");
const ALLOWED_ARTIFACT_SOURCES = new Set([
  ARTIFACT_READER,
  join(BUILDER_SOURCE_ROOT, "artifacts.ts"),
  join(BUILDER_SOURCE_ROOT, "artifact-names.ts"),
  join(BUILDER_SOURCE_ROOT, "artifacts-internal.ts"),
]);
const firstPartyPackRoot = fileURLToPath(
  new URL("../../pack/", import.meta.url),
);

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const DIST_INDEX = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const DIST_API = fileURLToPath(new URL("../dist/api.js", import.meta.url));
const DIST_INDEX_URL = new URL("../dist/index.js", import.meta.url).href;
const DIST_API_URL = new URL("../dist/api.js", import.meta.url).href;

beforeAll(
  async () => {
    await Bun.$`bun run build`.cwd(ROOT);
    const missing = [DIST_INDEX, DIST_API].filter((path) => !existsSync(path));
    if (missing.length > 0) {
      throw new Error(
        `@atlante/opencode-plugin: build completed without ${missing
          .map((path) => relative(ROOT, path))
          .join(", ")}`,
      );
    }
  },
  { timeout: 30_000 },
);

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function localResourceProject(): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-built-plugin-"));
  created.push(root);
  cpSync(firstPartyPackRoot, join(root, "node_modules", "@atlante", "pack"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      name: "atlante-built-plugin-fixture",
      version: "1.0.0",
      devDependencies: { "@atlante/pack": "workspace:0.1.6" },
    })}\n`,
  );
  writeFileSync(
    join(root, "atlante.jsonc"),
    `${JSON.stringify({
      $schema: SCHEMA_URI,
      agents: {
        reviewer: {
          $instance: "./resources/reviewer",
          description: "A locally authored reviewer.",
        },
      },
      skills: {
        testing: {
          $instance: "./resources/testing",
          description: "A locally authored testing skill.",
        },
      },
    })}\n`,
  );
  mkdirSync(join(root, "resources", "reviewer"), { recursive: true });
  mkdirSync(join(root, "resources", "testing"), { recursive: true });
  writeFileSync(
    join(root, "resources", "reviewer", "instance.jsonc"),
    JSON.stringify({
      $template: "@atlante/pack/agent",
      identity: "You are a built-path reviewer.",
      mission: "Verify the generated plugin runtime.",
    }),
  );
  writeFileSync(
    join(root, "resources", "testing", "instance.jsonc"),
    JSON.stringify({
      $template: "@atlante/pack/skill",
      title: "Built testing",
      overview: "A skill materialized by the generated plugin.",
      sections: [{ markdown: "Built skill content." }],
    }),
  );
  const result = buildProject(root);
  if (result.diagnostics.some(({ severity }) => severity === "error"))
    throw new Error("built plugin resource fixture failed to build");
  return root;
}

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

type SourceGraphEdge = {
  from: string;
  specifier: string;
  target?: string;
};

type SourceGraph = {
  nodes: Set<string>;
  edges: SourceGraphEdge[];
  unresolved: string[];
};

function displayPath(path: string): string {
  return relative(ROOT, path) || ".";
}

function resolveSourceImport(
  from: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const raw = resolve(dirname(from), specifier);
  const candidates = [
    raw.replace(/\.jsx?$/, ".ts"),
    raw.replace(/\.mjs$/, ".mts"),
    raw,
    `${raw}.ts`,
    `${raw}.tsx`,
    join(raw, "index.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function isAllowedSourcePath(path: string): boolean {
  return (
    path.startsWith(`${PLUGIN_SOURCE_ROOT}/`) ||
    ALLOWED_ARTIFACT_SOURCES.has(path)
  );
}

function isForbiddenSourcePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.includes("/packages/resources/src/") ||
    normalized.includes("/packages/validator/src/") ||
    /\/(?:package-resolution|resolver|resolve)\.[^/]+$/.test(normalized)
  );
}

function isForbiddenSpecifier(specifier: string): boolean {
  if (
    specifier === "@atlante/builder/artifacts" ||
    specifier === "@opencode-ai/plugin" ||
    specifier.startsWith("node:")
  ) {
    return false;
  }
  return !specifier.startsWith(".") && !specifier.startsWith("/");
}

function sourceImportTarget(
  from: string,
  specifier: string,
): string | undefined {
  if (specifier === "@atlante/builder/artifacts") return ARTIFACT_READER;
  return resolveSourceImport(from, specifier);
}

function collectSourceImports(
  current: string,
  graph: SourceGraph,
  pending: string[],
): void {
  for (const specifier of moduleSpecifiers(readFileSync(current, "utf8"))) {
    const target = sourceImportTarget(current, specifier);
    graph.edges.push({ from: current, specifier, target });

    if (specifier.startsWith(".") && !target) {
      graph.unresolved.push(`${displayPath(current)} -> ${specifier}`);
    }
    if (target) pending.push(target);
  }
}

function productionSourceGraph(): SourceGraph {
  const graph: SourceGraph = {
    nodes: new Set(),
    edges: [],
    unresolved: [],
  };
  const pending = [...PRODUCTION_ENTRYPOINTS, ARTIFACT_READER];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || graph.nodes.has(current)) continue;
    graph.nodes.add(current);
    collectSourceImports(current, graph, pending);
  }

  return graph;
}

function absoluteBuildPath(path: string): string {
  return path.startsWith("/") ? path : resolve(ROOT, path);
}

function absoluteDependencyPath(from: string, path: string): string {
  if (!path.startsWith(".")) return absoluteBuildPath(path);
  return resolveSourceImport(from, path) ?? resolve(dirname(from), path);
}

type MetadataGraph = {
  reachable: Set<string>;
  forbiddenImports: string[];
  unresolved: string[];
};

function collectMetadataImports(
  current: string,
  input: Bun.BuildMetafile["inputs"][string],
  graph: MetadataGraph,
  pending: string[],
): void {
  for (const dependency of input.imports) {
    const specifier = dependency.original ?? dependency.path;
    if (isForbiddenSpecifier(specifier)) {
      graph.forbiddenImports.push(`${displayPath(current)} -> ${specifier}`);
    }
    if (dependency.external) continue;

    const target = absoluteDependencyPath(current, dependency.path);
    if (isForbiddenSourcePath(target)) {
      graph.forbiddenImports.push(
        `${displayPath(current)} -> ${displayPath(target)}`,
      );
    }
    pending.push(target);
  }
}

function metadataGraph(metafile: Bun.BuildMetafile): MetadataGraph {
  const inputs = new Map(
    Object.entries(metafile.inputs).map(([path, input]) => [
      absoluteBuildPath(path),
      input,
    ]),
  );
  const graph: MetadataGraph = {
    reachable: new Set(),
    forbiddenImports: [],
    unresolved: [],
  };
  const pending = [...PRODUCTION_ENTRYPOINTS, ARTIFACT_READER];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || graph.reachable.has(current)) continue;
    const input = inputs.get(current);
    if (!input) {
      graph.unresolved.push(displayPath(current));
      continue;
    }
    graph.reachable.add(current);
    collectMetadataImports(current, input, graph, pending);
  }

  return graph;
}

function bundledInputPaths(metafile: Bun.BuildMetafile): Set<string> {
  const paths = new Set<string>();
  for (const output of Object.values(metafile.outputs)) {
    for (const path of Object.keys(output.inputs)) {
      paths.add(absoluteBuildPath(path));
    }
  }
  return paths;
}

async function buildBoundaryMetafile(): Promise<Bun.BuildMetafile> {
  const output = mkdtempSync(join(tmpdir(), "atlante-plugin-boundary-"));
  try {
    const result = await Bun.build({
      entrypoints: PRODUCTION_ENTRYPOINTS,
      target: "bun",
      external: ["@opencode-ai/plugin"],
      splitting: true,
      outdir: output,
      metafile: true,
    });
    if (!result.success || !result.metafile) {
      throw new Error(
        `plugin boundary verification build failed: ${JSON.stringify(
          result.logs,
        )}`,
      );
    }
    return result.metafile;
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}

test("the built bundle exposes the plugin entry as its default export", async () => {
  const entry = await import(DIST_INDEX_URL);

  expect(Object.keys(entry)).toEqual(["default"]);
  expect(typeof entry.default).toBe("function");
});

test("the built bundle's default entry produces configuration hooks", async () => {
  const { default: AtlantePlugin } = await import(DIST_INDEX_URL);
  const hooks = await AtlantePlugin({ directory: "" } as PluginInput);

  expect(typeof hooks.config).toBe("function");
});

test("the built bundle preserves the explicit api entry surface", async () => {
  const api = await import(DIST_API_URL);
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
});

test("the built bundle inlines @atlante/builder and keeps @opencode-ai/plugin external", () => {
  const specifiers = moduleSpecifiers(bundleSource());
  const hasAtlanteSpecifier = specifiers.some((name) =>
    name.startsWith("@atlante/"),
  );

  expect(hasAtlanteSpecifier).toBe(false);
  expect(specifiers).toContain("@opencode-ai/plugin");
});

test("the recursive production graph and bundle inputs remain artifact-only", async () => {
  const sourceGraph = productionSourceGraph();
  const sourceForbidden = sourceGraph.edges.filter(
    ({ specifier, target }) =>
      isForbiddenSpecifier(specifier) ||
      (target !== undefined && isForbiddenSourcePath(target)),
  );

  expect(sourceGraph.unresolved).toEqual([]);
  expect(sourceGraph.nodes).toContain(ARTIFACT_READER);
  expect(
    [...sourceGraph.nodes].filter((path) => !isAllowedSourcePath(path)),
  ).toEqual([]);
  expect(
    sourceForbidden.map(
      ({ from, specifier, target }) =>
        `${displayPath(from)} -> ${specifier}${
          target ? ` (${displayPath(target)})` : ""
        }`,
    ),
  ).toEqual([]);

  const metafile = await buildBoundaryMetafile();
  const metadata = metadataGraph(metafile);
  const allInputs = Object.keys(metafile.inputs).map(absoluteBuildPath);
  const bundledInputs = bundledInputPaths(metafile);

  expect(metadata.unresolved).toEqual([]);
  expect(metadata.forbiddenImports).toEqual([]);
  expect(metadata.reachable).toContain(ARTIFACT_READER);
  expect(
    [...metadata.reachable].filter((path) => !isAllowedSourcePath(path)),
  ).toEqual([]);
  expect(allInputs).toContain(ARTIFACT_READER);
  expect(allInputs.filter((path) => !isAllowedSourcePath(path))).toEqual([]);
  expect(
    [...bundledInputs].filter((path) => !isAllowedSourcePath(path)),
  ).toEqual([]);
  expect([...bundledInputs].filter(isForbiddenSourcePath)).toEqual([]);
});

test("the generated plugin materializes built local-resource artifacts at runtime", async () => {
  const root = localResourceProject();
  rmSync(join(root, "atlante.jsonc"));
  rmSync(join(root, "resources"), { recursive: true, force: true });

  const { default: BuiltAtlantePlugin } = await import(DIST_INDEX_URL);
  const hooks = await BuiltAtlantePlugin({ directory: root } as PluginInput);
  const config: HostConfig = {};

  await hooks.config?.(config as never);

  expect(config.agent?.reviewer?.prompt).toContain(
    "You are a built-path reviewer.",
  );
  expect(hooks.tool?.atlante_skill).toBeDefined();
  await expect(
    hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
  ).resolves.toContain("Built skill content.");
});

test("the generated plugin atomically ignores invalid artifacts without host mutation", async () => {
  const root = localResourceProject();
  writeFileSync(join(root, ".atlante", "artifacts", "manifest.json"), "{");

  const { default: BuiltAtlantePlugin } = await import(DIST_INDEX_URL);
  const hooks = await BuiltAtlantePlugin({ directory: root } as PluginInput);
  const config: HostConfig = {
    agent: { existing: { model: "host-model" } },
    permission: { edit: "allow" },
  };
  const before = structuredClone(config);

  await hooks.config?.(config as never);

  expect(hooks.tool?.atlante_skill).toBeUndefined();
  expect(config).toEqual(before);
});

// ET1b: the published declarations are a consumer-facing contract. They may
// import only the plugin's own modules and @opencode-ai/plugin — never the
// private @atlante/builder/artifacts, which a consumer's node_modules would
// not contain. Plugin-owned structural types replace the builder types in
// public signatures; the ET1b source refactor ships them via
// src/artifacts.ts (emitted as dist/artifacts.d.ts) and re-exports them from
// the ./api entry.
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

test("every dist/*.d.ts is self-contained: no @atlante/ module specifiers", () => {
  const declarations = declarationSources();
  expect(declarations.length).toBeGreaterThan(0);

  for (const { file, source } of declarations) {
    expect(source, `${file} contains a leaked @atlante/ string`).not.toContain(
      "@atlante/",
    );
    const foreign = moduleSpecifiers(source).filter(
      (specifier) =>
        !specifier.startsWith(".") && specifier !== "@opencode-ai/plugin",
    );
    expect(foreign, `${file} imports a non-plugin module`).toEqual([]);
  }
});

test("dist/artifacts.d.ts declares the plugin-owned artifact types", () => {
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
});

test("dist/api.d.ts re-exports the plugin-owned artifact types", () => {
  const apiPath = join(DIST, "api.d.ts");
  const source = existsSync(apiPath) ? readFileSync(apiPath, "utf8") : "";
  expect(source, "dist/api.d.ts is missing").not.toBe("");

  const exported = exportedTypeNames(source);
  for (const name of PLUGIN_ARTIFACT_TYPES) {
    expect(exported, `dist/api.d.ts does not export ${name}`).toContain(name);
  }
});
