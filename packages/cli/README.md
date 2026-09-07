# `@atlante/cli`

Command-line interface for [Atlante](https://github.com/atlante/atlante): the
configuration layer for your coding-agent harness. Requires
[Node.js](https://nodejs.org) 22 or later.

## Usage

Run the CLI directly from npm in the project you want to configure:

```bash
npx @atlante/cli@latest init
```

For a global `atlante` command:

```bash
npm install --global @atlante/cli
atlante init
```

## Commands

- `atlante init [path] [--pack <pack-locator>] [--force]` — scaffold
  `atlante.jsonc`, enforce the generated-output ignore policy, and materialize
  the first native outputs
- `atlante validate [path]` — validate the document, selected content, and
  template input without rendering or materializing anything
- `atlante build [path] [--watch]` — validate, render, and materialize
  host-native outputs; `--watch` rebuilds while you edit
- `atlante eval [path] [--scenario <name>] [--trials <n>] [--json] [--out <dir>] [--keep]` —
  run eval scenarios against the project's native outputs in a disposable
  sandbox, graded with deterministic checks

`path` defaults to the current directory and may be a configuration file
(`atlante.jsonc` or `atlante.json`) or a project directory.

`init` adds the generated folders to `.gitignore`, leaves host configuration
untouched, and performs a build. Generated outputs may embed rendered values,
so they stay local: `init` ignores them in git.

## Packs

The CLI bundles the first-party [`@atlante/pack`](https://www.npmjs.com/package/@atlante/pack),
so the default preset needs no separate installation. With `--pack <locator>`,
`init` installs a custom pack with the project's package manager, adds it to
`devDependencies`, and selects one of its presets. Initialization is
transactional: a failure rolls back the configuration files, `package.json`,
and the lockfile.

## Documentation

Command flags, exit codes, diagnostics, and configuration details live in the
[CLI reference](https://docs.atlante.sh/reference/cli).
