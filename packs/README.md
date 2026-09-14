# @atlante/packs

The [Atlante pack explorer](https://packs.atlante.sh): a static catalog for
discovering and inspecting Atlante packs published as npm packages.

The site is fully static. The Astro build consumes the committed registry
snapshot. The explicit synchronization step reads the curated manifest,
verifies each pack against npm and the pack format, and refreshes that snapshot
for deployment; it falls back to the previous snapshot when a live fetch fails
and is never edited by hand.

## Commands

```sh
bun run --cwd packs dev          # dev server on port 4323
bun run --cwd packs build        # sync brand assets, build from the snapshot
bun run --cwd packs check        # build, then run the workspace test suite
bun run --cwd packs sync:packs   # refresh the snapshot from npm and GitHub
```

The catalog lives at the subdomain root: `/` lists the packs and
`/<package>` opens a pack detail page, mirroring how the site resolves on
packs.atlante.sh. The legacy `/packs` path redirects to `/`.

## Layout

- `src/pages/index.astro` — the catalog at the site root.
- `src/pages/[...package].astro` — the pack detail routes.
- `src/data/registry-manifest.json` — the curated pack manifest (authored).
- `src/data/registry-snapshot.json` — the generated registry snapshot.
- `scripts/sync-packs.ts` — the registry synchronization step.
- `scripts/sync-brand.ts` — brand asset synchronization; see `scripts/sync-brand-assets.ts` in the repository root.

## Adding a pack to the catalog

Append an entry to
[`registry-manifest.json`](src/data/registry-manifest.json) and commit the
regenerated snapshot:

```jsonc
{
  "package": "@scope/name", // npm package name; required
  "official": false, // drives the Official / Community badge
  "tags": ["review", "security"] // curated search tags
}
```

The package must be published on npm with `atlante.format: 1` in its manifest.
Synchronization pulls the description, version, license, maintainers, and
repository from npm, the monthly download count from the npm downloads API,
and GitHub stars when the repository is public. `GITHUB_TOKEN` raises the
GitHub API rate limit for private-machine syncs; the deployment uses
unauthenticated requests.

## Deployment

The site deploys natively through Vercel's git integration: the `packs` Vercel
project uses `packs` as its Root Directory, installs dependencies from the
repository root, and explicitly refreshes the registry before running the
workspace build on every deployment. Production deploys run on every push to
the production branch and pull requests get preview deployments; no
ignored-build step is configured.

The committed snapshot keeps local builds and checks reproducible. Deployed
metrics reflect the latest successful refresh performed by the deployment
command, with the previous snapshot retained when live data cannot be
verified.
