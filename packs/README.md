# @atlante/packs

The [Atlante pack explorer](https://packs.atlante.sh): a static catalog for
discovering and inspecting Atlante packs published as npm packages.

The site is fully static. A build-time synchronization step reads the curated
manifest, verifies each pack against npm and the pack format, and writes the
snapshot the Astro build consumes; the committed snapshot is the fallback when
the network fetch fails and is never edited by hand.

## Commands

```sh
bun run --cwd packs dev    # dev server on port 4322
bun run --cwd packs build  # sync brand assets, sync the registry, build Astro
bun run --cwd packs check  # build, then run the workspace test suite
```

## Layout

- `src/pages/packs/` — the catalog and pack detail routes.
- `src/data/registry-manifest.json` — the curated pack manifest (authored).
- `src/data/registry-snapshot.json` — the generated registry snapshot.
- `scripts/sync-packs.ts` — the registry synchronization step.
- `scripts/sync-brand.ts` — brand asset synchronization; see `scripts/sync-brand-assets.ts` in the repository root.
