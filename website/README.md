# Atlante website

The public landing page for [atlante.sh](https://atlante.sh), built with
[Astro](https://astro.build) as a Bun workspace (`@atlante/website`). Design
tokens are derived from
[`brand/atlante-design-tokens.css`](../brand/atlante-design-tokens.css), so the
page cannot drift from approved brand values. The site loads the four approved
families — Bodoni Moda for the wordmark, Source Serif 4 for display headings
and editorial text, Source Sans 3 for interface text, and JetBrains Mono for
code and diagnostics.

## Commands

```sh
bun run dev      # sync brand assets, then start the dev server on port 4321
bun run build    # sync brand assets and schema, then build to dist/
bun run preview  # serve the built site locally
```

## Brand assets

`bun scripts/sync-brand.ts` copies the favicons, glyph, social, and horizontal
lockup exports from [`brand/assets/exports/`](../brand/assets/exports/) into
`public/brand/`; the horizontal lockups are used by the footer. It also copies
the approved social image to `public/og.png`, the used font families into
`public/fonts/`, and generates `src/styles/atlante-tokens.css` from the brand
tokens with root-relative font URLs. All generated files are git-ignored or
rebuilt on every `dev` or `build` run; never edit them directly.

`bun run sync:schema` copies the authoritative generated schema from
[`packages/schema/schema/v0.1/schema.json`](../packages/schema/schema/v0.1/schema.json)
to `public/schema/v0.1/schema.json`, after verifying its `$id`. The public copy
is ignored and is included in `dist/` by the complete website build. The deployed
`/schema/v0.1/schema.json` response uses `application/schema+json`.

## Playground

The build instrument on the landing page runs the published
`@atlante/cli` for real. `website/api/playground.ts` is a stateless
Vercel function: each request writes the visitor's files into
an isolated temp directory, executes one CLI command, and returns the
actual output and generated file tree. A process-local session counter limits
repeated builds on warm instances, but user files and outputs are not retained
between requests; the counter is not a deployment-wide abuse boundary. The
CLI never executes project code. `bun run dev` serves
the same endpoint in-process through a dev-only Vite middleware, so the
playground works locally; `astro preview` stays static and shows a
friendly offline message instead.

Production installs the exact `@atlante/cli` version pinned in
`website/package.json` from npm; `scripts/release.ts` advances the pin
to the released version at every release. Locally the workspace install
links the workspace package instead, so run `bun install` and
`bun run build` at the repository root to exercise current source
through the dev playground. The published CLI bundle is self-contained,
so the lambda only needs the pinned package itself plus the
`@atlante/pack` templates it reads from its own installation at
runtime.



## Deployment


The site deploys from the release workflow as prebuilt Vercel artifacts:

1. The workflow installs the website dependencies in isolation with
   `npm install --prefix website`, which resolves the exact `@atlante/cli`
   version pinned in `website/package.json` from npm. The website build
   needs files outside `website` — the authoritative brand assets and
   schema live at `../brand` and `../packages/schema` — so the build runs
   against the full monorepo checkout instead of an uploaded subtree.
2. `vercel pull` fetches the project settings, then `vercel build --prod`
   runs the complete website build and bundles `api/playground.ts` into
   `.vercel/output`.
3. The workflow copies `node_modules/@atlante/pack` into the playground
   function bundle: the published CLI reads the pack templates from its
   own installation at runtime, and `functions.includeFiles` no longer
   applies with the pinned Vercel CLI.
4. `vercel deploy --prebuilt --prod website` runs from the repository
   root, because the prebuilt deploy resolves function source metadata
   relative to the invocation directory.
5. Pushes to a release tag publish production. The same commands serve
   for a manual deploy.

The Vercel CLI is pinned to `59.3.0`: older releases fail on
TypeScript 7 with the toolchain's local compiler.

`vercel.json` in this directory holds hosting configuration: clean URLs, no
trailing slash, the `application/schema+json` content type for the published
schema, and the playground function's 30-second timeout.
