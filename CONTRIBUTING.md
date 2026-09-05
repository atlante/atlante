# Contributing

Atlante is developed in a public repository. The source of truth for behavior is
[`README.md`](README.md),
[`SPECIFICATION.md`](SPECIFICATION.md),
tests, and the implementation. Documentation should describe shipped behavior,
not future capabilities.

## Set up the repository

The repository uses Bun and requires [Node.js](https://nodejs.org/) 22 or later:

```sh
git clone https://github.com/atlante/atlante.git
cd atlante
bun install
```

Run the root checks before opening a change:

```sh
bun run quick:check
bun run full:check
```

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
brand assets and builds Astro. The docs Vercel project uses `docs` as its project
root and the configured deployment command is:

```sh
npx astro build
```

The release workflow synchronizes brand assets before sending the docs workspace
to Vercel, so the remote build does not need Bun or access to the repository-level
`brand/` directory. Configure `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and
`VERCEL_DOCS_PROJECT_ID` in repository secrets before publishing a release.

## Write documentation

Use active voice, sentence-case headings, and one primary idea per sentence. Use
`configuration` for the authored system, `document` for its parsed data model,
`native output` for generated host files, `ownership manifest` for the
generated-file record, and `materializer` for host-specific materialization.

Metaphor belongs in occasional explanatory copy. Procedures, CLI output, errors,
schema references, and troubleshooting must remain literal.

## Open a change

Keep source changes and their tests together. Explain the behavior changed, the
verification performed, and any compatibility impact in the pull request.
Documentation changes should include the affected page paths and successful
`astro check` and docs build results. Schema documentation should link the
hosted schema and repository source, while schema JSON remains generated from
its TypeScript source.
