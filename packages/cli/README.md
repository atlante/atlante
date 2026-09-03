# `@atlante/cli`

Command-line interface for validating, building, and initializing
[Atlante](https://github.com/atlante/atlante) projects. Requires Node.js 22 or
later.

## Usage

Run the CLI directly from npm:

```bash
npx @atlante/cli@latest init
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

For a global `atlante` command:

```bash
npm install --global @atlante/cli
atlante --help
```

## Commands

- `atlante init [path] [--pack <pack-locator>] [--force]` — scaffold
  `atlante.jsonc`, enforce the generated-output ignore policy, and materialize
  the first native outputs
- `atlante validate [path]` — validate the document, selected templates and instances, and
  template inputs without rendering
- `atlante build [path]` — validate, render, and materialize host-native
  outputs (`.opencode/` files plus the `.atlante/opencode-native.json`
  ownership manifest)

`path` defaults to the current directory and may be a configuration file or project
directory. Atlante discovers both `atlante.jsonc` and `atlante.json`.
Validation and building use the same raw-overlay, lazy resource-resolution path
before checking or rendering the canonical document. Local locators are
containing-file-relative; installed packs use a scoped or unscoped package name
with an optional contained POSIX subpath. `extends` selects presets,
`$template` selects templates, and `$instance` or a bare locator selects
instances. `init` validates the selected preset before mutating files and
performs a build automatically. Run `atlante build` after changing source
configuration or resource directories when watch mode is not active.

### Pack selection and installation

`--pack <locator>` selects the pack to extend. The bundled first-party
`@atlante/pack` is the default when `--pack` is omitted; it resolves from the
CLI installation, so a global-style installation does not depend on the
project's current directory, and no package manager runs. The pack has
`atlante.format: 1` and no executable API.

With a third-party pack, initialization is transactional across configuration
files, host configuration, dependency mutation, and the initial build:

- `--pack @acme/pack` installs the pack (when needed), enumerates the presets
  it provides by scanning the installed pack tree for directories containing
  `atlante.jsonc` or `atlante.json`, and selects one: the only preset is chosen
  automatically; several presets prompt on an interactive terminal; a
  non-interactive terminal fails and lists the presets with the explicit
  `--pack @acme/pack/<preset>` form.
- `--pack @acme/pack/<preset>` installs the pack and selects the named preset
  without prompting, which suits CI and scripts.
- Installation uses the package manager detected from the project lockfile
  (`bun.lockb`/`bun.lock` → bun, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn,
  `package-lock.json` → npm; npm is the fallback with no lockfile) and adds
  the pack to `devDependencies`. Installation is skipped when the pack is
  already declared in `dependencies`, `optionalDependencies`, or
  `devDependencies` (`peerDependencies` does not resolve and always gains a
  dev dependency), and existing declarations are never moved between
  dependency groups or replaced; a declared-but-uninstalled pack is reconciled
  with a plain package manager install.
- Any failure after the snapshot — including an aborted prompt — rolls back
  the configuration files and restores `package.json` and the lockfile. When
  the pack was newly added, the detected package manager install is re-run to
  reconcile `node_modules` (a plain install leaves the state already
  reconciled). If that reconciliation fails, `init` reports `rollback-failed`
  with manual instructions.

`init` creates or updates `opencode.jsonc` (reusing an existing `opencode.json` when present) while preserving existing settings; a leftover Atlante-written `@atlante/opencode` plugin registration is removed.

`build` materializes host-native outputs through the OpenCode materializer:
agents and skills are written as native host files plus an ownership manifest
under `.atlante/`. Rendered values may be sensitive; generated outputs stay local
and are not published.
