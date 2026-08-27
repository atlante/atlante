# Atlante website

The public landing page for [atlante.sh](https://atlante.sh), built with
[Astro](https://astro.build) as a Bun workspace (`@atlante/website`). Design
tokens are derived from
[`brand/atlante-design-tokens.css`](../brand/atlante-design-tokens.css), so the
page cannot drift from approved brand values. The site loads the four approved
families — Bodoni Moda for display, Source Serif 4 for editorial text, Source
Sans 3 for interface text, and JetBrains Mono for code and diagnostics.

## Commands

```sh
bun run dev      # sync brand assets, then start the dev server on port 4321
bun run build    # sync brand assets, then build to dist/
bun run preview  # serve the built site locally
```

## Brand assets

`bun scripts/sync-brand.ts` copies the favicon, glyph, and social exports from
[`brand/assets/exports/`](../brand/assets/exports/) into `public/brand/`, the
approved social image to `public/og.png`, the used font families into
`public/fonts/`, and generates `src/styles/atlante-tokens.css` from the brand
tokens with root-relative font URLs. All generated files are git-ignored or
rebuilt on every `dev` or `build` run; never edit them directly.

## Playground

The build instrument on the landing page runs the published
`@atlante/cli` for real. `website/api/playground.ts` is a stateless
Vercel function: each request writes the visitor's files into
an isolated temp directory, executes one CLI command, and returns the
actual output and generated file tree. Nothing is stored between
requests, and the CLI never executes project code. `bun run dev` serves
the same endpoint in-process through a dev-only Vite middleware, so the
playground works locally; `astro preview` stays static and shows a
friendly offline message instead.

Production installs the exact `@atlante/cli` version pinned in
`website/package.json` from npm; `scripts/release.ts` advances the pin
to the released version at every release. Locally the workspace install
links the workspace package instead, so run `bun install` and
`bun run build` at the repository root to exercise current source
through the dev playground. The published CLI bundle is self-contained,
so the lambda only needs the pinned package itself plus `ajv` (whose
validator code requires runtime modules dynamically), as configured in
`vercel.json`.



## Deployment


The site deploys automatically through Vercel:

1. Import the repository into Vercel with the project root set to `website`.
2. Vercel detects Astro; keep the suggested build command and output directory.
3. Pushes to `main` publish production. Pull requests get preview deployments.

`vercel.json` in this directory holds hosting configuration: clean URLs, no
trailing slash, and the `application/schema+json` content type for JSON
responses.

