---
title: CLI
description: Command reference for init, validate, build, and eval.
---

The published package is `@atlante/cli`. Use it from the project you want to
configure:

```sh
npx @atlante/cli@latest --help
npx @atlante/cli@latest --version
```

The CLI requires [Node.js](https://nodejs.org/) 22 or later. It bundles the
first-party `@atlante/pack`, so the default preset needs no separate Pack
installation.

## Output

CLI output is styled on interactive terminals: severity and success lines are
colored, and `atlante eval` progress lines render gray. Set `NO_COLOR` or pipe
the output to get plain text.

## `atlante init`

Scaffold a project configuration, enforce the generated-output ignore policy,
and materialize the initial native outputs.

```sh
npx @atlante/cli@latest init [path]
npx @atlante/cli@latest init [path] --pack <pack-locator>
npx @atlante/cli@latest init [path] --pack <pack>/<preset>
npx @atlante/cli@latest init [path] --force
```

- `path` is a project directory and defaults to the current directory.
- `--pack <locator>` selects a pack to install and extend instead of the bundled default `@atlante/pack`. The locator subpath names a preset explicitly, e.g. `@acme/review-pack/strict`.
- `--force` overwrites an existing `atlante.jsonc` and removes the alternate `atlante.json`.

`init` validates the selected preset before changing files. It ensures
`.gitignore` contains `.opencode/agents/`, `.opencode/skills/`, and
`.atlante/` without reordering existing content, does not register or modify a
runtime integration, and runs a build. Existing host configuration remains
host-owned.

### Pack installation

With `--pack`, installation is part of initialization:

- A pack that is not declared yet is installed with the project's package
  manager, detected from the lockfile (`bun.lockb`/`bun.lock` → bun,
  `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm; npm
  is the fallback when no lockfile exists), and declared in
  `devDependencies`. Installation is skipped for the bundled first-party pack
  and for packs that are already declared.
- Installing a custom Pack delegates to the project's package manager and may
  run package install scripts. Use `--pack` only with packages you trust. The
  Pack must resolve from the init directory's own `node_modules`; if a workspace
  hoists it to a shared root, run `init` from the workspace root.
- The first installation records the Pack version in the lockfile, keeping later
  runs reproducible. Keep the lockfile with the project.
- The pack's presets are discovered by convention: the pack root is the
  default preset, and any directory below it that contains `atlante.jsonc` or
  `atlante.json` is a named preset. Selecting `--pack @acme/pack` picks the
  only preset automatically and prompts when the pack provides several;
  non-interactive terminals must pass the preset explicitly as
  `--pack @acme/pack/<preset>`.
- Initialization is transactional: a failure after the snapshot — including an
  aborted prompt — rolls back the configuration files and restores
  `package.json` and the lockfile. If the rollback itself fails, `init`
  reports `rollback-failed` with manual instructions.

## `atlante validate`

Validate the source document, selected resources, template schemas, values, and
template-owned input without rendering or materializing anything.

```sh
npx @atlante/cli@latest validate [path]
```

`path` can be a project directory or an explicit `atlante.jsonc` or
`atlante.json` file. It defaults to the current directory.

A successful command prints the resolved configuration path:

```text
validated /Users/example/project/atlante.jsonc
```

## `atlante build`

Validate, render, and materialize the host-native outputs selected by the
document's `hosts` field.

```sh
npx @atlante/cli@latest build [path]
npx @atlante/cli@latest build [path] --watch
```

A successful one-shot command prints the resolved project path, followed by
one line per file the build wrote or removed:

```text
built /Users/example/project
wrote opencode: .opencode/agents/architect.md
removed opencode: .opencode/skills/obsolete/SKILL.md
wrote opencode: .atlante/opencode-native.json
```

Unchanged files are not rewritten, so an idempotent rebuild prints no `wrote`
or `removed` lines.

### Watch behavior

`--watch` performs an initial build, keeps the process running, and rebuilds
when the selected configuration or any selected resource changes.

A successful rebuild materializes the updated native outputs. A validation or
build failure reports a diagnostic, leaves the previous valid generated set in
place, and keeps the watcher running. The watcher retries when a later change
arrives. Stop it with `Ctrl-C`.

## `atlante eval`

Run scenario documents against the project's verified native OpenCode outputs.
Each trial runs the host in a disposable sandbox and grades the result with
deterministic checks. Eval never builds; run `atlante build` first. See
[Eval](/reference/eval) for the configuration, scenario syntax, checks,
containment rules, and exit statuses.

```sh
npx @atlante/cli@latest eval [path]
npx @atlante/cli@latest eval [path] --scenario cli-happy
npx @atlante/cli@latest eval [path] --trials 3
npx @atlante/cli@latest eval [path] --json
npx @atlante/cli@latest eval [path] --out /tmp/eval-runs
npx @atlante/cli@latest eval [path] --keep
```

- `path` is a project directory or an explicit `atlante.jsonc`/`atlante.json`
  file. It defaults to the current directory.
- `--scenario <name>` runs only the named scenario; repeat the flag to select
  several. Scenario names come from the documents matched by the `eval`
  section's `scenarios` glob.
- `--trials <n>` overrides the configured number of trials for this run.
- `--json` prints the report JSON to stdout instead of the human summary.
  Progress lines still stream to stderr in this mode, so stdout stays pure
  JSON. Warnings (for example an unmonitored token budget) go to stderr too;
  a trial whose host emitted no usage events carries
  `budgetUnmonitored: true`, meaning `maxTokens` could not be enforced and
  only the trial timeout bounded spend.
- `--out <dir>` writes the report under the given directory instead of
  `<project>/.atlante/eval`.
- `--keep` preserves the trial sandboxes for inspection instead of deleting
  them.

### Progress

While a run executes, one human-readable line per event streams to stderr, so
a multi-minute run is never silent:

```text
== cli-happy
trial 0 running...
trial 0: pass (98.5s · $0.0123 · 9860 tokens)
cli-happy: 1/1 trials passed
```

stdout stays reserved for the final summary (or, with `--json`, the report
JSON); progress always goes to stderr, in both modes, so the same trials are
never printed twice. The summary repeats only what the live lines do not
carry: run id, host and model, the budget warning when present,
per-scenario aggregate statistics (pass rate, mean, p95), and the report
location. On an interactive terminal the progress
lines render gray (ANSI bright black) so they do not read like errors; set
`NO_COLOR` or pipe
stderr to get plain text. Redirect stderr (`2>/dev/null`) to silence
progress entirely.

## Exit status

- `0` means the command completed without errors. In watch mode, interruption also produces exit status `0`.
- `1` means validation or build failed for a one-shot command.

Eval has its own exit statuses; see [Eval](/reference/eval#reports-and-exit-status).

Warnings do not make a successful build fail. A failed build materializes no
partial output set. Watch-mode failures are reported while the process remains
active and do not end the watch process or change its eventual exit status when
it is stopped.

## Path behavior

When a path is a directory, Atlante discovers `atlante.jsonc` or `atlante.json`.
When a path is one of those files, Atlante reads it directly. If both files are
present in a discovered project, the CLI reports `ambiguous-config` rather than
choosing one silently. Validation and build success lines report resolved
filesystem paths, even when the command received a relative path.
