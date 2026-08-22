#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const issue = process.argv[2];

if (!issue) {
  console.error("usage: work <issue-number>");
  process.exit(1);
}

const worktree = join(root, ".worktrees", `issue-${issue}`);

if (!existsSync(worktree)) {
  const { stdout } = await $`git symbolic-ref --short refs/remotes/origin/HEAD`
    .nothrow()
    .quiet()
    .cwd(root);
  const branch =
    stdout
      .toString()
      .trim()
      .replace(/^origin\//, "") || "main";

  await mkdir(join(root, ".worktrees"), { recursive: true });
  await $`git worktree add ${worktree} -b issue-${issue} ${branch}`.cwd(root);

  const models = join(root, ".opencode", "models.json");
  if (existsSync(models)) {
    await mkdir(join(worktree, ".opencode"), { recursive: true });
    await copyFile(models, join(worktree, ".opencode", "models.json"));
  }

  await $`bun i`.cwd(worktree);
  await $`bun run build`.cwd(worktree);
  await $`bun run cli build`.cwd(worktree);
}

const { stdout } = await $`gh issue view ${issue} --json title --jq .title`
  .nothrow()
  .quiet()
  .cwd(root);
const title = stdout.toString().trim();

const result = spawnSync(
  "opencode",
  ["--prompt", `Work on issue #${issue}${title ? `: ${title}` : ""}`],
  {
    cwd: worktree,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
