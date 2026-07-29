import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "@atlante/resolver";
import { SCHEMA_URI } from "@atlante/schema";
import { loadBundledTemplates } from "@atlante/templates";
import { expandDocument, loadDocument } from "@atlante/validator";
import type { Config, PluginInput } from "@opencode-ai/plugin";
import type { HostConfig } from "../src/api.js";
import { AtlantePlugin, createAtlantePlugin } from "../src/plugin.js";

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

afterEach(() => {
  for (const dir of created.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const valid = `{
  "$schema": "${SCHEMA_URI}",
  "agents": {
    "reviewer": { "identity": "You review.", "mission": "Find defects." }
  }
}`;

const validWithSkill = `{
  "$schema": "${SCHEMA_URI}",
  "agents": {
    "reviewer": { "identity": "You review.", "mission": "Find defects." }
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

/**
 * The `config` hook only reads `directory` off its input; the remaining
 * `PluginInput` fields are OpenCode runtime plumbing (SDK client, project
 * metadata, workspace registration) the plugin never touches.
 */
function pluginInput(directory: string): PluginInput {
  return { directory } as PluginInput;
}

/** Runs `fn` with `console.error` silenced, always restoring it afterwards. */
async function silently<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
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
  test("prepares once before returning hooks and activates the skill after config commit", async () => {
    const dir = project(validWithSkill);
    const calls = { load: 0, templates: 0, expand: 0, resolve: 0 };
    const plugin = createAtlantePlugin({
      loadDocument: (path) => {
        calls.load += 1;
        return loadDocument(path);
      },
      loadBundledTemplates: () => {
        calls.templates += 1;
        return loadBundledTemplates();
      },
      expandDocument: (overlay, presets) => {
        calls.expand += 1;
        return expandDocument(overlay, presets);
      },
      resolve: (document, registry) => {
        calls.resolve += 1;
        return resolve(document, registry);
      },
    });

    const hooks = await plugin(pluginInput(dir));
    expect(calls).toEqual({ load: 0, templates: 1, expand: 1, resolve: 1 });
    const skillTool = hooks.tool?.atlante_skill;
    expect(skillTool).toBeDefined();
    await expect(
      skillTool?.execute({ name: "testing" }, {} as never),
    ).rejects.toThrow("inactive");

    const config: HostConfig = {};
    await hooks.config?.(config as unknown as Config);
    expect(calls).toEqual({ load: 0, templates: 1, expand: 1, resolve: 1 });
    expect(config.agent?.reviewer?.prompt).toContain("You review.");
    await hooks.config?.({} as Config);
    expect(calls).toEqual({ load: 0, templates: 1, expand: 1, resolve: 1 });
    await expect(
      skillTool?.execute({ name: "testing" }, {} as never),
    ).resolves.toBe(
      "# Testing\n\n## Overview\n\nTesting guidance\n\nRun tests.\n",
    );
  });

  test("does nothing when no atlante configuration exists", async () => {
    const dir = tempDir();
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);

    const hooks = await AtlantePlugin(pluginInput(dir));
    await hooks.config?.(config as unknown as Config);

    expect(config).toEqual(before);
  });

  test("leaves the host config untouched when the document is invalid", async () => {
    const dir = project(`{ "$schema": "${SCHEMA_URI}" }`);
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);

    await silently(async () => {
      const hooks = await AtlantePlugin(pluginInput(dir));
      expect(hooks.tool).toBeUndefined();
      await hooks.config?.(config as unknown as Config);
    });

    expect(config).toEqual(before);
  });

  test("does not reject when preparation diagnostic reporting throws", async () => {
    const dir = project(`{ "$schema": "${SCHEMA_URI}" }`);
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);
    const originalError = console.error;
    let rejected = false;
    console.error = () => {
      throw new Error("report failure");
    };
    try {
      const hooks = await AtlantePlugin(pluginInput(dir));
      expect(hooks.tool).toBeUndefined();
      await hooks.config?.(config as unknown as Config);
    } catch {
      rejected = true;
    } finally {
      console.error = originalError;
    }

    expect(rejected).toBe(false);
    expect(config).toEqual(before);
  });

  test("leaves the host config untouched when the configuration is ambiguous", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "atlante.jsonc"), valid);
    writeFileSync(join(dir, "atlante.json"), valid);
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);

    await silently(async () => {
      const hooks = await AtlantePlugin(pluginInput(dir));
      await hooks.config?.(config as unknown as Config);
    });

    expect(config).toEqual(before);
  });

  test("leaves the host config untouched when template-level validation fails", async () => {
    // Document-valid (passes the loose zod schema) but missing the "mission"
    // field the atlante/agent template's inputSchema requires: this fails
    // inside resolve(), not inside loadDocument().
    const dir = project(
      `{ "$schema": "${SCHEMA_URI}", "agents": { "a": { "identity": "x" } } }`,
    );
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);

    await silently(async () => {
      const hooks = await AtlantePlugin(pluginInput(dir));
      await hooks.config?.(config as unknown as Config);
    });

    expect(config).toEqual(before);
  });

  test("leaves the host config untouched when template loading fails", async () => {
    const dir = project(valid);
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);

    // The real bundled templates directory is always valid, so the
    // template-load-error path can only be exercised through the deps seam
    // (see createAtlantePlugin's docstring for why this isn't a module mock).
    const { loadDocument } = await import("@atlante/validator");
    const plugin = createAtlantePlugin({
      loadDocument,
      loadBundledTemplates: () => ({
        registry: { get: () => undefined, ids: () => [] },
        errors: [{ directory: "/bundled", message: "boom" }],
      }),
    });

    await silently(async () => {
      const hooks = await plugin(pluginInput(dir));
      await hooks.config?.(config as unknown as Config);
    });

    expect(config).toEqual(before);
  });

  test("renders diagnostics with the shared code, location, and path format", async () => {
    const dir = tempDir();
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const plugin = createAtlantePlugin({
      loadDocument: () => ({
        diagnostics: [
          {
            severity: "error",
            code: "diagnostic-probe",
            message: "probe",
            location: { line: 2, column: 3 },
            path: "/agents/agent~1id~0one",
          },
        ],
      }),
      loadBundledTemplates: () => ({
        registry: { get: () => undefined, ids: () => [] },
        errors: [],
      }),
    });

    const output = await capturedErrors(async () => {
      const hooks = await plugin(pluginInput(dir));
      await hooks.config?.(config as unknown as Config);
    });

    expect(output).toEqual([
      "[atlante] error:2:3: [diagnostic-probe] probe at /agents/agent~1id~0one",
    ]);
    expect(config).toEqual({ agent: { existing: { model: "x" } } });
  });

  test("reports unexpected dependency failures without mutating host config", async () => {
    const dir = tempDir();
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);
    const plugin = createAtlantePlugin({
      loadDocument: () => {
        throw new Error("injected loader failure");
      },
      loadBundledTemplates: () => ({
        registry: { get: () => undefined, ids: () => [] },
        errors: [],
      }),
    });

    const output = await capturedErrors(async () => {
      const hooks = await plugin(pluginInput(dir));
      await hooks.config?.(config as unknown as Config);
    });

    expect(output[0]).toContain(
      "[atlante] error: [plugin-runtime-failed] plugin runtime failed: injected loader failure",
    );
    expect(config).toEqual(before);
  });

  test("stages injection so an unexpected adapter failure cannot partially mutate config", async () => {
    const dir = project(valid);
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);
    const { loadDocument } = await import("@atlante/validator");
    const { loadBundledTemplates } = await import("@atlante/templates");
    const plugin = createAtlantePlugin({
      loadDocument,
      loadBundledTemplates,
      injectAgents: (staged) => {
        staged.agent = { partial: { prompt: "partial" } };
        throw new Error("injected adapter failure");
      },
    });

    await capturedErrors(async () => {
      const hooks = await plugin(pluginInput(dir));
      await hooks.config?.(config as unknown as Config);
    });

    expect(config).toEqual(before);
  });

  test("rolls back every top-level change when config assignment fails", async () => {
    const dir = project(validWithSkill);
    const plugin = createAtlantePlugin({
      loadDocument,
      loadBundledTemplates,
      injectAgents: (staged) => {
        staged.first = "new";
        return [];
      },
    });
    const hooks = await plugin(pluginInput(dir));
    const config = { first: "old" } as HostConfig;
    Object.defineProperty(config, "second", {
      configurable: false,
      enumerable: true,
      get: () => "old",
      set: () => {
        throw new Error("commit failure");
      },
    });
    const beforeSecond = Object.getOwnPropertyDescriptor(config, "second");

    await capturedErrors(async () => {
      await hooks.config?.(config as unknown as Config);
    });

    expect(config.first).toBe("old");
    expect(Object.hasOwn(config, "agent")).toBe(false);
    expect(Object.getOwnPropertyDescriptor(config, "second")).toEqual(
      beforeSecond,
    );
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).rejects.toThrow("Atlante skills unavailable");
  });

  test("rolls back the host config when reporting a commit diagnostic fails", async () => {
    const dir = project(validWithSkill);
    const plugin = createAtlantePlugin({
      loadDocument,
      loadBundledTemplates,
    });
    const hooks = await plugin(pluginInput(dir));
    const config: HostConfig = {
      agent: { reviewer: { prompt: "old" } },
    };
    const before = structuredClone(config);
    const originalError = console.error;
    let rejected = false;
    console.error = () => {
      throw new Error("report failure");
    };
    try {
      await hooks.config?.(config as unknown as Config);
    } catch {
      rejected = true;
    } finally {
      console.error = originalError;
    }

    expect(rejected).toBe(false);
    expect(config).toEqual(before);
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).rejects.toThrow("Atlante skills unavailable");
  });

  test("does not recover a failed lifecycle on a later config hook", async () => {
    const dir = project(validWithSkill);
    let injectionCalls = 0;
    const plugin = createAtlantePlugin({
      loadDocument,
      loadBundledTemplates,
      injectAgents: () => {
        injectionCalls += 1;
        if (injectionCalls === 1)
          throw new Error("first materialization failed");
        return [];
      },
    });
    const hooks = await plugin(pluginInput(dir));
    const firstConfig: HostConfig = {};

    await capturedErrors(async () => {
      await hooks.config?.(firstConfig as unknown as Config);
    });
    await hooks.config?.({} as Config);

    expect(injectionCalls).toBe(1);
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).rejects.toThrow("Atlante skills unavailable");
  });

  test("commits an own __proto__ value without changing the config prototype", async () => {
    const dir = project(validWithSkill);
    const plugin = createAtlantePlugin({
      loadDocument,
      loadBundledTemplates,
      injectAgents: (staged) => {
        Object.defineProperty(staged, "__proto__", {
          configurable: true,
          enumerable: true,
          value: { polluted: true },
          writable: true,
        });
        return [];
      },
    });
    const hooks = await plugin(pluginInput(dir));
    const config: HostConfig = {};
    const prototype = Object.getPrototypeOf(config);

    await hooks.config?.(config as unknown as Config);

    expect(Object.getPrototypeOf(config)).toBe(prototype);
    expect(Object.hasOwn(config, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(config, "__proto__")?.value).toEqual(
      { polluted: true },
    );
  });

  test("fails the skill tool when staged injection throws after mutating its clone", async () => {
    const dir = project(validWithSkill);
    const plugin = createAtlantePlugin({
      loadDocument,
      loadBundledTemplates,
      injectAgents: (staged) => {
        staged.agent = { partial: { prompt: "partial" } };
        throw new Error("injected adapter failure");
      },
    });

    const hooks = await plugin(pluginInput(dir));
    const skillTool = hooks.tool?.atlante_skill;
    expect(skillTool).toBeDefined();
    const config: HostConfig = { agent: { existing: { model: "x" } } };
    const before = structuredClone(config);

    await capturedErrors(async () => {
      await hooks.config?.(config as unknown as Config);
    });

    expect(config).toEqual(before);
    await expect(
      skillTool?.execute({ name: "testing" }, {} as never),
    ).rejects.toThrow(
      "Atlante skills unavailable: Error: injected adapter failure",
    );
  });

  test("exposes skills without creating an empty host agent map", async () => {
    const agentHooks = await AtlantePlugin(pluginInput(project(valid)));
    expect(agentHooks.tool).toBeUndefined();

    const skillOnly = project(`{
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
    const hooks = await AtlantePlugin(pluginInput(skillOnly));
    expect(Object.keys(hooks.tool ?? {})).toEqual(["atlante_skill"]);
    expect(hooks.tool?.skill).toBeUndefined();

    const config: HostConfig = { skill: { native: true } };
    await hooks.config?.(config as unknown as Config);
    expect(Object.hasOwn(config, "agent")).toBe(false);
    expect(config.skill).toEqual({ native: true });
    await expect(
      hooks.tool?.atlante_skill?.execute({ name: "testing" }, {} as never),
    ).resolves.toBe(
      "# Testing\n\n## Overview\n\nTesting guidance\n\nRun tests.\n",
    );
  });

  test("injects the expected prompt on a valid project", async () => {
    const dir = project(valid);
    const config: HostConfig = {};

    const hooks = await AtlantePlugin(pluginInput(dir));
    await hooks.config?.(config as unknown as Config);

    expect(config.agent?.reviewer?.prompt).toContain("You review.");
  });

  test("materializes the starter agent and exposes the workflow skill", async () => {
    const dir = project(`{
      "$schema": "${SCHEMA_URI}",
      "extends": "atlante/starter",
      "values": {
        "quick-check": "bun test packages/changed",
        "full-check": "bun test"
      }
    }`);
    const config: HostConfig = {
      agent: { architect: { model: "provider/model" } },
    };

    const hooks = await AtlantePlugin(pluginInput(dir));
    await hooks.config?.(config as unknown as Config);

    expect(config.agent?.architect?.model).toBe("provider/model");
    expect(config.agent?.architect?.prompt).toContain("lead engineer");
    expect(config.agent?.implement).toBeUndefined();
    const workflow = await hooks.tool?.atlante_skill?.execute(
      { name: "workflow" },
      {} as never,
    );
    if (typeof workflow !== "string")
      throw new Error("workflow skill did not return Markdown");
    expect(workflow).toContain("### 1. plan");
    expect(
      workflow.match(/The orchestrator handles this phase\./g),
    ).toHaveLength(3);
    expect(workflow).toContain(
      "After each task, run and record a quick check with `bun test packages/changed`, including after any correction round.",
    );
    expect(workflow).toContain(
      "After all tasks and the whole-change review, run and record the full check with `bun test`.",
    );
    expect(workflow).toContain("### 3. review");
    expect(workflow).toContain(
      "Dispatch a fresh reviewer with only that context; do not rely on the coordinator's session history or substitute a self-review.",
    );
    expect(workflow).toContain(
      "The artifact should be stored at .atlante/review-<issue-number>.md.",
    );
    const brainstorming = await hooks.tool?.atlante_skill?.execute(
      { name: "brainstorming" },
      {} as never,
    );
    if (typeof brainstorming !== "string")
      throw new Error("brainstorming skill did not return Markdown");
    expect(brainstorming).toContain(
      "Do not begin workflow, implementation, or file modifications until the presented design is approved by the developer.",
    );
    expect(brainstorming.indexOf("## Constraints")).toBeLessThan(
      brainstorming.indexOf("## Instructions"),
    );
  });

  test("preserves host-owned fields on an existing agent", async () => {
    const dir = project(valid);
    const config: HostConfig = {
      agent: { reviewer: { model: "anthropic/claude-sonnet-5" } },
    };

    const hooks = await AtlantePlugin(pluginInput(dir));
    await hooks.config?.(config as unknown as Config);

    expect(config.agent?.reviewer?.model).toBe("anthropic/claude-sonnet-5");
    expect(config.agent?.reviewer?.prompt).toContain("You review.");
  });
});
