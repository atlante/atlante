#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const issue = process.argv[2];

async function maybeAdjustModels(target: string): Promise<void> {
  if (!process.stdin.isTTY) {
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      "Keep the default models copied from the main checkout? [Y/n] ",
    );
    if (["n", "no"].includes(answer.trim().toLowerCase())) {
      const editor = process.env.EDITOR || "vi";
      const result = spawnSync(editor, [target], { stdio: "inherit" });
      if (result.status !== 0) {
        console.warn(`Could not open ${editor}; edit ${target} manually.`);
      }
    }
  } finally {
    rl.close();
  }
}

let title: string | undefined;

if (issue) {
  const view = await $`gh issue view ${issue} --json title --jq .title`
    .nothrow()
    .quiet()
    .cwd(root);
  if (view.exitCode !== 0) {
    const reason = view.stderr.toString().trim();
    console.error(`Issue #${issue} not found${reason ? `: ${reason}` : ""}`);
    process.exit(1);
  }
  title = view.stdout.toString().trim();
}

const slug = issue ? `issue-${issue}` : `ws-${randomBytes(4).toString("hex")}`;
const worktree = join(root, ".worktrees", slug);

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
  await $`git worktree add ${worktree} -b ${slug} ${branch}`.cwd(root);

  const models = join(root, ".opencode", "models.json");
  if (existsSync(models)) {
    await mkdir(join(worktree, ".opencode"), { recursive: true });
    const worktreeModels = join(worktree, ".opencode", "models.json");
    await copyFile(models, worktreeModels);
    await maybeAdjustModels(worktreeModels);
  }

  await $`bun i`.cwd(worktree);
  await $`bun run build`.cwd(worktree);
  await $`bun run cli build`.cwd(worktree);
}

const suffix = title ? ` for issue #${issue} (${title})` : "";
console.log(`Worktree ready${suffix}: ${worktree} (branch ${slug})`);
console.log(`Next: cd .worktrees/${slug} && opencode`);
