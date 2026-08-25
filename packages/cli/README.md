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

- `atlante init [path] [--preset <package-locator>] [--force]` — scaffold
  `atlante.jsonc`, register the OpenCode adapter package, and build artifacts
- `atlante validate [path]` — validate the document, selected template and instance
  facets, and template inputs without rendering
- `atlante build [path]` — validate, render, and atomically publish host-neutral
  artifacts under `.atlante/artifacts/`

`path` defaults to the current directory and may be a configuration file or project
directory. Atlante discovers both `atlante.jsonc` and `atlante.json`.
Validation and building use the same raw-overlay, lazy resource-resolution path
before checking or rendering the canonical document. Local locators are
containing-file-relative; installed packs use a scoped or unscoped package name
with an optional contained POSIX subpath. `extends` selects presets,
`$template` selects template facets, and `$instance` or a bare locator selects
instances. The selected package must already be declared and installed; the CLI
does not install or mutate dependencies. Watch mode follows selected manifests,
template and instance facets, transitive files, trusted pack roots, and safe unresolved parent
directories, not unrelated resource siblings. `init` validates the selected
preset before mutating files and performs a build automatically. Run `atlante
build` after changing source configuration or resource directories when watch mode is not
active.

The default `init` preset is the static `@atlante/pack` package. The CLI declares
that package as a runtime dependency and resolves it from the CLI installation,
so a global-style installation does not depend on the project current directory.
The pack has `atlante.format: 1` and no executable API.

`init` creates or updates `opencode.jsonc` while preserving existing settings.

The OpenCode adapter is an artifact-only boundary: it never reads the source
configuration or installed packs. The artifact format and its verification rules
are documented in
[`SPECIFICATION.md`](../../SPECIFICATION.md) §9.1; the builder's fail-closed
`readArtifacts` reader contract is in
[`@atlante/builder`'s README](../builder/README.md#reading-artifacts). Artifact
format/version is distinct from the document schema version. Artifacts contain
rendered values and may be sensitive; keep `.atlante/` local and do not publish
it.
