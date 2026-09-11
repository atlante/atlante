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

Use these lightweight page patterns when adding or revising content:

- Guides orient the reader, state the outcome, show a complete example, explain
  the result, name important caveats, and link to the next step.
- References define the subject, show its syntax or shape, document fields and
  defaults, include a minimal example, describe failures, and link related pages.
- Use admonitions only for material risks or exceptions; keep ordinary
  explanations in the main flow.

## Brand assets

`bun run sync:brand` copies approved favicon and logo exports, self-hosted fonts,
and the generated token stylesheet from `brand/`. Generated files are ignored
or rebuilt on every development and production build; do not edit them directly.

## Deployment

The docs site deploys natively from Vercel: the project builds on every push
to `main` and opens preview deployments for pull requests. The Vercel project
uses `docs` as its root directory with "Include source files outside of the
Root Directory in the Build Step" enabled, and its build command is
`bun run sync:brand && npx astro build`, so the remote build materializes
brand assets from `../brand` exactly like a local build.
