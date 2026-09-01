import { afterEach, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtifactInputs } from "@atlante/artifacts";
import type {
  PluginInput,
  ToolDefinition,
  ToolResult,
} from "@opencode-ai/plugin";
import { writeArtifactTree } from "./artifact-fixture.js";

type HostConfig = {
  agent?: Record<string, Record<string, unknown>>;
  permission?: Record<string, unknown>;
};

const created: string[] = [];
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PLUGIN_SOURCE_ROOT = join(ROOT, "packages", "opencode", "src");
const ARTIFACTS_SOURCE_ROOT = join(ROOT, "packages", "artifacts", "src");
const PRODUCTION_ENTRYPOINTS = [
  join(PLUGIN_SOURCE_ROOT, "index.ts"),
  join(PLUGIN_SOURCE_ROOT, "api.ts"),
];
// The adapter's declared @atlante/artifacts dependency resolves through its
// package exports like any workspace package; the reader entry is the import
// the plugin uses.
const READ_ONLY_ENTRY = Bun.resolveSync(
  "@atlante/artifacts/read-only",
  PLUGIN_SOURCE_ROOT,
);

const FIRST_PARTY_SKILLS = [
  "brainstorm",
  "plan",
  "build",
  "review",
  "harness",
] as const;

const FIRST_PARTY_SKILL_LANDMARKS: Record<
  (typeof FIRST_PARTY_SKILLS)[number],
  { title: string; overview: string }
> = {
  brainstorm: {
    title: "# Brainstorm",
    overview:
      "Turn an unclear or consequential request into a well-scoped, explicitly approved direction",
  },
  plan: {
    title: "# Plan",
    overview: "Turn a defined request into the smallest implementation plan",
  },
  build: {
    title: "# Build",
    overview: "Implement one defined task through focused test feedback",
  },
  review: {
    title: "# Review",
    overview:
      "Inspect a focused task change or a complete change set without modifying it",
  },
  harness: {
    title: "# Harness",
    overview: "Operate an Atlante harness with evidence",
  },
};

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const DIST_INDEX = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const DIST_API = fileURLToPath(new URL("../dist/api.js", import.meta.url));
const DIST_INDEX_URL = new URL("../dist/index.js", import.meta.url).href;
const DIST_API_URL = new URL("../dist/api.js", import.meta.url).href;

beforeAll(async () => {
  execFileSync("bun", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  const missing = [DIST_INDEX, DIST_API].filter((path) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(
      `@atlante/opencode: build completed without ${missing
        .map((path) => relative(ROOT, path))
        .join(", ")}`,
    );
  }
}, 30_000);

afterEach(() => {
  for (const directory of created.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function craftedProject(inputs: ArtifactInputs): string {
  const root = mkdtempSync(join(tmpdir(), "atlante-built-plugin-"));
  created.push(root);
  writeArtifactTree(root, inputs);
  return root;
}

function craftedFirstPartyProject(): string {
  return craftedProject({
    agents: [
      {
        hostAgentId: "architect",
        description: "The Atlante lead engineer",
        prompt: `# Identity\n\nYou are the lead engineer for Atlante.\n\n## Workflow\n\n### 1. Brainstorm\n\n### 2. Plan\n\n### 3. Build\n\n### 4. Review\n`,
      },
    ],
    skills: FIRST_PARTY_SKILLS.map((skillId) => ({
      skillId,
      description: `${skillId}: workflow phase skill`,
      content: `${FIRST_PARTY_SKILL_LANDMARKS[skillId].title}\n\n## Overview\n\n${FIRST_PARTY_SKILL_LANDMARKS[skillId].overview}\n`,
    })),
  });
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
    path.startsWith(`${ARTIFACTS_SOURCE_ROOT}/`)
  );
}

function isForbiddenSourcePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.includes("/packages/resources/src/") ||
    normalized.includes("/packages/validator/src/") ||
    normalized.includes("/packages/builder/src/") ||
    /\/(?:package-resolution|resolver|resolve)\.[^/]+$/.test(normalized)
  );
}

function isArtifactsSpecifier(specifier: string): boolean {
  // Exactly the adapter-facing reader entry, mirroring the previous exact
  // @atlante/builder/artifacts special case: importing the artifacts root
  // would pull creation and publication helpers into the adapter bundle.
  return specifier === "@atlante/artifacts/read-only";
}

function isForbiddenSpecifier(specifier: string): boolean {
  if (
    isArtifactsSpecifier(specifier) ||
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
  if (specifier.startsWith(".")) return resolveSourceImport(from, specifier);
  // Other bare specifiers are externals (for example @opencode-ai/plugin) and
  // are not followed; the declared artifacts dependency resolves ordinarily
  // through its package exports.
  if (!isArtifactsSpecifier(specifier)) return undefined;
  try {
    return Bun.resolveSync(specifier, dirname(from));
  } catch {
    return undefined;
  }
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
  const pending = [...PRODUCTION_ENTRYPOINTS];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || graph.nodes.has(current)) continue;
    graph.nodes.add(current);
    collectSourceImports(current, graph, pending);
  }

  return graph;
}

