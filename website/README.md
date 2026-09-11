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
`atlante` package for real. `website/api/playground.ts` is a stateless
Vercel function: each request writes the visitor's files into
an isolated temp directory, executes one CLI command, and returns the
actual output and generated file tree. A process-local session counter limits
repeated builds on warm instances, but user files and outputs are not retained
between requests; the counter is not a deployment-wide abuse boundary. The
CLI never executes project code. `bun run dev` serves
the same endpoint in-process through a dev-only Vite middleware, so the
playground works locally; `astro preview` stays static and shows a
friendly offline message instead.

Production installs the exact `atlante` version pinned in
`website/package.json` from npm. Locally the workspace install
links the workspace package instead, so run `bun install` and
`bun run build` at the repository root to exercise current source
through the dev playground. The published CLI bundle is self-contained,
so the lambda only needs the pinned package itself plus the
`@atlante/pack` templates it reads from its own installation at
runtime.

## Deployment

The site deploys natively from Vercel. The project uses `website` as its root
directory with "Include source files outside of the Root Directory in the Build
Step" enabled, because the build materializes the authoritative `../brand` and
`../packages/schema` sources. The install step runs
`npm install --workspaces=false --no-package-lock --no-audit --no-fund`, which
resolves the pinned `atlante` version from npm instead of linking the local Bun
workspace, so any deployed playground runs a version that npm already serves.

`ignoreCommand` in `vercel.json` keeps preview builds enabled and cancels
production builds unless the current commit subject matches `release: vX.Y.Z`.
This keeps ordinary pushes to `main` out of the public website until a package
release is made.

`vercel.json` in this directory holds hosting configuration: clean URLs, no
trailing slash, the `application/schema+json` content type for the published
schema, the playground function's 30-second timeout, and `includeFiles` for
`node_modules/@atlante/pack/**`. The CLI reads the pack templates from its
installation with filesystem calls, so Vercel's file tracer cannot reach
them and the pack is included explicitly.

The pinned `atlante` version advances independently in ordinary pull requests.
A release does not change that dependency; bump the pin separately when the
playground should consume a newer published CLI.
