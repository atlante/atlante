import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactInputs } from "@atlante/artifacts";
import type { Config, PluginInput } from "@opencode-ai/plugin";
import type { HostConfig } from "../src/api.js";
import { injectAgents } from "../src/inject.js";
import { AtlantePlugin, createAtlantePlugin } from "../src/plugin.js";
import { writeArtifactTree } from "./artifact-fixture.js";

type ArtifactManifestEntry = {
  id: string;
  description: string;
  path: string;
  sha256: string;
};

type ArtifactManifest = {
  format: "atlante-artifacts";
  version: 1;
  agents: ArtifactManifestEntry[];
  skills: ArtifactManifestEntry[];
};

// Rendered-content constants kept local: the adapter tests exercise
// materialization from a verified tree, not pack rendering, which the builder
// tests own.
const EXTERNAL_AGENT_PROMPT = `# External Review

You review external packs.

## Mission

Review the strict artifact.

Detail: Relative detail from the external pack.
`;

const EXTERNAL_SKILL_CONTENT = `# External Testing

Use the external pack.

Strict external body.
`;

const created: string[] = [];

function tempDir(prefix = "atlante-plugin-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

const reviewerAgent: ArtifactInputs["agents"] = [
  {
    hostAgentId: "reviewer",
    description: "Reviews changes.",
    prompt: "You review.\nFind defects.\n",
  },
];

const testingSkill: ArtifactInputs["skills"] = [
  {
    skillId: "testing",
    description: "Testing guidance",
    content: "Run tests.\n",
  },
];

const agentOnly: ArtifactInputs = { agents: reviewerAgent, skills: [] };
const agentWithSkill: ArtifactInputs = {
  agents: reviewerAgent,
  skills: testingSkill,
};

function craftedProject(inputs: ArtifactInputs = agentWithSkill): string {
  const dir = tempDir();
  writeArtifactTree(dir, inputs);
  return dir;
}

function craftedLocalResourceProject(): string {
  return craftedProject({
    agents: [
      {
        hostAgentId: "reviewer",
        description: "A locally authored reviewer.",
        prompt: "You are a locally authored reviewer.\n",
      },
    ],
    skills: [
      {
        skillId: "testing",
        description: "A locally authored skill.",
        content: "This content came from a local resource.\n",
      },
    ],
  });
}

function craftedExternalProject(): { directory: string } {
  return {
    directory: craftedProject({
      agents: [
        {
          hostAgentId: "reviewer",
          description: "External reviewer for strict-project.",
          prompt: EXTERNAL_AGENT_PROMPT,
        },
      ],
      skills: [
        {
          skillId: "testing",
          description: "Strict external testing for strict-project.",
          content: EXTERNAL_SKILL_CONTENT,
        },
      ],
    }),
  };
}

function digest(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function manifestAt(directory: string): ArtifactManifest {
  return JSON.parse(
    readFileSync(
      join(directory, ".atlante", "artifacts", "manifest.json"),
      "utf8",
    ),
  ) as ArtifactManifest;
}

function writeManifest(directory: string, manifest: ArtifactManifest): void {
  writeFileSync(
    join(directory, ".atlante", "artifacts", "manifest.json"),
    JSON.stringify(manifest),
  );
}

function artifactTreeBytes(
  directory: string,
): Array<{ path: string; bytes: Buffer }> {
  const artifactRoot = join(directory, ".atlante", "artifacts");
  const paths = [
    "manifest.json",
    ...["agents", "skills"].flatMap((namespace) =>
      readdirSync(join(artifactRoot, namespace)).map((file) =>
        join(namespace, file),
      ),
    ),
  ];
  return paths.sort().map((path) => ({
    path,
    bytes: readFileSync(join(artifactRoot, path)),
  }));
}

async function expectPluginFailsOpen(directory: string): Promise<void> {
  const config: HostConfig = { agent: { existing: { model: "x" } } };
  const before = structuredClone(config);
  const hooks = await AtlantePlugin(pluginInput(directory));

  await hooks.config?.(config as unknown as Config);

  expect(hooks.tool?.atlante_skill).toBeUndefined();
  expect(config).toEqual(before);
}

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

// Source-config fixtures the adapter must ignore. They are plain documents
// without a schema URI: the plugin never reads source configuration, so the
// content only needs to be a plausible file on disk.
const valid = `{
  "agents": {
    "reviewer": { "description": "Reviews changes.", "identity": "You review.", "mission": "Find defects." }
  }
}`;

function pluginInput(directory: string): PluginInput {
  return { directory } as PluginInput;
}

async function capturedErrors<T>(fn: () => Promise<T>): Promise<string[]> {
  const original = console.error;
  const written: string[] = [];
  console.error = (...args: unknown[]) => written.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return written;
}

type PluginHooks = Awaited<ReturnType<typeof AtlantePlugin>>;

async function capturedPluginConfig(
  directory: string,
  config: HostConfig,
): Promise<{ hooks: PluginHooks; errors: string[] }> {
  let hooks: PluginHooks | undefined;
  const errors = await capturedErrors(async () => {
    const createdHooks = await AtlantePlugin(pluginInput(directory));
    hooks = createdHooks;
    await createdHooks.config?.(config as unknown as Config);
  });
  if (!hooks) throw new Error("plugin factory did not return hooks");
  return { hooks, errors };
}

describe("AtlantePlugin", () => {
  test("materializes a verified publication-only directory without any source inputs", async () => {
    const dir = craftedLocalResourceProject();

    const config: HostConfig = {};
    const { hooks, errors } = await capturedPluginConfig(dir, config);

    expect(errors).toEqual([]);

    expect(config.agent?.reviewer?.prompt).toContain(
      "You are a locally authored reviewer.",
    );
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).resolves.toContain("This content came from a local resource.");
  });

  test("materializes a verified external publication and leaves the tree untouched", async () => {
    const { directory } = craftedExternalProject();
    const before = artifactTreeBytes(directory);
    const manifest = manifestAt(directory);
    const agent = manifest.agents[0];
    const skill = manifest.skills[0];
    if (!agent || !skill) throw new Error("external artifact fixture is empty");

    expect(manifest).toMatchObject({
      format: "atlante-artifacts",
      version: 1,
      agents: [
        {
          id: "reviewer",
          description: "External reviewer for strict-project.",
        },
      ],
      skills: [
        {
          id: "testing",
          description: "Strict external testing for strict-project.",
        },
      ],
    });
    expect(
      readFileSync(
        join(directory, ".atlante", "artifacts", ...agent.path.split("/")),
        "utf8",
      ),
    ).toBe(EXTERNAL_AGENT_PROMPT);
    expect(
      readFileSync(
        join(directory, ".atlante", "artifacts", ...skill.path.split("/")),
        "utf8",
      ),
    ).toBe(EXTERNAL_SKILL_CONTENT);

    const config: HostConfig = {};
    const { hooks, errors } = await capturedPluginConfig(directory, config);

    expect(errors).toEqual([]);

    expect(config.agent?.reviewer).toEqual({
      prompt: EXTERNAL_AGENT_PROMPT,
      description: "External reviewer for strict-project.",
    });
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).resolves.toBe(EXTERNAL_SKILL_CONTENT);
    expect(artifactTreeBytes(directory)).toEqual(before);
  });

  test("ignores a malformed source file without diagnostics or partial host mutation", async () => {
    const { directory } = craftedExternalProject();
    const before = artifactTreeBytes(directory);
    writeFileSync(join(directory, "atlante.jsonc"), "{ malformed source");

    const config: HostConfig = {
      agent: { existing: { model: "host-model" } },
      permission: { edit: "allow" },
    };
    const { hooks, errors } = await capturedPluginConfig(directory, config);

    expect(errors).toEqual([]);
    expect(config).toEqual({
      agent: {
        existing: { model: "host-model" },
        reviewer: {
          prompt: EXTERNAL_AGENT_PROMPT,
          description: "External reviewer for strict-project.",
        },
      },
      permission: { edit: "allow" },
    });
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).resolves.toBe(EXTERNAL_SKILL_CONTENT);
    expect(artifactTreeBytes(directory)).toEqual(before);
  });

  test("uses verified artifacts without consulting any source config", async () => {
    const dir = craftedProject();

    let hooks: PluginHooks | undefined;
    const factoryErrors = await capturedErrors(async () => {
      hooks = await AtlantePlugin(pluginInput(dir));
    });
    if (!hooks) throw new Error("plugin factory did not return hooks");
    expect(factoryErrors).toEqual([]);

    const skillTool = hooks.tool?.atlante_skill;
    expect(skillTool).toBeDefined();
    await expect(
      skillTool?.execute({ name: "testing" }, {} as never),
    ).rejects.toThrow("inactive");

    const config: HostConfig = {};
    const configErrors = await capturedErrors(async () => {
      await hooks?.config?.(config as unknown as Config);
    });
    expect(configErrors).toEqual([]);

    expect(config.agent?.reviewer?.prompt).toContain("You review.");
    await expect(
      skillTool?.execute({ name: "testing" }, {} as never),
    ).resolves.toContain("Run tests.");
  });

  test.each([
    [
      "corruption",
      (dir: string) => writeFileSync(join(dir, "atlante.jsonc"), "{"),
    ],
    [
      "ambiguity",
      (dir: string) => writeFileSync(join(dir, "atlante.json"), valid),
    ],
    [
      "change",
      (dir: string) => writeFileSync(join(dir, "atlante.jsonc"), valid),
    ],
  ] as const)(
    "does not consult source config after a %s",
    async (_name, alter) => {
      const dir = craftedProject();
      alter(dir);

      const config: HostConfig = {};
      const { hooks, errors } = await capturedPluginConfig(dir, config);

      expect(errors).toEqual([]);

      expect(config.agent?.reviewer?.prompt).toContain("You review.");
      expect(hooks.tool?.atlante_skill).toBeDefined();
    },
  );

  test("fails open for missing artifacts", async () => {
    const dir = tempDir();
    await expectPluginFailsOpen(dir);
  });

  test("fails open for corrupt artifacts", async () => {
    const dir = craftedProject();
    writeFileSync(join(dir, ".atlante", "artifacts", "manifest.json"), "{");
    await expectPluginFailsOpen(dir);
  });

  test.each(["format", "version"] as const)(
    "fails open for unsupported manifest %s",
    async (field) => {
      const dir = craftedProject();
      const manifest = manifestAt(dir);
      writeManifest(dir, {
        ...manifest,
        ...(field === "format" ? { format: "unsupported" } : { version: 2 }),
      } as unknown as ArtifactManifest);

      await expectPluginFailsOpen(dir);
    },
  );

  test.each(["id", "path"] as const)(
    "fails open for duplicate manifest %s",
    async (field) => {
      const dir = craftedProject();
      const manifest = manifestAt(dir);
      const agent = manifest.agents[0];
      if (!agent) throw new Error("test fixture has no agent");
      writeManifest(
        dir,
        field === "id"
          ? { ...manifest, agents: [agent, { ...agent, description: "two" }] }
          : {
              ...manifest,
              agents: [
                agent,
                { ...agent, id: "another-agent", description: "two" },
              ],
            },
      );

      await expectPluginFailsOpen(dir);
    },
  );

  test.each(["missing", "corrupt"] as const)(
    "fails open for %s payload",
    async (kind) => {
      const dir = craftedProject();
      const manifest = manifestAt(dir);
      const agent = manifest.agents[0];
      if (!agent) throw new Error("test fixture has no agent");
      const payload = join(
        dir,
        ".atlante",
        "artifacts",
        ...agent.path.split("/"),
      );
      rmSync(payload);
      if (kind === "corrupt") mkdirSync(payload);

      await expectPluginFailsOpen(dir);
    },
  );

  test("fails open for invalid-UTF-8 payload", async () => {
    const dir = craftedProject();
    const manifest = manifestAt(dir);
    const agent = manifest.agents[0];
    if (!agent) throw new Error("test fixture has no agent");
    const bytes = new Uint8Array([0xc3, 0x28]);
    const path = agent.path.replace(
      /-[0-9a-f]{64}\.md$/,
      `-${digest(bytes)}.md`,
    );
    writeFileSync(
      join(dir, ".atlante", "artifacts", ...path.split("/")),
      bytes,
    );
    writeManifest(dir, {
      ...manifest,
      agents: [{ ...agent, path, sha256: digest(bytes) }],
    });

    await expectPluginFailsOpen(dir);
  });

  test("fails open for a digest-mismatched payload", async () => {
    const dir = craftedProject();
    const agent = manifestAt(dir).agents[0];
    if (!agent) throw new Error("test fixture has no agent");
    writeFileSync(
      join(dir, ".atlante", "artifacts", ...agent.path.split("/")),
      "changed payload",
    );

    await expectPluginFailsOpen(dir);
  });

  test("fails open for unsafe artifacts", async () => {
    const dir = craftedProject(agentOnly);
    const manifestPath = join(dir, ".atlante", "artifacts", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      agents: [{ path: string }];
    };
    manifest.agents[0].path = "../unsafe.md";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await expectPluginFailsOpen(dir);
  });

  test("fails open for symlinked payloads", async () => {
    const dir = craftedProject();
    const agent = manifestAt(dir).agents[0];
    if (!agent) throw new Error("test fixture has no agent");
    const payload = join(
      dir,
      ".atlante",
      "artifacts",
      ...agent.path.split("/"),
    );
    rmSync(payload);
    symlinkSync(join(dir, "outside-payload.md"), payload);

    await expectPluginFailsOpen(dir);
  });

  test("injects through the plugin with a replacement warning and preserves host fields", async () => {
    const dir = craftedProject(agentOnly);
    const hooks = await AtlantePlugin(pluginInput(dir));
    const config: HostConfig = {
      agent: {
        reviewer: {
          prompt: "Host prompt",
          description: "Host description",
          model: "host-model",
          mode: "primary",
        },
      },
      permission: { edit: "allow" },
    };

    const errors = await capturedErrors(async () => {
      await hooks.config?.(config as unknown as Config);
    });

    expect(errors).toEqual([
      `[atlante] warning [prompt-replaced]: replaced the existing prompt of host agent "reviewer"`,
    ]);
    expect(config.agent?.reviewer).toMatchObject({
      model: "host-model",
      mode: "primary",
      prompt: expect.stringContaining("You review."),
      description: "Reviews changes.",
    });
    expect(config.permission).toEqual({ edit: "allow" });
  });

  test("stages injection so an adapter failure cannot partially mutate config", async () => {
    const dir = craftedProject();
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);
    const plugin = createAtlantePlugin({
      injectAgents: (staged) => {
        staged.agent = { partial: { prompt: "partial" } };
        throw new Error("injected adapter failure");
      },
    });

    const hooks = await plugin(pluginInput(dir));
    await capturedErrors(async () => {
      await hooks.config?.(config as unknown as Config);
    });

    expect(config).toEqual(before);
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "missing" }, {} as never),
    ).rejects.toThrow("Atlante skills unavailable");
  });

  test("preserves host-owned fields and exposes skill-only projects", async () => {
    const dir = craftedProject({ agents: [], skills: testingSkill });
    const hooks = await AtlantePlugin(pluginInput(dir));
    const config: HostConfig = {
      agent: { existing: { model: "x" } },
      skill: { native: true },
    };
    await hooks.config?.(config as unknown as Config);

    expect(config.agent).toEqual({ existing: { model: "x" } });
    expect(config.skill).toEqual({ native: true });
    expect(hooks.tool?.atlante_skill).toBeDefined();
  });

  test("leaves the host configuration untouched when commit assignment fails", async () => {
    const dir = craftedProject();
    const hooks = await AtlantePlugin(pluginInput(dir));
    const config = { first: "old" } as HostConfig;
    Object.defineProperty(config, "second", {
      configurable: false,
      enumerable: true,
      get: () => "old",
      set: () => {
        throw new Error("commit failure");
      },
    });

    await capturedErrors(async () => {
      await hooks.config?.(config as unknown as Config);
    });

    expect(config.first).toBe("old");
    expect(Object.hasOwn(config, "agent")).toBe(false);
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).rejects.toThrow("Atlante skills unavailable");
  });

  test("recovers when a later config hook follows a failed materialization", async () => {
    const dir = craftedProject();
    let attempts = 0;
    const plugin = createAtlantePlugin({
      injectAgents: (staged, artifacts) => {
        attempts += 1;
        if (attempts === 1) {
          staged.agent = { partial: { prompt: "partial" } };
          throw new Error("transient adapter failure");
        }
        return injectAgents(staged, artifacts);
      },
    });
    const hooks = await plugin(pluginInput(dir));
    const first: HostConfig = { agent: { existing: { model: "x" } } };
    const second: HostConfig = { agent: { existing: { model: "x" } } };

    await capturedErrors(async () => {
      await hooks.config?.(first as unknown as Config);
    });
    await hooks.config?.(second as unknown as Config);

    expect(first).toEqual({ agent: { existing: { model: "x" } } });
    expect(second.agent?.reviewer?.prompt).toContain("You review.");
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).resolves.toContain("Run tests.");
  });

  test("rolls back host changes when warning reporting throws", async () => {
    const dir = craftedProject();
    const hooks = await AtlantePlugin(pluginInput(dir));
    const config: HostConfig = {
      agent: {
        reviewer: { prompt: "Host prompt", model: "host-model" },
      },
    };
    const before = structuredClone(config);
    const original = console.error;
    console.error = () => {
      throw new Error("warning reporter failed");
    };
    try {
      await hooks.config?.(config as unknown as Config);
    } finally {
      console.error = original;
    }

    expect(config).toEqual(before);
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).rejects.toThrow("Atlante skills unavailable");
  });
});
