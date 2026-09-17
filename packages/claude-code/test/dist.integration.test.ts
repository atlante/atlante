import { beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Bun's bundler may emit node builtins with or without the `node:` prefix;
// both resolve without any install, so both count as self-contained.
const BUILTIN_MODULES = new Set(builtinModules);

function isNodeBuiltin(specifier: string): boolean {
  return specifier.startsWith("node:") || BUILTIN_MODULES.has(specifier);
}

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const DIST_INDEX = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const DIST_INDEX_URL = new URL("../dist/index.js", import.meta.url).href;

const PREPARED = {
  agents: [
    {
      hostAgentId: "reviewer",
      description: "A built-path reviewer.",
      prompt: "You are a built-path reviewer.\n",
    },
  ],
  skills: [
    {
      skillId: "testing",
      description: "A skill materialized by the built adapter.",
      content: "Built skill content.\n",
    },
  ],
} as const;

// Deterministic render contract mirrored from the native materializer: the
// dist bundle must produce exactly these bytes, not merely present files.
function agentBytes(agent: {
  description: string;
  prompt: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `---\nname: ${JSON.stringify(agent.hostAgentId)}\ndescription: ${JSON.stringify(agent.description)}\n---\n${agent.prompt}`,
  );
}

function skillBytes(skill: {
  skillId: string;
  description: string;
  content: string;
}): Uint8Array {
  return new TextEncoder().encode(
    `---\nname: ${JSON.stringify(skill.skillId)}\ndescription: ${JSON.stringify(skill.description)}\n---\n${skill.content}`,
  );
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function expectedOwnedFiles() {
  return [
    {
      kind: "agent",
      id: PREPARED.agents[0].hostAgentId,
      path: `.claude/agents/${PREPARED.agents[0].hostAgentId}.md`,
      sha256: sha256(agentBytes(PREPARED.agents[0])),
    },
    {
      kind: "skill",
      id: PREPARED.skills[0].skillId,
      path: `.claude/skills/${PREPARED.skills[0].skillId}/SKILL.md`,
      sha256: sha256(skillBytes(PREPARED.skills[0])),
    },
  ] as const;
}

function expectedManifestBytes(): Uint8Array {
  const manifest = {
    format: "atlante-claude-code-native",
    version: 1,
    files: expectedOwnedFiles(),
  };
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

beforeAll(async () => {
  execFileSync("bun", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  if (!existsSync(DIST_INDEX)) {
    throw new Error(
      `@atlante/claude-code: build completed without ${relative(ROOT, DIST_INDEX)}`,
    );
  }
}, 30_000);

type MaterializationResult = {
  manifestPath: string;
  manifest: { format: string; version: number; files: unknown[] };
  writtenPaths: readonly string[];
  removedPaths: readonly string[];
};

type BuiltEntry = {
  CLAUDE_CODE_HOST_TARGET: string;
  ClaudeCodeMaterializationError: abstract new (...args: never[]) => Error;
  materializeClaudeCode: (
    projectRoot: string,
    prepared: unknown,
  ) => MaterializationResult;
  claudeCodeMaterializer: {
    host: string;
    materialize: (projectRoot: string, prepared: unknown) => unknown;
  };
  readClaudeCodeNative: (projectRoot: string) => {
    manifest: { format: string; version: number; files: unknown[] };
    files: Array<{ path: string; bytes: Uint8Array }>;
  };
};

async function builtEntry(): Promise<BuiltEntry> {
  return (await import(DIST_INDEX_URL)) as BuiltEntry;
}

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

test("the built single entry exposes exactly the materializer surface", async () => {
  const entry = await builtEntry();

  expect(Object.keys(entry).sort()).toEqual([
    "CLAUDE_CODE_HOST_TARGET",
    "ClaudeCodeMaterializationError",
    "claudeCodeMaterializer",
    "materializeClaudeCode",
    "planClaudeCodeMaterialization",
    "readClaudeCodeNative",
  ]);
  expect(typeof entry.materializeClaudeCode).toBe("function");
  expect(typeof entry.ClaudeCodeMaterializationError).toBe("function");
  expect(typeof entry.readClaudeCodeNative).toBe("function");
  expect(entry.CLAUDE_CODE_HOST_TARGET).toBe("claude-code");
  expect(entry.claudeCodeMaterializer.host).toBe(entry.CLAUDE_CODE_HOST_TARGET);
});

test("the built bundle is self-contained: no @atlante/ or bare external specifiers", () => {
  const specifiers = moduleSpecifiers(bundleSource());

  expect(specifiers.filter((name) => name.startsWith("@atlante/"))).toEqual([]);
  expect(
    specifiers.filter((name) => !name.startsWith(".") && !isNodeBuiltin(name)),
  ).toEqual([]);
});

test("the built entry materializes native files and the ownership manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlante-built-materializer-"));
  try {
    const { materializeClaudeCode, readClaudeCodeNative } = await builtEntry();
    const result = materializeClaudeCode(root, PREPARED);

    expect(result.writtenPaths).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/testing/SKILL.md",
    ]);
    expect(result.removedPaths).toEqual([]);

    const agentPath = join(root, ".claude", "agents", "reviewer.md");
    const skillPath = join(root, ".claude", "skills", "testing", "SKILL.md");
    expect(new TextDecoder().decode(readFileSync(agentPath))).toBe(
      new TextDecoder().decode(agentBytes(PREPARED.agents[0])),
    );
    expect(new TextDecoder().decode(readFileSync(skillPath))).toBe(
      new TextDecoder().decode(skillBytes(PREPARED.skills[0])),
    );

    // The manifest is payload-free bookkeeping: identity plus digests only.
    const manifestPath = join(root, ".atlante", "claude-code-native.json");
    expect(new TextDecoder().decode(readFileSync(manifestPath))).toBe(
      new TextDecoder().decode(expectedManifestBytes()),
    );
    expect(result.manifest.format).toBe("atlante-claude-code-native");
    expect(result.manifest.version).toBe(1);
    expect(result.manifest.files).toEqual(expectedOwnedFiles());
    expect(JSON.stringify(readFileSync(manifestPath))).not.toContain(
      "You are a built-path reviewer",
    );

    const native = readClaudeCodeNative(root);
    expect(native.manifest).toEqual(result.manifest);
    expect(native.files.map(({ path }) => path)).toEqual([
      ".claude/agents/reviewer.md",
      ".claude/skills/testing/SKILL.md",
    ]);
    expect(new TextDecoder().decode(native.files[0]?.bytes)).toBe(
      new TextDecoder().decode(agentBytes(PREPARED.agents[0])),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the built entry fails closed on an unowned collision", async () => {
  const root = mkdtempSync(join(tmpdir(), "atlante-built-collision-"));
  try {
    const agentDirectory = join(root, ".claude", "agents");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(join(agentDirectory, "reviewer.md"), "user-authored\n");

    const { materializeClaudeCode, ClaudeCodeMaterializationError } =
      await builtEntry();
    expect(() => materializeClaudeCode(root, PREPARED)).toThrow(
      ClaudeCodeMaterializationError,
    );
    expect(readFileSync(join(agentDirectory, "reviewer.md"), "utf8")).toBe(
      "user-authored\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ET1b: the published declarations are a consumer-facing contract. They may
// import only the adapter's own modules (and node builtins) — never a private
// @atlante/ package, which a consumer's node_modules would not contain.
test("every dist/*.d.ts is self-contained: no @atlante/ module specifiers", () => {
  const declarations = readdirSync(DIST)
    .filter((file) => file.endsWith(".d.ts"))
    .map((file) => ({
      file,
      source: readFileSync(join(DIST, file), "utf8"),
    }));
  expect(declarations.length).toBeGreaterThan(0);

  for (const { file, source } of declarations) {
    expect(source, `${file} contains a leaked @atlante/ string`).not.toContain(
      "@atlante/",
    );
    const foreign = moduleSpecifiers(source).filter(
      (specifier) => !specifier.startsWith(".") && !isNodeBuiltin(specifier),
    );
    expect(foreign, `${file} imports a non-relative module`).toEqual([]);
  }
});
