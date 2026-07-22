import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_URI } from "@atlante/schema";
import type { Config, PluginInput } from "@opencode-ai/plugin";
import type { HostConfig } from "../src/index.ts";
import { AtlantePlugin, createAtlantePlugin } from "../src/plugin.ts";

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
      await hooks.config?.(config as unknown as Config);
    });

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

  test("injects the expected prompt on a valid project", async () => {
    const dir = project(valid);
    const config: HostConfig = {};

    const hooks = await AtlantePlugin(pluginInput(dir));
    await hooks.config?.(config as unknown as Config);

    expect(config.agent?.reviewer?.prompt).toContain("You review.");
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
