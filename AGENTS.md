# Atlante

Toolchain for structured, versionable prompts across AI coding harnesses. See [SPECIFICATION.md](SPECIFICATION.md) for the full spec.

## Architecture

### Workspace responsibilities

```
packages/
  schema/          — versioned document contract, TypeScript types, Zod schemas, generated JSON Schema
  resources/       — generic private engine for static source/package loading, resolution, composition, interpolation, and rendering
  pack/            — first-party static presets, templates, and instances; no executable API
  validator/       — document discovery/parsing, raw and resolved validation, template-input validation, diagnostics
  artifacts/       — private artifact-tree contract: deterministic naming, hashing, serialization, atomic publication, fail-closed verification and reading
  builder/         — host-neutral preparation and build orchestration; maps prepared projects onto the artifact contract
  opencode/        — OpenCode-specific artifact materialization and skill-tool integration
  cli/             — user-facing command orchestration (validate, build, init), initialization defaults, host registration
website/           — private Astro landing site workspace (@atlante/website, not published)
```

The eight workspaces are `schema`, `resources`, `validator`, `artifacts`,
`builder`, `pack`, `opencode`, and `cli`. The publishable packages are `pack`,
the CLI, and the OpenCode adapter; `resources` and `artifacts` remain private. The separate `website` workspace hosts the Astro landing site for [atlante.sh](https://atlante.sh); it stays outside the toolchain package graph and is not covered by these constraints.

Schema changes require building and validating (`atlante validate`, `atlante build`). `atlante init` builds artifacts automatically; run `atlante build` after later source configuration changes. Tests live next to the code they test: `packages/<workspace>/test/` mirrors `src/`, `scripts/*.test.ts` files sit beside their scripts, and `website` and `docs` own their tests internally. Do not add tests in ad-hoc locations outside these trees.

### Architecture constraints

- `schema` and `resources` remain independent of higher orchestration, concrete packs, CLI policy, and host integrations.
- Validation, build, and CLI layers MAY compose lower-layer capabilities but MUST NOT duplicate their logic.
- First-party static semantics belong in `pack`; concrete host semantics belong in the corresponding adapter. Generic infrastructure MUST NOT import from or encode semantics for one concrete pack or host unless that knowledge is part of its declared responsibility.
- Adapters MUST consume verified artifacts through `@atlante/artifacts` (its read-only API) and MUST NOT depend on `@atlante/builder`, resolve source configuration, or resolve packs.
- Shared behavior MAY move to a lower layer only when genuinely generic to its consumers. An existing cross-layer shortcut MUST be surfaced rather than copied or expanded.
- TypeScript sources, static pack content, authored configuration, and schema-generator inputs are authoritative. The committed JSON Schema (`packages/schema/schema/v0.1/schema.json`), `dist/`, and `.atlante/artifacts/` MUST be regenerated from their sources and MUST NOT be edited directly.

## Common commands

```sh
bun run test                    # run all tests (bun:test)
bun run type:check              # type-check all packages
bun run lint:check              # lint + format check
bun run build                   # build publishable CLI + adapter artifacts (pack is static)
bun run quick:check             # type:check + lint:check + test
bun run full:check              # build + quick:check (CI gate)
bun run cli                     # run the CLI (packages/cli/bin/atlante.ts)
bun run worktree <issue>        # create + bootstrap an isolated worktree (.worktrees/issue-<n>); omit <issue> for a random one
```

Bun is the package manager and the build/release/smoke/packaging/test runtime.

During implementation, use Fallow for codebase analysis and lightweight
feedback, and run `bun run quick:check` for fast iteration. Reserve
`bun run full:check` as the heavyweight final verification before declaring
work ready. The `smoke:opencode` step inside `full:check` is load-bearing:
opencode unit tests craft artifact fixtures via `@atlante/artifacts`, so the
smoke is the only automated check of the real pack → build → publish →
adapter flow and must never be downgraded to a manual step.

## Repository conventions

1. Use templates under `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE/` when creating issues or PRs with `gh`. Apply labels (`--label`) and type (`--type`, e.g. `Bug`, `Feature`, `Refactor`, `Docs`, `Chore`) when creating issues.
2. While working on an issue inside its `.worktrees/` worktree, all work MUST stay inside that worktree: edits, git commands, and checks run there and nowhere else. The root checkout is off-limits during issue work; its only permitted operation is updating `main` after the issue's PR has merged.
3. Git commits are the project-approved checkpoint mechanism for the workflow's task boundaries: each implementation task MUST end with exactly one commit containing only that task's changes, created after the task's checks pass (and its task review, when run). A task's commit MUST NOT contain unrelated work.
4. Tasks run sequentially by default and MAY run in parallel only when the plan marks them as independent; each parallel task works in its own worktree branched from the issue worktree and is merged back in plan order, keeping the one-commit-per-task rule above.
