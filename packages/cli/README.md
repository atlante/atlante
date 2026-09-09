# `atlante`

Command-line interface for [Atlante](https://github.com/atlante/atlante): the
configuration layer for your coding-agent harness. Requires
[Node.js](https://nodejs.org) 22 or later.

## Usage

Run the CLI directly from npm in the project you want to configure:

```bash
npx atlante@latest init
```

For a global `atlante` command:

```bash
npm install --global atlante
atlante init
```

## Commands

- `atlante init [path] [--pack <pack-locator>] [--force] [--no-mcp]` — scaffold
  `atlante.jsonc`, enforce the generated-output ignore policy, materialize the
  first native outputs, and register the local MCP server unless opted out
- `atlante validate [path]` — validate the document, selected content, and
  template input without rendering or materializing anything
- `atlante build [path] [--watch]` — validate, render, and materialize
  host-native outputs; `--watch` rebuilds while you edit
- `atlante mcp` — run the read-only MCP context server over newline-delimited
  JSON-RPC on stdio; it uses the current working directory as the project root
- `atlante eval [path] [--scenario <name>] [--trials <n>] [--json] [--out <dir>] [--keep]` —
  run eval scenarios against the project's native outputs in a disposable
  sandbox, graded with deterministic checks

`path` defaults to the current directory and may be a configuration file
(`atlante.jsonc` or `atlante.json`) or a project directory.

`init` adds the generated folders to `.gitignore`, registers `mcp.atlante` in
the target directory's `opencode.jsonc` or `opencode.json`, and performs a
build. Use `--no-mcp` to leave OpenCode configuration untouched. Generated
outputs may embed rendered values, so they stay local: `init` ignores them in
git.

The MCP server is read-only and offline. Its tools inspect the active project,
validate it, list resolved resources, search and read the bundled documentation,
and return supported versioned schemas. It does not build, materialize, execute
agents, install packages, or make network requests.

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
