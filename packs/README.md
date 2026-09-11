# @atlante/packs

The [Atlante pack explorer](https://packs.atlante.sh): a static catalog for
discovering and inspecting Atlante packs published as npm packages.

The site is fully static. A build-time synchronization step reads the curated
manifest, verifies each pack against npm and the pack format, and writes the
snapshot the Astro build consumes; the committed snapshot is the fallback when
the network fetch fails and is never edited by hand.

## Commands

```sh
bun run --cwd packs dev    # dev server on port 4323
bun run --cwd packs build  # sync brand assets, sync the registry, build Astro
bun run --cwd packs check  # build, then run the workspace test suite
bun run --cwd packs fake:packs # append ten local fixture packs to the snapshot
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
- `scripts/fake-packs.ts` — local-only fixture packs for exercising the catalog; `sync:packs` restores the real snapshot.
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

The site deploys to [packs.atlante.sh](https://packs.atlante.sh) through the
release workflow's `deploy-packs` job, which builds the workspace with its own
registry synchronization and deploys prebuilt artifacts to the `packs` Vercel
project. Configure `VERCEL_PACKS_PROJECT_ID` in repository secrets (alongside
the shared `VERCEL_TOKEN` and `VERCEL_ORG_ID`) before the first deployment.

The snapshot is regenerated on every build, so deployed metrics reflect the
latest release's `sync:packs` run; the committed snapshot keeps local builds
and failed network fetches reproducible.
