---
title: Troubleshooting
description: Diagnose configuration discovery, resource resolution, validation, and artifact problems.
---

Start with the diagnostic code in the command output. It identifies the failure,
the source or location, and often the next recovery action.

## The CLI says `config-not-found`

Run the command from the project root or pass the explicit configuration path:

```sh
npx @atlante/cli validate ./path/to/atlante.jsonc
```

The supported filenames are exactly `atlante.jsonc` and `atlante.json`.

## The CLI says `ambiguous-config`

Both supported files are present. Remove the file that is not authoritative or
pass an explicit path. Atlante never chooses between both files silently.

## The CLI says `missing-target`

Check the locator and the file that contains it. Relative locators begin with
`./` or `../`; package locators use the package name and an optional POSIX
subpath. A selected target must exist within its trusted Pack root.

For a custom Pack, check both package diagnostics:

- `package-not-declared` means the package is not declared by the authoring project.
- `package-not-installed` means it is declared but cannot be found in the installation.

The published CLI bundles the first-party `@atlante/pack`, so the default preset
does not need a separate installation. A custom Pack must be declared and
installed before the CLI can resolve it:

```sh
npm install --save-dev @acme/review-pack
npx @atlante/cli validate
```

## A locator is rejected

Locators must be containing-file-relative paths beginning with `./` or `../`, or
package locators of the form `<package-name>` or `<package-name>/<subpath>`.
Absolute paths, URLs, backslash-separated paths, direct facet filenames, and
paths that escape the selected Pack root are invalid.

## Template input is rejected

The selected template owns fields after `description`, `$template`, `$instance`,
and `values`. Read its `template.jsonc` schema, remove unsupported fields, or
supply the required input. A binding cannot use `$template` and `$instance`
together.

## A value is not replaced

Check the spelling of each `{{values.key}}` reference and confirm that the key is
present in the global or binding-local `values` map. Values are strings, and a
missing reference is an error before rendering. The only supported system value
is `{{sys.cwd.basename}}`; arbitrary filesystem and environment references are
not available.

## A one-shot build fails

Fix the first actionable `error` diagnostic, then run validation again:

```sh
npx @atlante/cli validate
npx @atlante/cli build
```

`validate` checks source and selected content without rendering. `build` repeats
validation, renders the output, and publishes no partial artifact tree when a
failure occurs. For command output structure and locations, read
[Diagnostics](/reference/diagnostics).

## Watch mode reports a failure

`build --watch` remains active after a validation or build failure. Fix the
reported source error; the watcher retries on a later change. It leaves the last
complete artifact tree in place and exits with status `0` when stopped with
`Ctrl-C`. See the [CLI](/reference/cli) for the full watch contract.

## The OpenCode agent is not updated

Run a successful build first:

```sh
npx @atlante/cli validate
npx @atlante/cli build
```

Then confirm that your OpenCode config (`opencode.jsonc`, or an existing
`opencode.json`) registers `@atlante/opencode`. The adapter
reads only `<project>/.atlante/artifacts/`; it does not load the source
configuration, local resources, or installed Packs.

## Artifacts are absent or rejected

A missing artifact tree means the project has not completed a build. A malformed
or changed tree is rejected by the fail-closed reader. Re-run
`npx @atlante/cli build` after fixing the source. The reader also rejects unsafe
paths, symlinks, non-regular files, invalid UTF-8, missing payloads, duplicate
entries, and digest mismatches. Keep `.atlante/` local because rendered values
may contain sensitive content.

## The output is stale after an edit

Run `npx @atlante/cli build` after changing `atlante.jsonc`, local resources, or
selected Pack content. Use `npx @atlante/cli build --watch` during active editing
when you want selected changes rebuilt automatically.
