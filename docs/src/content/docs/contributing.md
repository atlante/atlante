---
title: Contributing
description: Make changes to Atlante code, static content, and documentation.
---

Atlante is developed in a public repository. The source of truth for behavior is
`README.md`, `SPECIFICATION.md`, tests, and the implementation; the documentation
should describe shipped behavior rather than future capabilities.

## Set up the repository

The repository uses Bun and requires Node.js 22 or later:

```sh
git clone https://github.com/atlante/atlante.git
cd atlante
bun install
```

Run the checks before opening a change:

```sh
bun run lint:check
bun run type:check
bun run test
bun run build
```

## Work on the docs

The docs site is the `@atlante/docs` workspace:

```sh
bun run --cwd docs dev
bun run --cwd docs build
```

Pages live in `docs/src/content/docs/`. Add new pages to the sidebar in
`docs/astro.config.mjs` and preserve the exact commands, fields, paths, IDs, and
diagnostic codes used by the implementation.

Brand assets and the token stylesheet are generated from `brand/`:

```sh
bun run --cwd docs sync:brand
```

Do not edit generated assets directly.

## Write documentation

Use active voice, sentence-case headings, and one primary idea per sentence.
Use `configuration` for the authored system, `document` for its parsed data model,
`artifact` for generated output, and `host adapter` for host-specific
materialization.

Metaphor belongs in occasional explanatory copy. Procedures, CLI output, errors,
schema references, and troubleshooting must remain literal.

## Open a change

Keep source changes and their tests together. Explain the behavior changed, the
verification performed, and any compatibility impact in the pull request.
Documentation changes should include the affected page paths and a successful
docs build.
