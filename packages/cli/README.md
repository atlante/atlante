# `@atlante/cli`

Command-line interface for validating, building, and initializing
[Atlante](https://github.com/atlante/atlante) projects. Requires Node.js 22 or
later.

## Usage

Run the CLI directly from npm:

```bash
npx @atlante/cli init
npx @atlante/cli validate
npx @atlante/cli build
```

For a global `atlante` command:

```bash
npm install --global @atlante/cli
atlante --help
```

## Commands

- `atlante init [path] [--preset starter] [--force]` — scaffold
  `atlante.jsonc`, register `@atlante/opencode-plugin`, and build artifacts
- `atlante validate [path]` — validate the document, selected resource facets,
  and template inputs without rendering
- `atlante build [path]` — validate, render, and atomically publish host-neutral
  artifacts under `.atlante/artifacts/`

`path` defaults to the current directory and may be a config file or project
directory. Atlante discovers both `atlante.jsonc` and `atlante.json`.
Validation and building use the same raw-overlay, lazy resource-resolution path
before checking or rendering the canonical document. Local locators are
containing-file-relative; bundled resources use the temporary `atlante/*`
namespace. Watch mode follows selected transitive files and unresolved parent
directories, not unrelated resource siblings. `init` performs a build
automatically. Run `atlante build` after changing source configuration or
resources.

`init` creates or updates `opencode.jsonc` while preserving existing settings.

The artifact format and its verification rules are documented in
[`SPECIFICATION.md`](../../SPECIFICATION.md) §9.1; the builder's fail-closed
`readArtifacts` reader contract is in
[`@atlante/builder`'s README](../builder/README.md#reading-artifacts). Artifact
format/version is distinct from the document schema version. Artifacts contain
rendered values and may be sensitive; keep `.atlante/` local and do not publish
it.
