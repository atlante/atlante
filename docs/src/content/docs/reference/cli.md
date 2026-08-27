---
title: CLI
description: Command reference for init, validate, and build.
---

The published package is `@atlante/cli`. It requires Node.js 22 or later.

```sh
npx @atlante/cli --help
npx @atlante/cli --version
```

## `atlante init`

Scaffold a project configuration, register the OpenCode adapter, and build the
initial artifacts.

```sh
npx @atlante/cli init [path]
npx @atlante/cli init [path] --preset <package-locator>
npx @atlante/cli init [path] --force
```

- `path` is a project directory and defaults to the current directory.
- `--preset <locator>` selects the preset to extend instead of the default `@atlante/pack`.
- `--force` overwrites an existing `atlante.jsonc` and removes the alternate `atlante.json`.

`init` validates the selected preset before changing files. It creates or updates
`opencode.jsonc` without replacing existing host settings and runs a build.

## `atlante validate`

Validate the source document, selected resources, template schemas, values, and
template-owned input without rendering or publishing artifacts.

```sh
npx @atlante/cli validate [path]
```

`path` can be a project directory or an explicit `atlante.jsonc` or
`atlante.json` file. It defaults to the current directory.

A successful command prints:

```text
validated atlante.jsonc
```

## `atlante build`

Validate, render, and atomically publish host-neutral artifacts.

```sh
npx @atlante/cli build [path]
npx @atlante/cli build [path] --watch
```

`--watch` keeps the process running and rebuilds when the selected configuration
or resources change. See [watch for changes](/guides/watch-mode/).

A successful command prints:

```text
built .atlante/artifacts
```

## Exit status

- `0` means the command completed without errors.
- `1` means validation or build failed.

Warnings do not make a successful build fail. A failed build publishes no partial
artifact tree.

## Path behavior

When a path is a directory, Atlante discovers `atlante.jsonc` or `atlante.json`.
When a path is one of those files, Atlante reads it directly. If both files are
present in a discovered project, the CLI reports `ambiguous-config` rather than
choosing one silently.
