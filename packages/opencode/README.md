# `@atlante/opencode`

Private workspace. The OpenCode host materializer: it materializes a prepared
project as deterministic native agent and skill files under `.opencode/` plus
the `.atlante/opencode-native.json` ownership manifest.

## Boundaries

- Receives the prepared project as data. It must not load source
  configuration, resolve packs or resources, or import `@atlante/builder`.
- Owns only the materialization step; the CLI injects it, and the host owns
  models, permissions, tools, and modes.

## Context

See [`AGENTS.md`](../../AGENTS.md) for the workspace architecture and
[`SPECIFICATION.md`](../../SPECIFICATION.md) (section 11) for the OpenCode
materializer profile.
