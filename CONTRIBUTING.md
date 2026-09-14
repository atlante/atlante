# Contributing

Atlante is developed in a public repository. The source of truth for behavior
is [`README.md`](README.md),
[`SPECIFICATION.md`](SPECIFICATION.md),
tests, and the implementation.

## Set up the repository

The repository uses Bun and requires [Node.js](https://nodejs.org/) 22 or later:

```sh
git clone https://github.com/atlante/atlante.git
cd atlante
bun install
```

## Repository layout

Eight toolchain workspaces live under `packages/`:

- `schema` — versioned document contract, TypeScript types, Zod schemas,
  generated JSON Schema.
- `resources` — private engine for static source/package loading, resolution,
  composition, interpolation, and rendering.
- `validator` — document discovery and parsing, raw and resolved validation,
  template-input validation, diagnostics.
- `builder` — private host-neutral preparation and build orchestration.
- `pack` — first-party static presets, templates, and instances.
- `opencode` — OpenCode host materializer and the ownership manifest.
- `eval` — private host-runner orchestration for `atlante eval`.
- `cli` — user-facing command orchestration, initialization defaults, host
  registration.

The docs site is the `@atlante/docs` workspace in `docs/`, `website/`
hosts the Astro landing site, and `packs/` hosts the Astro pack explorer. The
publishable packages are `pack` and the CLI; the other toolchain workspaces
remain private.

## Licensing

Unless a file or directory states otherwise, original Atlante source code,
first-party pack content, schemas, and documentation are licensed under the MIT
License; see the repository [`LICENSE`](LICENSE). Published packages carry
their own `LICENSE` file as well as the MIT package metadata.

Source-file license headers are optional. When a standalone source file needs a
copyright and license notice, use the following SPDX form:

```ts
// Copyright © 2026 Omar Desogus, Giacomo Corrias
// SPDX-License-Identifier: MIT
```

Third-party dependencies, bundled fonts, and other third-party assets retain
their own notices and licenses. Do not mark third-party material as MIT. The
Atlante name, logo, and related branding are governed separately by
[`TRADEMARKS.md`](TRADEMARKS.md). Contributors should confirm that they have
the right to contribute their changes under MIT; copyright ownership and any
future relicensing agreement are separate matters. When changing code bundled
into the CLI, update `packages/cli/THIRD-PARTY-NOTICES.md` and verify the npm
package contents.

## Checks and tests

The checks are organized in lanes, and each lane is one npm command, so the
same command gates a change locally and in CI. Run the lane that matches the
area you touched. The lanes are additive — `full:check` is exactly
`core:check` plus the three site lanes — so once `core:check` has passed,
verify the remaining lanes individually instead of re-running it; reserve
`full:check` for work with no lane coverage yet or release-level verification:

```sh
bun run quick:check    # type:check + lint:check + test:unit; fast inner loop
bun run core:check     # toolchain lane: build, type, lint, all test tiers, both smokes
bun run docs:check     # docs lane: site build + docs test suite
bun run website:check  # website lane: site build + website test suite
bun run packs:check    # packs lane: site build + packs test suite
bun run full:check     # all lanes at once
```

To preview a local pack's published contents and self-reported evaluation in
the explorer without contacting npm or GitHub:

```sh
bun run --cwd packs dev:local -- ../packages/pack
```

CI mirrors this split: pull requests run `quick:check` plus the full
`full:check` gate (the required `check` status, including the OpenCode host
smoke), and pushes to `main` run one lane workflow per changed area
(`ci-core`, `ci-docs`, `ci-website`, `ci-packs`).

Tests run on `bun:test` and live next to the code they test:

- `packages/<workspace>/test/` mirrors `src/`, and every test file carries a
  tier suffix: `*.unit.test.ts` for in-memory tests, `*.integration.test.ts`
  for tests doing real builds or temp-directory filesystem work, and
  `*.e2e.test.ts` for full command-path tests. The tier scripts filter on the
  suffix, so new test files must pick one.
- `scripts/*.test.ts` files sit beside their scripts; `docs/`, `website/`, and
  `packs/` own their tests internally. Do not add tests in ad-hoc locations
  outside these trees.

The OpenCode host smoke inside `core:check` (`bun scripts/opencode-smoke.ts`)
is load-bearing — it downloads both pinned hosts (V1 and V2) and is the
slowest part of the lane — and unit tests cover the materializer against
synthetic fixtures, so the smoke is the only automated check of the real
pack → build → materialize → host discovery flow and must never be downgraded
to a manual
step.

## Architecture constraints

These constraints are reviewed in every change:

- `schema` and `resources` remain independent of higher orchestration,
  concrete packs, CLI policy, and host integrations.
- Validation, build, and CLI layers compose lower-layer capabilities but
  never duplicate their logic.
- First-party static semantics belong in `pack`; concrete host semantics
  belong in the corresponding materializer. Generic infrastructure never
  imports from or encodes semantics for one concrete pack or host.
- Host materializers receive the prepared project as data and never load
  source configuration, resolve packs or resources, or import the builder.
  The builder never imports host packages; the CLI is the composition root
  that injects the materializers selected by the document's `hosts` field.
- TypeScript sources, static pack content, authored configuration, and
  schema-generator inputs are authoritative. The committed JSON Schema
  (`packages/schema/schema/v0.1/schema.json`), `dist/`, and the generated
  native outputs are regenerated from their sources and are never edited
  directly.

## Open a change

1. **Issue.** Open one with the templates under
   [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/), a type (`Bug`,
   `Feature`, `Refactor`, `Docs`, `Chore`), and an `area:` label. Then work in
   an isolated worktree: `bun run worktree <issue>` for issue work,
   `bun run worktree <branch>` to adopt an existing branch, or bare
   `bun run worktree` for a scratch one. Keep all edits, git commands, and
   checks inside the worktree.
2. **Tasks and commits.** Split the issue into ordered tasks. Each task ends
   with exactly one commit containing only that task's changes, created after
   its checks pass; a commit never carries unrelated work. Commit messages
   follow Conventional Commits — `feat`, `fix`, `docs`, `refactor`, `chore`,
   or `release`, optionally scoped, as in `fix(cli): ...`.
3. **Branch and pull request.** Branches are named `issue-<n>` for issue
   worktrees or `<type>/<slug>` for work without an issue, as in
   `docs/readme-refresh`. Open the pull request with
   [`PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) and explain
   the behavior changed, the verification performed, and any compatibility
   impact.

Keep source changes and their tests together. Documentation changes should
include the affected page paths and successful `astro check` and docs build
results. Schema documentation should link the hosted schema and repository
source, while schema JSON remains generated from its TypeScript source.

## Work on the docs

The docs site is the `@atlante/docs` workspace:

```sh
bun run --cwd docs dev
bun run --cwd docs astro check
bun run --cwd docs build
```

Pages live in
[`docs/src/content/docs/`](https://github.com/atlante/atlante/tree/main/docs/src/content/docs/).
The sidebar is configured in
[`docs/astro.config.mjs`](https://github.com/atlante/atlante/blob/main/docs/astro.config.mjs).
Preserve the exact commands, fields, paths, IDs, and diagnostic codes used by
the implementation.

Brand assets and the token stylesheet are generated from
[`brand/`](https://github.com/atlante/atlante/tree/main/brand/):

```sh
bun run --cwd docs sync:brand
```

Do not edit generated assets or generated docs output directly. If brand source
changes, run `sync:brand` and review the generated result instead.

## Build and deploy the docs

For local verification, `bun run --cwd docs build` synchronizes the approved
brand assets and builds Astro. The docs Vercel project uses `docs` as its
project root and the configured deployment command is:

```sh
bun run sync:brand && npx astro build
```

The project configuration keeps preview builds available and cancels
production builds unless the current commit subject matches `release: vX.Y.Z`.
The release workflow does not deploy the docs or configure Vercel.

## Write documentation

Documentation should describe shipped behavior, not future capabilities. Use
active voice, sentence-case headings, and one primary idea per sentence. Each
page type makes one promise to the reader:

| Page type | Promise |
| --- | --- |
| Introduction | Why Atlante exists, what it does, and what it does not do |
| Getting started | The first successful build |
| Concepts | Mental models, without procedures |
| Guides | Outcome-driven procedures: when you want X, do this |
| Reference | Exhaustive tables and contracts, without narrative |
| Troubleshooting | Symptom to recovery actions |

State a constraint once, where it belongs, and link to it from other pages;
repeating it on every page reads like damping, not emphasis. The docs
introduction owns the does-not boundary statement.

Use `configuration` for the authored system, `document` for its parsed data
model, `native output` for generated host files, `ownership manifest` for the
generated-file record, and `materializer` for host-specific materialization.

Metaphor belongs in occasional explanatory copy. Procedures, CLI output, errors,
schema references, and troubleshooting must remain literal.
