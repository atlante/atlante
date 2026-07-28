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

## Rules

1. Strictly follow DRY-KISS: no repetitions, minimal elegant code, only what's essential to the task.
2. Always be informative: explain what you're doing, why, and what comes next. Include the user in significant choices and thinking — don't make one-sided decisions on architecture, approach, or tradeoffs.
3. Delegate to sub-agents for substantial, multi-step, or cross-package tasks; handle small or straightforward tasks directly without delegation overhead.
4. Before implementing substantial changes, first brainstorm with the user to find the best solution, then explore the codebase and propose a plan.
5. Run `bun run type:check && bun run lint:check && bun test` before committing and after each task. Before committing also use the fallow MCP tools to review changed files (dead code, complexity, duplication) and confirm the verdict.
6. Follow red-green-refactor TDD when the task involves behavior changes: write focused tests first, run them to confirm failure, then implement only enough to pass before broader updates.
7. Use templates under `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE/` when creating issues or PRs with `gh`. Apply labels (`--label`) and type (`--type`, e.g. `Bug`, `Feature`, `Refactor`, `Docs`, `Chore`) when creating issues.
