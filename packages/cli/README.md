# `@atlante/cli`

Command-line interface for validating, resolving, and initializing
[Atlante](https://github.com/atlante/atlante) projects. Requires Node.js 22 or
later.

## Usage

Run the CLI directly from npm:

```bash
npx @atlante/cli init
npx @atlante/cli validate
npx @atlante/cli resolve
```

For a global `atlante` command:

```bash
npm install --global @atlante/cli
atlante --help
```

## Commands

- `atlante init [path] [--preset starter] [--force]` — scaffold
  `atlante.jsonc` and register `@atlante/opencode-plugin`
- `atlante validate [path]` — validate the document and referenced template
  inputs without rendering
- `atlante resolve [path] [--agent <id>] [--json]` — render resolved agent
  prompts

`path` defaults to the current directory and may be a config file or project
directory. Atlante discovers both `atlante.jsonc` and `atlante.json`.

`init` creates or updates `opencode.jsonc` while preserving existing settings.
