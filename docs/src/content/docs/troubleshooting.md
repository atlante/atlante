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

Check the locator and confirm that the selected target exists in its trusted
Pack root. See [Resources](/concepts/resources) for locator rules.

For a custom Pack, check both package diagnostics:

- `package-not-declared` means the package is not declared by the authoring project.
- `package-not-installed` means it is declared but cannot be found in the installation.

The published CLI bundles the first-party `@atlante/pack`. A custom Pack must be
declared and installed before the CLI can resolve it:

```sh
npm install --save-dev @acme/review-pack
npx @atlante/cli@latest validate
```

## A locator is rejected

See [Resources](/concepts/resources) for accepted locator forms and Pack-root
restrictions. Correct the locator, then run validation again.

## Template input is rejected

Read the selected template's `template.jsonc` schema, remove unsupported fields,
or supply the required input. See [Templates](/concepts/templates) for selector
and template-input rules.

## A value is not replaced

Check the spelling of each `{{values.key}}` reference and confirm that the key is
present in the global or binding-local `values` map. See [Values](/concepts/values)
for interpolation and system-value rules.

## A one-shot build fails

Fix the first actionable `error` diagnostic, then run validation and build again:

```sh
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

For command behavior and output, read the [CLI](/reference/cli) and
[Diagnostics](/reference/diagnostics) references.

## Watch mode reports a failure

Fix the reported source error; the watcher retries on a later change. See the
[CLI](/reference/cli) for watch behavior and exit status.

## The OpenCode agent is not updated

Run a successful build first:

```sh
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

Then restart OpenCode to pick up changed native files. See
[Materialization](/reference/materialization) for output paths and discovery.

## The build reports `materialization-*`

See [Materialization](/reference/materialization) for diagnostic meanings and
the complete publication contract. Common repairs are:

- `materialization-collision`: remove or rename the unowned file, then build
  again.
- `materialization-drift`: restore or delete the edited generated file, then
  build again.
- `materialization-invalid-id`: rename the invalid agent or skill ID in
  `atlante.jsonc`, then build again.
- `materialization-invalid-manifest`: delete the corrupt
  `.atlante/opencode-native.json`, then build again.
- `materialization-unsafe-path`: replace the symlink or blocking path with a
  real directory, then build again.
- `materialization-publication-failed`: fix the reported filesystem condition
  and build again.

## The build reports `unsupported-host`

In v0.1 the only admitted `hosts` value is `"opencode"`. Remove the unknown
entry and run validation again.

## `init` touched my OpenCode config or `.gitignore`

`init` leaves the OpenCode configuration untouched. It only appends the
generated-output entries to `.gitignore` when they are missing.

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
