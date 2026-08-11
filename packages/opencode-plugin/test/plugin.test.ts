import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProject } from "@atlante/builder";
import { SCHEMA_URI } from "@atlante/schema";
import type { Config, PluginInput } from "@opencode-ai/plugin";
import type { HostConfig } from "../src/api.js";
import { injectAgents } from "../src/inject.js";
import { AtlantePlugin, createAtlantePlugin } from "../src/plugin.js";

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

const created: string[] = [];

function tempDir(prefix = "atlante-plugin-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  created.push(dir);
  return dir;
}

function project(config: string): string {
  const dir = tempDir();
  writeFileSync(join(dir, "atlante.jsonc"), config);
  return dir;
}

function builtProject(config = validWithSkill): string {
  const dir = project(config);
  const result = buildProject(dir);
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    throw new Error("test fixture failed to build");
  return dir;
}

function builtLocalResourceProject(): string {
  const dir = project(`{
    "$schema": "${SCHEMA_URI}",
    "agents": {
      "reviewer": {
        "$instance": "./resources/reviewer",
        "description": "A locally authored reviewer."
      }
    },
    "skills": {
      "testing": {
        "$instance": "./resources/testing",
        "description": "A locally authored testing skill."
      }
    }
  }`);
  mkdirSync(join(dir, "resources", "reviewer"), { recursive: true });
  mkdirSync(join(dir, "resources", "testing"), { recursive: true });
  writeFileSync(
    join(dir, "resources", "reviewer", "instance.jsonc"),
    `{
      "$template": "atlante/agent",
      "identity": "You are a locally authored reviewer.",
      "mission": "Prove that local resources were built before source removal."
    }`,
  );
  writeFileSync(
    join(dir, "resources", "testing", "instance.jsonc"),
    `{
      "$template": "atlante/skill",
      "title": "Local testing",
      "overview": "A locally authored skill.",
      "sections": [{ "markdown": "This content came from a local resource." }]
    }`,
  );

  const result = buildProject(dir);
  if (result.diagnostics.some((diagnostic) => diagnostic.severity === "error"))
    throw new Error("local resource fixture failed to build");
  return dir;
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

const valid = `{
  "$schema": "${SCHEMA_URI}",
  "agents": {
    "reviewer": { "description": "Reviews changes.", "identity": "You review.", "mission": "Find defects." }
  }
}`;

const validWithSkill = `{
  "$schema": "${SCHEMA_URI}",
  "agents": {
    "reviewer": { "description": "Reviews changes.", "identity": "You review.", "mission": "Find defects." }
  },
  "skills": {
    "testing": {
      "description": "Testing guidance",
      "title": "Testing",
      "overview": "Testing guidance",
      "sections": [{ "markdown": "Run tests." }]
    }
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

describe("AtlantePlugin", () => {
  test("materializes local-resource artifacts after source files are removed", async () => {
    const dir = builtLocalResourceProject();
    rmSync(join(dir, "atlante.jsonc"));
    rmSync(join(dir, "resources"), { recursive: true, force: true });

    const hooks = await AtlantePlugin(pluginInput(dir));
    const config: HostConfig = {};
    await hooks.config?.(config as unknown as Config);

    expect(config.agent?.reviewer?.prompt).toContain(
      "You are a locally authored reviewer.",
    );
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).resolves.toContain("This content came from a local resource.");
  });

  test("uses verified built artifacts after the source config is removed", async () => {
    const dir = builtProject();
    unlinkSync(join(dir, "atlante.jsonc"));

    const hooks = await AtlantePlugin(pluginInput(dir));
    const skillTool = hooks.tool?.atlante_skill;
    expect(skillTool).toBeDefined();
    await expect(
      skillTool?.execute({ name: "testing" }, {} as never),
    ).rejects.toThrow("inactive");

    const config: HostConfig = {};
    await hooks.config?.(config as unknown as Config);
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
      const dir = builtProject();
      alter(dir);

      const hooks = await AtlantePlugin(pluginInput(dir));
      const config: HostConfig = {};
      await hooks.config?.(config as unknown as Config);

      expect(config.agent?.reviewer?.prompt).toContain("You review.");
      expect(hooks.tool?.atlante_skill).toBeDefined();
    },
  );

  test("fails open for missing artifacts", async () => {
    const dir = tempDir();
    await expectPluginFailsOpen(dir);
  });

  test("fails open for corrupt artifacts", async () => {
    const dir = builtProject(validWithSkill);
    writeFileSync(join(dir, ".atlante", "artifacts", "manifest.json"), "{");
    await expectPluginFailsOpen(dir);
  });

  test.each(["format", "version"] as const)(
    "fails open for unsupported manifest %s",
    async (field) => {
      const dir = builtProject(validWithSkill);
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
      const dir = builtProject(validWithSkill);
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
      const dir = builtProject(validWithSkill);
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
    const dir = builtProject(validWithSkill);
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
    const dir = builtProject(validWithSkill);
    const agent = manifestAt(dir).agents[0];
    if (!agent) throw new Error("test fixture has no agent");
    writeFileSync(
      join(dir, ".atlante", "artifacts", ...agent.path.split("/")),
      "changed payload",
    );

    await expectPluginFailsOpen(dir);
  });

  test("fails open for unsafe artifacts", async () => {
    const dir = builtProject(valid);
    const manifestPath = join(dir, ".atlante", "artifacts", "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      agents: [{ path: string }];
    };
    manifest.agents[0].path = "../unsafe.md";
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await expectPluginFailsOpen(dir);
  });

  test("fails open for symlinked payloads", async () => {
    const dir = builtProject(validWithSkill);
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
    const dir = builtProject(valid);
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

    expect(errors).toEqual([expect.stringContaining("[prompt-replaced]")]);
    expect(config.agent?.reviewer).toMatchObject({
      model: "host-model",
      mode: "primary",
      prompt: expect.stringContaining("You review."),
      description: "Reviews changes.",
    });
    expect(config.permission).toEqual({ edit: "allow" });
  });

  test("stages injection so an adapter failure cannot partially mutate config", async () => {
    const dir = builtProject(validWithSkill);
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
    const dir = builtProject(`{
      "$schema": "${SCHEMA_URI}",
      "agents": {},
      "skills": {
        "testing": {
          "description": "Testing guidance",
          "title": "Testing",
          "overview": "Testing guidance",
          "sections": [{ "markdown": "Run tests." }]
        }
      }
    }`);
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

  test("leaves the host config untouched when commit assignment fails", async () => {
    const dir = builtProject(validWithSkill);
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
    const dir = builtProject(validWithSkill);
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
    const dir = builtProject(validWithSkill);
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

  test("proves production imports stop at the artifact reader and host adapter", () => {
    const sourceFiles = readdirSync(new URL("../src", import.meta.url))
      .filter((file) => file.endsWith(".ts"))
      .sort();
    const forbidden =
      /@atlante\/(?:resources|presets|templates|validator)|(?:^|\/)[^/]*(?:loader|resolver|resolve|resource|template|preset)[^/]*\.js$/;

    for (const file of sourceFiles) {
      const source = readFileSync(
        new URL(`../src/${file}`, import.meta.url),
        "utf8",
      );
      const modules = [
        ...source.matchAll(
          /(?:from\s+|import\s*\(\s*|require\s*\(\s*|\bimport\s+)["']([^"']+)["']/g,
        ),
      ].map(([, module]) => module);

      expect(
        modules.filter((module) => module && forbidden.test(module)),
        `${file} imports source-content code`,
      ).toEqual([]);
      expect(
        modules.filter((module) => module?.startsWith("@atlante/")),
        `${file} imports a private package directly`,
      ).toEqual(file === "plugin.ts" ? ["@atlante/builder/artifacts"] : []);
      expect(source).not.toMatch(
        /@atlante\/(?:resources|presets|templates|validator)/,
      );
    }
  });
});
