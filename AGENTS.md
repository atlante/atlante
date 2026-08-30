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
  builder/         — host-neutral preparation, deterministic artifact publication, verified artifact reader
  opencode/        — OpenCode-specific artifact materialization and skill-tool integration
  dashboard/       — private local OpenCode dashboard model and runtime projections
  cli/             — user-facing command orchestration (validate, build, init), initialization defaults, host registration
website/           — private Astro landing site workspace (@atlante/website, not published)
```

The eight toolchain workspaces are `schema`, `resources`, `validator`, `builder`,
`pack`, `opencode`, `dashboard`, and `cli`. The publishable packages are `pack`,
the CLI, and the OpenCode adapter; `resources` and `dashboard` remain private.
The separate `website` workspace hosts the Astro landing site for
[atlante.sh](https://atlante.sh); it stays outside the toolchain package graph
and is not covered by these constraints.

Schema changes require building and validating (`atlante validate`, `atlante build`). `atlante init` builds artifacts automatically; run `atlante build` after later source configuration changes. Tests mirror source paths in each package.

The repository-local `bun run cli` uses the source launcher and also exposes the private `dashboard` prototype; the published launcher remains validate/build/init only.

### Architecture constraints

- `schema` and `resources` remain independent of higher orchestration, concrete packs, CLI policy, and host integrations.
- Validation, build, and CLI layers MAY compose lower-layer capabilities but MUST NOT duplicate their logic.
- First-party static semantics belong in `pack`; concrete host semantics belong in the corresponding adapter. Generic infrastructure MUST NOT import from or encode semantics for one concrete pack or host unless that knowledge is part of its declared responsibility.
- Adapters MUST consume verified artifacts through the builder's adapter-facing reader and MUST NOT resolve source configuration or packs.
- Shared behavior MAY move to a lower layer only when genuinely generic to its consumers. An existing cross-layer shortcut MUST be surfaced rather than copied or expanded.
- TypeScript sources, static pack content, authored configuration, and schema-generator inputs are authoritative. The committed JSON Schema (`packages/schema/schema/v0.1/schema.json`), `dist/`, and `.atlante/artifacts/` MUST be regenerated from their sources and MUST NOT be edited directly.

## Common commands

```sh
bun run test                    # run all tests through Vitest on Node 22
bun run type:check              # type-check all packages
bun run lint:check              # lint + format check
bun run build                   # build publishable CLI + adapter artifacts (pack is static)
bun run quick:check             # type:check + lint:check + test
bun run full:check              # build + quick:check (CI gate)
bun run cli                     # run the CLI (packages/cli/bin/atlante-source.ts)
bun run mutation:test <ws>      # regenerate Stryker mutation evidence for schema|resources|validator
bun run mutation:verify         # verify stored mutation evidence (add --strict to fail on stale sources)
```

Mutation testing is fully separate from `bun run test` and never runs in
CI gates. Evidence under `mutation-evidence/` may lag source changes; a
scheduled workflow verifies it monthly and `mutation:verify --strict`
fails when evidence or score ratchets are stale.

Bun remains the package manager and build/release/smoke/packaging runtime. Tests
run through Vitest on Node 22; Bun is invoked explicitly only when a test
exercises Bun-specific behavior.

## Repository conventions

1. Use templates under `.github/ISSUE_TEMPLATE/` and `.github/PULL_REQUEST_TEMPLATE/` when creating issues or PRs with `gh`. Apply labels (`--label`) and type (`--type`, e.g. `Bug`, `Feature`, `Refactor`, `Docs`, `Chore`) when creating issues.
