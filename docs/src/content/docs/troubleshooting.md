---
title: Troubleshooting
description: Diagnose configuration discovery, resource resolution, validation, and artifact problems.
---

Use the command output as the starting point. Atlante reports a stable diagnostic
code, a source or location, the expected contract, and a recovery action when
those details are available.

## No configuration found

If the CLI reports `config-not-found`, run it from the project root or pass the
explicit configuration path:

```sh
npx @atlante/cli validate ./path/to/atlante.jsonc
```

The supported filenames are exactly `atlante.jsonc` and `atlante.json`.

## Both configuration files exist

If the CLI reports `ambiguous-config`, remove the file that is not authoritative
or pass an explicit path. Atlante never chooses between both files silently.

## A selected resource is missing

Check the locator and its containing file. Relative locators begin with `./` or
`../`; package locators use the package name and optional POSIX subpath.

```sh
npm install --save-dev @acme/review-pack
npx @atlante/cli validate
```

The package must be declared and installed before the CLI can resolve it.

## Template input is rejected

The selected template owns fields after `description`, `$template`, `$instance`,
and `values`. Read its `template.jsonc` schema and remove unsupported fields or
supply the required input. A binding cannot use `$template` and `$instance`
together.

## Values are not replaced

Check the spelling of each `{{values.key}}` reference and confirm that the key is
present in the global or binding-local `values` map. Values are strings, and a
missing reference is an error before rendering.

## OpenCode has no updated agent

Run a successful build first:

```sh
npx @atlante/cli validate
npx @atlante/cli build
```

Then confirm that `opencode.jsonc` registers `@atlante/opencode`. The adapter
reads only `.atlante/artifacts/`; it does not load the source configuration.

## Artifacts are absent or rejected

A missing artifact tree means the project has not completed a build. A malformed
or changed tree is rejected by the fail-closed reader. Re-run `atlante build`
after fixing the source and keep `.atlante/` local.

## Build after edits

Run `npx @atlante/cli build` after changing `atlante.jsonc`, local resources, or
selected pack content. Use `--watch` during active editing to rebuild the
selected dependency graph automatically.
