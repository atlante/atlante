---
title: CLI
description: Command reference for init, validate, build, and eval.
---

The published package is `@atlante/cli`. It requires [Node.js](https://nodejs.org/)
22 or later. The published CLI bundles the first-party `@atlante/pack`; users do
not need to install that Pack separately for the default preset.

```sh
npx @atlante/cli@latest --help
npx @atlante/cli@latest --version
```

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
`.atlante/` (existing content is never reordered), removes an Atlante-written
`@atlante/opencode` plugin registration from `opencode.jsonc` (or an existing
`opencode.json`) while preserving every other host setting, and runs a build.
When no registration exists, it prints `no @atlante/opencode plugin
registration found …`.

### Pack installation

With `--pack`, installation is part of initialization:

- A pack that is not declared yet is installed with the project's package
  manager, detected from the lockfile (`bun.lockb`/`bun.lock` → bun,
  `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm; npm
  is the fallback when no lockfile exists), and declared in `devDependencies`.
- Installation is skipped for the bundled first-party pack and for packs that
  are already declared in `dependencies`, `optionalDependencies`, or
  `devDependencies` (`peerDependencies` does not resolve and always gains a
  dev dependency). Existing declarations are never moved between dependency
  groups or replaced; a declared-but-uninstalled pack is reconciled with a
  plain package manager install.
- The pack's presets are discovered by convention: the pack root is the
  default preset, and any directory below it that contains `atlante.jsonc` or
  `atlante.json` is a named preset. Selecting `--pack @acme/pack` picks the
  only preset automatically and prompts when the pack provides several;
  non-interactive terminals must pass the preset explicitly as
  `--pack @acme/pack/<preset>`.
- Initialization is transactional: a failure after the snapshot — including an
  aborted prompt — rolls back the configuration files and restores
  `package.json` and the lockfile. When the pack was newly added, the detected
  package manager install is re-run to reconcile `node_modules` (a plain
  install leaves the state already reconciled). If that reconciliation fails,
  `init` reports `rollback-failed` with manual instructions.

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

`--watch` performs an initial build, keeps the process running, and rebuilds when
the selected configuration or resources change. It follows the supported config
filenames, selected resource files and manifests, transitive files, trusted Pack
roots, and safe unresolved parent directories. It does not watch unrelated
resource siblings.

A successful rebuild materializes the updated native outputs. A validation or
build failure reports a diagnostic, leaves the previous valid generated set in
place, and keeps the watcher running. The watcher retries when a later change
arrives. Stop it with `Ctrl-C`.

## `atlante eval`

Run eval scenarios against the project's verified native OpenCode outputs. Each
trial runs the [OpenCode](https://opencode.ai/) host headless in a disposable
sandbox (a copy of the scenario fixture plus the materialized native agent and
skill files), then grades the sandbox with deterministic, zero-LLM checks.

Containment is tool-level policy, not OS-level isolation: forced permission
denials close the host's web/search tools and the most destructive shell
commands, and the trial process inherits only an allowlisted environment
(your shell secrets stay with the host). The host's shell tool still has
ordinary user access to the network and machine, so only run scenarios whose
fixture content you trust.

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
  Warnings (for example an unmonitored token budget) go to stderr in this
  mode; a trial whose host emitted no usage events carries
  `budgetUnmonitored: true`, meaning `maxTokens` could not be enforced and
  only the trial timeout bounded spend.
- `--out <dir>` writes the report under the given directory instead of
  `<project>/.atlante/eval`.
- `--keep` preserves the trial sandboxes for inspection instead of deleting
  them.

### Configuration

`eval` runs require an `eval` section in `atlante.jsonc`, scenario documents,
materialized native OpenCode outputs, and an authenticated OpenCode host:

```jsonc
{
  "eval": {
    "host": "opencode",
    // Scenario documents may be .json or .jsonc; a trailing star matches both.
    "scenarios": "eval/scenarios/*.eval.json*",
    "model": "anthropic/claude-sonnet-4-5",
    "budget": {
      "trials": 3,
      "timeoutMs": 600000,
      "maxSessions": 15,
      "maxTokens": 400000
    }
  }
}
```

Scenario documents validate against
[`https://atlante.sh/schema/v0.1/eval-scenario.json`](https://atlante.sh/schema/v0.1/eval-scenario.json).
Each names a fixture directory copied as the sandbox root, a prompt, and at
least one check (`command`, `file-exists`, `file-absent`, `file-contains`,
`file-unchanged`, `diff-allowlist`; the diff scan ignores paths under the
host-owned `.opencode/` directory, where the host installs runtime artifacts
during the session). Fixtures must not ship host-owned files:
a fixture `.opencode` file colliding with a native output fails the trial with
a rename-or-remove diagnostic, and a fixture `opencode.jsonc` is rejected
because OpenCode would prefer it over the generated `opencode.json` (which
always wins over a fixture-provided `opencode.json`). The report is written to
`<project>/.atlante/eval/<run-id>/report.json`; that location is gitignored.
`atlante eval` never builds: run `atlante build` first, and again whenever the
sources change.

### Exit status

- `0` every executed trial passed.
- `1` at least one trial failed, timed out, exceeded its budget, hit a
  trial-level infrastructure error, or was skipped by the session cap.
- `2` validation failed: missing or broken configuration or `eval` section,
  invalid scenario documents, or missing/stale native outputs.
- `3` an infrastructure error prevented the run from executing at all —
  including an unauthenticated host, which is reported before any trial runs;
  when a run ID exists, the partial report is still written before the error
  is returned.

## Exit status

- `0` means the command completed without errors. In watch mode, interruption also produces exit status `0`.
- `1` means validation or build failed for a one-shot command.

`atlante eval` has its own, finer-grained exit statuses; see
[`atlante eval`](#atlante-eval) above.

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
