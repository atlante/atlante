# Atlante

Toolchain for structured, versionable prompts across AI coding harnesses. See [SPECIFICATION.md](SPECIFICATION.md) for the full spec.

## Structure

```
packages/
  schema/          — document structure contract, JSON Schema, TypeScript types
  templates/       — template engine (loading, composition, Markdown rendering)
  validator/       — two-level validation (document structure + template semantics)
  resolver/        — normalization, value resolution, artifact descriptors
  presets/         — preset library (load + expose; never validates)
  opencode-plugin/ — OpenCode materialization
  cli/             — atlante validate, resolve, init
```

Schema changes require resolving and validating (`atlante validate`, `atlante resolve`). Tests mirror source paths in each package. No generated output is edited directly.

## Common commands

```sh
bun test                        # run all tests
bun run type:check              # type-check all packages
bun run lint:check              # lint + format check
bun run build                   # build all packages
```

## Rule

Run `bun run type:check && bun run lint:check && bun test` before committing and after each task.
