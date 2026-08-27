---
title: Installation
description: Install the Atlante CLI with npx, npm, or a global command.
---

Atlante requires [Node.js](https://nodejs.org/) 22 or later. Choose the
installation style that matches how your project manages command-line tools.

## Run with npx

Use `npx` when you want to run the published CLI without managing a global
installation:

```sh
npx @atlante/cli init
```

The command uses the published package and its first-party pack. It does not
install project dependencies referenced by your configuration.

## Add it to a project

Install the CLI as a development dependency when you want the project to pin
the tool version:

```sh
npm install --save-dev @atlante/cli
npx atlante init
```

You can use the equivalent command from another package manager. The repository
uses Bun for development, but the published CLI runs on Node.js.

## Install globally

A global installation provides the bare `atlante` command:

```sh
npm install --global @atlante/cli
atlante --version
atlante init
```

## Choose a preset

`init` uses the default `@atlante/pack` preset. Select another already-installed
package preset with `--preset`:

```sh
npm install --save-dev @acme/review-pack
npx @atlante/cli init --preset @acme/review-pack/strict
```

The selected package must already be declared and installed. Atlante does not
install packages, consult a registry, or load remote content.

:::caution
Version 0.1 supports the OpenCode host adapter. It does not select host model,
permission, tool, or mode settings.
:::