function absoluteBuildPath(path: string): string {
  const absolute = path.startsWith("/") ? path : resolve(ROOT, path);
  const marker = "/packages/";
  const packagePath = absolute.lastIndexOf(marker);
  return packagePath >= 0
    ? join(ROOT, absolute.slice(packagePath + 1))
    : absolute;
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
  const pending = [...PRODUCTION_ENTRYPOINTS];

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
  const metafile = join(output, "metafile.json");
  try {
    execFileSync(
      "bun",
      [
        "build",
        ...PRODUCTION_ENTRYPOINTS,
        "--target=bun",
        "--external=@opencode-ai/plugin",
        "--splitting",
        `--outdir=${output}`,
        `--metafile=${metafile}`,
      ],
      { encoding: "utf8" },
    );
    return JSON.parse(readFileSync(metafile, "utf8")) as Bun.BuildMetafile;
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

// OpenCode's server-plugin loader resolves a server target from
// exports["./server"], falling back to a non-empty string "main". A package
// exposing neither installs into the host's plugin cache but is dropped
// silently: the loader's report.missing is a no-op, so the plugin never boots
// and no error is logged (issue #106).
test("the published manifest exposes a server target OpenCode can discover", () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "packages", "opencode", "package.json"), "utf8"),
  ) as { main?: unknown; exports?: Record<string, unknown> };

  // The loader's default-server predicate: typeof main === "string" && main.trim().
  expect(typeof manifest.main, "package.json main must be a string").toBe(
    "string",
  );
  expect(
    (manifest.main as string).trim().length,
    "package.json main must be non-empty",
  ).toBeGreaterThan(0);

  // The explicit ./server convention takes precedence in the loader.
  const server = manifest.exports?.["./server"];
  expect(typeof server, 'exports["./server"] must be a string').toBe("string");
  expect((server as string).trim().length).toBeGreaterThan(0);

  // Both targets must point into dist/ — the only directory the "files"
  // field ships — and resolve to files produced by the build.
  const packageRoot = join(ROOT, "packages", "opencode");
  for (const target of [manifest.main as string, server as string]) {
    const shipped = target.replace(/^\.\//, "");
    expect(
      shipped.startsWith("dist/"),
      `server target ${target} is outside the published dist/ directory`,
    ).toBe(true);
    expect(
      existsSync(join(packageRoot, shipped)),
      `server target ${target} does not exist`,
    ).toBe(true);
  }
});

test("the built bundle inlines @atlante/artifacts and keeps @opencode-ai/plugin external", () => {
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
  expect(sourceGraph.nodes).toContain(READ_ONLY_ENTRY);
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
  expect(metadata.reachable).toContain(READ_ONLY_ENTRY);
  expect(
    [...metadata.reachable].filter((path) => !isAllowedSourcePath(path)),
  ).toEqual([]);
  expect(allInputs).toContain(READ_ONLY_ENTRY);
  expect(allInputs.filter((path) => !isAllowedSourcePath(path))).toEqual([]);
  expect(
    [...bundledInputs].filter((path) => !isAllowedSourcePath(path)),
  ).toEqual([]);
  expect([...bundledInputs].filter(isForbiddenSourcePath)).toEqual([]);
});

