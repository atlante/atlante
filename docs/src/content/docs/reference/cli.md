---
title: CLI
description: Command reference for init, validate, build, and eval.
---

The `@atlante/cli` package provides the `atlante` command and requires
[Node.js](https://nodejs.org/) 22 or later. It includes the first-party
`@atlante/pack`, so the default preset needs no separate pack installation.

Examples use a [project-local installation](/getting-started#use-a-project-local-cli):

```sh
npx atlante --help
npx atlante --version
```

For a one-off invocation, replace `npx atlante` with
`npx @atlante/cli@latest`. This requests the latest release rather than the
version installed in your project.

## Output

CLI output is styled on interactive terminals: severity and success lines are
colored, and `atlante eval` progress lines render gray. Set `NO_COLOR=1` to
disable color. Piped or redirected streams also use plain text.

## `atlante init`

Create a project configuration, add generated-output entries to `.gitignore`,
and build the initial native files.

```sh
npx atlante init [path]
npx atlante init [path] --pack <pack-locator>
npx atlante init [path] --pack <pack>/<preset>
npx atlante init [path] --force
```

- `path` is a project directory and defaults to the current directory.
- `--pack <locator>` selects a package pack instead of the bundled default `@atlante/pack`. An optional subpath names a preset, such as `@acme/review-pack/strict`. Local filesystem paths are not accepted by this option.
- `--force` overwrites an existing `atlante.jsonc` and removes the alternate `atlante.json`.

`init` validates the selected preset before writing the configuration. It ensures
`.gitignore` contains `.opencode/agents/`, `.opencode/skills/`, and
`.atlante/` without reordering existing content, then runs a build. Existing
OpenCode configuration is preserved.

### Pack installation

Selecting a custom package pack requires a `package.json` in the target
project. Installation is part of initialization and can change dependencies
before preset validation:

- An undeclared pack is installed and added to `devDependencies`. A declared
  pack missing from `node_modules` triggers a package-manager install. A pack
  already declared and installed is reused. The bundled first-party pack
  needs no installation.
- A recognized `packageManager` field takes precedence over lockfile
  detection. Otherwise, the nearest lockfile directory determines the manager:
  `bun.lockb` or `bun.lock` selects Bun, `pnpm-lock.yaml` selects pnpm, and
  `yarn.lock` selects Yarn, in that order. npm is the fallback.
- Installing a custom pack delegates to the project's package manager and may
  run package install scripts. The pack must resolve from the init directory's
  own `node_modules`; if a workspace
  hoists it to a shared root, run `init` from the workspace root.
- The package manager records the installed version in the lockfile. Keep the
  lockfile with the project to reproduce that dependency selection.
- The pack's presets are discovered by convention: the pack root is the
  default preset, and any directory below it that contains `atlante.jsonc` or
  `atlante.json` is a named preset. Selecting `--pack @acme/pack` picks the
  only preset automatically and prompts when the pack provides several;
  when several presets are available, non-interactive terminals require an
  explicit selection such as `--pack @acme/pack/<preset>`.
- Initialization is transactional: a failure after the snapshot — including an
  aborted prompt — rolls back the configuration files and restores
  `package.json` and the lockfile. If the rollback itself fails, `init`
  reports `rollback-failed` with manual instructions.

:::caution
Use `--pack` only with packages you trust. Custom pack installation can run
package-manager install scripts before Atlante validates the installed pack or
selects a preset.
:::

## `atlante validate`

Validate the source document, selected resources, template schemas, values, and
template-owned input without rendering or materializing anything.

```sh
npx atlante validate [path]
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
npx atlante build [path]
npx atlante build [path] --watch
```

A successful one-shot command lists written paths, then removed paths, for
each host. The final line reports the resolved project path:

```text
wrote opencode: .opencode/agents/architect.md
removed opencode: .opencode/skills/obsolete/SKILL.md
built /Users/example/project
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
npx atlante eval [path]
npx atlante eval [path] --scenario cli-happy
npx atlante eval [path] --trials 3
npx atlante eval [path] --json
npx atlante eval [path] --out /tmp/eval-runs
npx atlante eval [path] --keep
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

During a run, progress events stream to stderr:

```text
== cli-happy
trial 0 running...
trial 0: pass (98.5s · $0.0123 · 9860 tokens)
cli-happy: 1/1 trials passed
```

stdout contains the final summary, or the report JSON with `--json`. The
human summary includes the run ID, host and model, budget warnings,
per-scenario statistics, and report location.

Redirecting stderr with `2>/dev/null` suppresses progress, but also hides
warnings and diagnostics written to that stream.

## Exit status

- `0` means the command completed without errors. In watch mode, interruption also produces exit status `0`.
- `1` means validation or build failed for a one-shot command.

Eval has its own exit statuses; see [Eval](/reference/eval#reports-and-exit-status).

Warnings do not make a successful build fail. Publication failures follow the
[restoration contract](/reference/materialization#publication-contract).
Watch-mode failures leave the process active and do not change its exit
status when it is stopped.

## Path behavior

When a path is a directory, Atlante discovers `atlante.jsonc` or `atlante.json`.
When a path is one of those files, Atlante reads it directly. If both files are
present in a discovered project, the CLI reports `ambiguous-config` rather than
choosing one silently. Validation and build success lines report resolved
filesystem paths, even when the command received a relative path.

## Next steps

- [Configuration](/concepts/configuration) explains the source document.
- [Materialization](/reference/materialization) documents native output paths
  and ownership rules.
- [Diagnostics](/reference/diagnostics) explains structured failures.
