# Atlante

Toolchain for structured, versionable prompts across AI coding harnesses. See [SPECIFICATION.md](SPECIFICATION.md) for the full spec.

## Structure

```
packages/
  schema/          — document structure contract, JSON Schema, TypeScript types
  templates/       — template engine (loading, composition, Markdown rendering)
  validator/       — two-level validation (document structure + template semantics)
  builder/         — project preparation, artifact building, and publication
  presets/         — preset library (load + expose; never validates)
  opencode-plugin/ — OpenCode materialization
  cli/             — atlante validate, build, init
```

Schema changes require building and validating (`atlante validate`, `atlante build`). `atlante init` builds artifacts automatically; run `atlante build` after later source configuration changes. Tests mirror source paths in each package. No generated output is edited directly.

## Common commands

```sh
bun test                        # run all tests
bun run type:check              # type-check all packages
bun run lint:check              # lint + format check
bun run build                   # build all packages
bun run build:check             # verify build output matches expectations
bun run quick:check             # type:check + lint:check + test
bun run full:check              # quick:check + build:check (CI gate)
bun run cli                     # run the CLI (packages/cli/bin/atlante.ts)
```

## Rules

1. Use templates under `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE/` when creating issues or PRs with `gh`. Apply labels (`--label`) and type (`--type`, e.g. `Bug`, `Feature`, `Refactor`, `Docs`, `Chore`) when creating issues.
