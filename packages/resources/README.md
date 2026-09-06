# `@atlante/resources`

Private workspace. The generic engine for static source and package loading:
pack discovery, resource resolution, facets, composition, interpolation, and
Markdown rendering.

## Boundaries

- Independent of higher orchestration, concrete packs, CLI policy, and host
  integrations; it must not encode semantics for one concrete pack or host.
- Loads only selected resources and their transitive dependencies inside a
  trusted pack root; never installs packages, scans installations, or executes
  content.

## Context

See [`AGENTS.md`](../../AGENTS.md) for the workspace architecture and
[`SPECIFICATION.md`](../../SPECIFICATION.md) (sections 5 and 6) for the
resolution and template contracts.
