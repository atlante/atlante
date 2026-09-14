import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import modelsPlugin from "../models";

const MODEL = "zai-coding-plan/glm-5.3-flash";
const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const createProject = async () => {
  const directory = await mkdtemp(join(tmpdir(), "atlante-model-plugin-"));
  createdDirectories.push(directory);
  return directory;
};

const loadPlugin = (directory: string) =>
  modelsPlugin({ directory, worktree: directory } as Parameters<
    typeof modelsPlugin
  >[0]);

type TestConfig = { agent: Record<string, Record<string, unknown>> };

const baseConfig = (): TestConfig => ({
  agent: {
    atlante: { mode: "primary" },
    general: { model: "opencode/default-general" },
    explore: { model: "opencode/default-explore" },
  },
});

test("generates an atlante-only Z.ai model override", async () => {
  const directory = await createProject();
  const hooks = await loadPlugin(directory);

  expect(
    JSON.parse(
      await readFile(join(directory, ".opencode/models.json"), "utf8"),
    ),
  ).toEqual({
    atlante: { model: MODEL, reasoningEffort: "high" },
  });

  const config = baseConfig();
  await hooks.config?.(config as never);

  expect(config.agent).toEqual({
    atlante: {
      mode: "primary",
      model: MODEL,
      variant: "high",
      options: { reasoningEffort: "high" },
    },
    general: { model: "opencode/default-general" },
    explore: { model: "opencode/default-explore" },
  });
});

test("still applies explicitly configured sub-agent overrides", async () => {
  const directory = await createProject();
  await mkdir(join(directory, ".opencode"));
  await writeFile(
    join(directory, ".opencode", "models.json"),
    JSON.stringify({
      general: { model: MODEL, reasoningEffort: "max" },
      explore: { model: MODEL, reasoningEffort: "max" },
    }),
  );

  const hooks = await loadPlugin(directory);
  const config = baseConfig();
  await hooks.config?.(config as never);

  expect(config.agent.general).toEqual({
    model: MODEL,
    variant: "max",
    options: { reasoningEffort: "max" },
  });
  expect(config.agent.explore).toEqual({
    model: MODEL,
    variant: "max",
    options: { reasoningEffort: "max" },
  });
});

test("preserves an explicitly configured atlante override", async () => {
  const directory = await createProject();
  await mkdir(join(directory, ".opencode"));
  await writeFile(
    join(directory, ".opencode", "models.json"),
    JSON.stringify({
      atlante: { model: MODEL, reasoningEffort: "max" },
    }),
  );

  const hooks = await loadPlugin(directory);
  const config = baseConfig();
  await hooks.config?.(config as never);

  expect(config.agent.atlante).toEqual({
    mode: "primary",
    model: MODEL,
    variant: "max",
    options: { reasoningEffort: "max" },
  });
});
