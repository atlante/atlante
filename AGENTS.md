# Atlante

Toolchain for structured, versionable prompts across AI coding harnesses. See [SPECIFICATION.md](SPECIFICATION.md) for the full spec.

## Structure

```
packages/
  schema/          — document structure contract, JSON Schema, TypeScript types
  resources/       — local/bundled resource packs, facets, resolution, and rendering
  validator/       — two-level validation (document structure + template semantics)
  builder/         — project preparation, artifact building, and publication
  opencode-plugin/ — OpenCode materialization
  cli/             — atlante validate, build, init
```

The six workspaces are `schema`, `resources`, `validator`, `builder`,
`opencode-plugin`, and `cli`. Only the CLI and OpenCode plugin are publishable;
`resources` is private and is never resolved through npm, plugins, or
`node_modules`.

Resources use `template.jsonc` plus `template.md` for template facets and
`instance.jsonc` for instance facets. Local locators are relative to the file
containing them; bundled resources use the temporary `atlante/*` namespace.
Resolution is lazy and fail-closed, with canonical project/bundled roots and
selected dependency paths for watch mode. The OpenCode plugin consumes only
verified `.atlante/artifacts` and never loads source configuration.

Schema changes require building and validating (`atlante validate`, `atlante build`). `atlante init` builds artifacts automatically; run `atlante build` after later source configuration changes. Tests mirror source paths in each package. No generated output is edited directly.

## Common commands

```sh
bun test                        # run all tests
bun run type:check              # type-check all packages
bun run lint:check              # lint + format check
bun run build                   # build publishable artifacts (CLI + plugin bundles)
bun run quick:check             # type:check + lint:check + test
bun run full:check              # build + quick:check (CI gate)
bun run cli                     # run the CLI (packages/cli/bin/atlante.ts)
```

## Rules

1. Use templates under `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE/` when creating issues or PRs with `gh`. Apply labels (`--label`) and type (`--type`, e.g. `Bug`, `Feature`, `Refactor`, `Docs`, `Chore`) when creating issues.
