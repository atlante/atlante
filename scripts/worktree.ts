#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { $ } from "bun";

type Stream = { isTTY?: boolean };

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = process.stdout;
const err = process.stderr;

function paint(stream: Stream, text: string, ...codes: number[]): string {
  if (!stream.isTTY || process.env.NO_COLOR) {
    return text;
  }
  return `\x1b[${codes.join(";")}m${text}\x1b[0m`;
}

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
        console.warn(
          paint(err, `Could not open ${editor}; edit ${target} manually.`, 33),
        );
      }
    }
  } finally {
    rl.close();
  }
}

const arg = process.argv[2];

// An argument naming an existing local branch adopts that branch into a
// worktree; anything else numeric (or #-prefixed) is treated as an issue
// number and creates a new `issue-<n>` branch from the default branch.
let branchArg: string | undefined;
let issue: string | undefined;

if (arg) {
  const ref = await $`git show-ref --verify --quiet refs/heads/${arg}`
    .nothrow()
    .quiet()
    .cwd(root);
  if (ref.exitCode === 0) {
    branchArg = arg;
  } else if (/^#?\d+$/.test(arg)) {
    issue = arg.replace(/^#/, "");
  } else {
    console.error(
      paint(
        err,
        `No local branch \`${arg}\`; pass an issue number or an existing branch name.`,
        1,
        31,
      ),
    );
    process.exit(1);
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
    const detail = reason ? paint(err, `: ${reason}`, 2) : "";
    console.error(`${paint(err, `Issue #${issue} not found`, 1, 31)}${detail}`);
    process.exit(1);
  }
  title = view.stdout.toString().trim();
}

const slug = branchArg
  ? branchArg.replaceAll("/", "-")
  : issue
    ? `issue-${issue}`
    : `ws-${randomBytes(4).toString("hex")}`;
const worktree = join(root, ".worktrees", slug);

if (!existsSync(worktree)) {
  if (branchArg) {
    await $`git worktree add ${worktree} ${branchArg}`.cwd(root);
  } else {
    const { stdout } =
      await $`git symbolic-ref --short refs/remotes/origin/HEAD`
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
  }

  const opencodeDir = join(root, ".opencode");
  const worktreeOpencodeDir = join(worktree, ".opencode");
  const models = join(opencodeDir, "models.json");
  if (existsSync(models)) {
    await mkdir(worktreeOpencodeDir, { recursive: true });
    const worktreeModels = join(worktreeOpencodeDir, "models.json");
    await copyFile(models, worktreeModels);
    await maybeAdjustModels(worktreeModels);
  }

  // Seed the opencode plugin runtime dependencies from the main checkout so
  // the first `opencode` run in the worktree resolves `.opencode/plugin/*`
  // imports locally instead of installing them from the network on startup.
  const pluginDepFiles = ["package.json", "package-lock.json", "bun.lock"];
  const opencodeNodeModules = join(opencodeDir, "node_modules");
  if (
    existsSync(opencodeNodeModules) ||
    pluginDepFiles.some((file) => existsSync(join(opencodeDir, file)))
  ) {
    await mkdir(worktreeOpencodeDir, { recursive: true });
    for (const file of pluginDepFiles) {
      const source = join(opencodeDir, file);
      if (existsSync(source)) {
        await copyFile(source, join(worktreeOpencodeDir, file));
      }
    }
    if (existsSync(opencodeNodeModules)) {
      await cp(opencodeNodeModules, join(worktreeOpencodeDir, "node_modules"), {
        recursive: true,
      });
    }
  }

  await $`bun i`.cwd(worktree);
  await $`bun run build`.cwd(worktree);
  await $`bun run cli build`.cwd(worktree);
}

const suffix = title ? ` for issue #${issue} (${title})` : "";
const ready = paint(out, "Worktree ready", 1, 32);
const branchLabel = paint(out, `(branch ${branchArg ?? slug})`, 2);
console.log(`${ready}${suffix}: ${paint(out, worktree, 36)} ${branchLabel}`);
const next = paint(out, `cd .worktrees/${slug} && opencode`, 36);
console.log(`${paint(out, "Next:", 1)} ${next}`);
