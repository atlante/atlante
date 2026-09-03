---
title: Troubleshooting
description: Diagnose configuration discovery, resource resolution, validation, and materialization problems.
---

Start with the diagnostic code in the command output. It identifies the failure,
the source or location, and often the next recovery action.

## The CLI says `config-not-found`

Run the command from the project root or pass the explicit configuration path:

```sh
npx @atlante/cli@latest validate ./path/to/atlante.jsonc
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
npx @atlante/cli@latest validate
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
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

`validate` checks source and selected content without rendering. `build` repeats
validation, renders the output, and materializes no partial output set when a
failure occurs. For command output structure and locations, read
[Diagnostics](/reference/diagnostics).

## Watch mode reports a failure

`build --watch` remains active after a validation or build failure. Fix the
reported source error; the watcher retries on a later change. It leaves the
previous valid generated set in place and exits with status `0` when stopped with
`Ctrl-C`. See the [CLI](/reference/cli) for the full watch contract.

## The OpenCode agent is not updated

Run a successful build first:

```sh
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

Then restart OpenCode. It reads `.opencode/agents/` and `.opencode/skills/`
when it starts, so new or changed native files are picked up only after a
restart. An idempotent rebuild rewrites nothing, which the CLI shows by
printing no `wrote` lines for unchanged files.

## The build reports `materialization-*`

The materializer fails closed and changes nothing when a target is unsafe:

- `materialization-collision`: an unowned file sits at a native path. Remove
  or rename that file, then run `atlante build` again.
- `materialization-drift`: a generated file was edited after the last build.
  Restore it to its last generated state — deleting the drifted file is the
  simplest repair — then run `atlante build` again.
- `materialization-invalid-id`: an agent or skill ID is not lowercase
  kebab-case ASCII of at most 64 characters. Rename the ID in
  `atlante.jsonc`; materialization never renames IDs.
- `materialization-invalid-manifest`: `.atlante/opencode-native.json` is
  corrupt. Delete it to discard Atlante's ownership state, then build again.
- `materialization-unsafe-path`: a symlink or non-directory blocks a
  materialization path. Replace it with a real directory, then build again.
- `materialization-publication-failed`: a staged publication failed; the
  previous valid generated set is preserved. Fix the reported filesystem
  condition and build again.

## The build reports `unsupported-host`

The document's `hosts` field names a host with no registered materializer. In
v0.1 the only admitted value is `"opencode"`. Remove the unknown entry or
register a materializer for it.

## `init` touched my OpenCode config or `.gitignore`

`init` does not register a plugin. It removes only the Atlante-written
`@atlante/opencode` entry from `opencode.jsonc` (or an existing
`opencode.json`); the removal may leave an empty `"plugin": []`, which is
harmless and requires no action. Every other host setting is preserved.

The generated-output ignore policy appends `.opencode/agents/`,
`.opencode/skills/`, and `.atlante/` to `.gitignore` when missing. Because a
git negation cannot re-include content of an ignored directory, a user
negation such as `!.opencode/agents/` cannot override an appended Atlante
entry; remove the Atlante entries yourself if you intentionally want generated
outputs under version control.

## The output is stale after an edit

Run `npx @atlante/cli@latest build` after changing `atlante.jsonc`, local resources, or
selected Pack content. Use `npx @atlante/cli@latest build --watch` during active editing
when you want selected changes rebuilt automatically.