test("the generated plugin materializes verified published artifacts at runtime", async () => {
  const root = craftedProject({
    agents: [
      {
        hostAgentId: "reviewer",
        description: "A locally authored reviewer.",
        prompt: "You are a built-path reviewer.\n",
      },
    ],
    skills: [
      {
        skillId: "testing",
        description: "A skill materialized by the generated plugin.",
        content: "Built skill content.\n",
      },
    ],
  });

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

async function firstPartyMaterializedPlugin() {
  const root = craftedFirstPartyProject();

  const { default: BuiltAtlantePlugin } = await import(DIST_INDEX_URL);
  const hooks = await BuiltAtlantePlugin({ directory: root } as PluginInput);
  const config: HostConfig = {};
  await hooks.config?.(config as never);
  return { hooks, config };
}

function expectSingleArchitectAgent(config: HostConfig): void {
  const agents = config.agent ?? {};
  expect(Object.keys(agents)).toEqual(["architect"]);
  const architect = agents.architect;
  expect(architect?.description).toBeTruthy();
  const prompt = architect?.prompt;
  expect(prompt).toContain("You are the lead engineer for");
  expect(prompt).toContain("## Workflow");
  expect(prompt).toContain("### 1. Brainstorm");
  expect(prompt).toContain("### 4. Review");
}

function listedSkillIds(description: string): string[] {
  return description
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2, line.indexOf(":")));
}

function expectSkillLandmarks(
  skillId: (typeof FIRST_PARTY_SKILLS)[number],
  content: ToolResult,
): void {
  if (typeof content !== "string")
    throw new Error(`${skillId} returned a non-string result`);
  const { title, overview } = FIRST_PARTY_SKILL_LANDMARKS[skillId];
  expect(content, `${skillId} title`).toContain(title);
  expect(content, `${skillId} overview heading`).toContain("## Overview");
  expect(content, `${skillId} overview`).toContain(overview);
}

async function expectEverySkillLandmark(
  skillTool: ToolDefinition,
): Promise<void> {
  for (const skillId of FIRST_PARTY_SKILLS) {
    expectSkillLandmarks(
      skillId,
      await skillTool.execute({ name: skillId }, {} as never),
    );
  }
}

// Host-adapter integration coverage: the adapter materializes verified
// artifacts into the host config and serves skills through atlante_skill. It
// brokers no runtime workflow files, so these assertions cover materialization
// landmarks only. The fixture crafts a multi-skill publication whose content
// matches the landmarks below; real pack rendering is covered by the builder
// tests and the smoke test.
test("the generated plugin materializes a multi-skill publication and serves every skill through atlante_skill", async () => {
  const { hooks, config } = await firstPartyMaterializedPlugin();

  expectSingleArchitectAgent(config);

  const skillTool = hooks.tool?.atlante_skill;
  if (!skillTool) throw new Error("atlante_skill tool is not exposed");
  expect(listedSkillIds(skillTool.description).sort()).toEqual(
    [...FIRST_PARTY_SKILLS].sort(),
  );

  await expectEverySkillLandmark(skillTool);

  await expect(
    skillTool.execute({ name: "brainstorming" }, {} as never),
  ).rejects.toThrow('unknown Atlante skill "brainstorming"');
});

test("the generated plugin atomically ignores invalid artifacts without host mutation", async () => {
  const root = craftedProject({
    agents: [
      {
        hostAgentId: "reviewer",
        description: "A locally authored reviewer.",
        prompt: "You are a built-path reviewer.\n",
      },
    ],
    skills: [
      {
        skillId: "testing",
        description: "A skill materialized by the generated plugin.",
        content: "Built skill content.\n",
      },
    ],
  });
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
// private @atlante/artifacts package, which a consumer's node_modules would
// not contain. Plugin-owned structural types replace the artifacts types in
// public signatures; they ship via src/artifacts.ts (emitted as
// dist/artifacts.d.ts) and are re-exported from the ./api entry.
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
