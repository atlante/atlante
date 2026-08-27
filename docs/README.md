# Atlante documentation

The documentation site for [Atlante](https://atlante.sh), built with Astro and
[Starlight](https://starlight.astro.build) as the `@atlante/docs` Bun workspace.
It is a separate deployment from the landing page in `website/` and is intended
to publish at `https://docs.atlante.sh`.

## Commands

Run from this directory:

```sh
bun run dev      # sync brand assets, then start Astro on port 4322
bun run build    # sync brand assets, then build to dist/
bun run preview  # preview the production build
```

From the repository root:

```sh
bun run --cwd docs dev
bun run --cwd docs build
```

## Content

Documentation pages live under `src/content/docs/`. The sidebar is configured in
`astro.config.mjs`. Starlight supplies responsive navigation, table of contents,
edit links, pagination, and Pagefind search.

The documentation follows the repository's terminology contract. Procedures,
references, diagnostics, and troubleshooting use implementation-aligned names
and do not rely on brand metaphor.

## Brand assets

`bun run sync:brand` copies approved favicon and logo exports, self-hosted fonts,
and the generated token stylesheet from `brand/`. Generated files are ignored
or rebuilt on every development and production build; do not edit them directly.

## Deployment

The Vercel project should use `docs` as its project root. Its configured build
command is `npx astro build`. The release workflow synchronizes the approved
brand assets before it sends the docs workspace to Vercel, so the remote build
does not need Bun or access to the repository-level `brand/` directory.

Configure `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_DOCS_PROJECT_ID` in the
repository secrets before publishing a release.
