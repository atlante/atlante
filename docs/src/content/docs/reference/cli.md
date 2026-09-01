---
title: CLI
description: Command reference for init, validate, and build.
---

The published package is `@atlante/cli`. It requires [Node.js](https://nodejs.org/)
22 or later. The published CLI bundles the first-party `@atlante/pack`; users do
not need to install that Pack separately for the default preset.

```sh
npx @atlante/cli@latest --help
npx @atlante/cli@latest --version
```

## `atlante init`

Scaffold a project configuration, register the [OpenCode](https://opencode.ai/)
adapter, and build the initial artifacts.

```sh
npx @atlante/cli@latest init [path]
npx @atlante/cli@latest init [path] --pack <pack-locator>
npx @atlante/cli@latest init [path] --pack <pack>/<preset>
npx @atlante/cli@latest init [path] --force
```

- `path` is a project directory and defaults to the current directory.
- `--pack <locator>` selects a pack to install and extend instead of the bundled default `@atlante/pack`. The locator subpath names a preset explicitly, e.g. `@acme/review-pack/strict`.
- `--force` overwrites an existing `atlante.jsonc` and removes the alternate `atlante.json`.

`init` validates the selected preset before changing files. It creates or updates
`opencode.jsonc` (reusing an existing `opencode.json` when present) without
replacing existing host settings and runs a build.

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
template-owned input without rendering or publishing artifacts.

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

Validate, render, and atomically publish host-neutral artifacts under
`<project>/.atlante/artifacts/`.

```sh
npx @atlante/cli@latest build [path]
npx @atlante/cli@latest build [path] --watch
```

A successful one-shot command prints the resolved artifact directory:

```text
built /Users/example/project/.atlante/artifacts
```

### Watch behavior

`--watch` performs an initial build, keeps the process running, and rebuilds when
the selected configuration or resources change. It follows the supported config
filenames, selected resource files and manifests, transitive files, trusted Pack
roots, and safe unresolved parent directories. It does not watch unrelated
resource siblings.

A successful rebuild publishes a complete new artifact tree. A validation or
build failure reports a diagnostic, leaves the last complete artifact tree in
place, and keeps the watcher running. The watcher retries when a later change
arrives. Stop it with `Ctrl-C`.

## Exit status

- `0` means the command completed without errors. In watch mode, interruption also produces exit status `0`.
- `1` means validation or build failed for a one-shot command.

Warnings do not make a successful build fail. A failed build publishes no partial
artifact tree. Watch-mode failures are reported while the process remains active
and do not end the watch process or change its eventual exit status when it is
stopped.

## Path behavior

When a path is a directory, Atlante discovers `atlante.jsonc` or `atlante.json`.
When a path is one of those files, Atlante reads it directly. If both files are
present in a discovered project, the CLI reports `ambiguous-config` rather than
choosing one silently. Validation and build success lines report resolved
filesystem paths, even when the command received a relative path.
