---
title: CLI
description: Command reference for init, validate, and build.
---

The published package is `@atlante/cli`. It requires [Node.js](https://nodejs.org/)
22 or later. The published CLI bundles the first-party `@atlante/pack`; users do
not need to install that Pack separately for the default preset.

```sh
npx @atlante/cli --help
npx @atlante/cli --version
```

## `atlante init`

Scaffold a project configuration, register the [OpenCode](https://opencode.ai/)
adapter, and build the initial artifacts.

```sh
npx @atlante/cli init [path]
npx @atlante/cli init [path] --preset <package-locator>
npx @atlante/cli init [path] --force
```

- `path` is a project directory and defaults to the current directory.
- `--preset <locator>` selects a resolvable preset instead of the bundled default `@atlante/pack`.
- `--force` overwrites an existing `atlante.jsonc` and removes the alternate `atlante.json`.

`init` validates the selected preset before changing files. It creates or updates
`opencode.jsonc` without replacing existing host settings and runs a build. A
custom preset must be declared and installed in the project before it can be
resolved.

## `atlante validate`

Validate the source document, selected resources, template schemas, values, and
template-owned input without rendering or publishing artifacts.

```sh
npx @atlante/cli validate [path]
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
npx @atlante/cli build [path]
npx @atlante/cli build [path] --watch
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
