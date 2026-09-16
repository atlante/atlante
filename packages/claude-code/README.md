# `@atlante/claude-code`

Private workspace. The Claude Code host materializer: it materializes a
prepared project as deterministic native agent and skill files under
`.claude/` plus the `.atlante/claude-code-native.json` ownership manifest.

## Boundaries

- Receives the prepared project as data. It must not load source
  configuration, resolve packs or resources, or import `@atlante/builder`.
- Owns only the materialization step; the CLI injects it, and the host owns
  models, permissions, tools, and modes.
- Output directories are fixed Claude-native locations: document `options`
  outDirs are OpenCode-scoped and are not forwarded (Claude Code discovers
  agents and skills from `.claude/`).

## Context

See [`AGENTS.md`](../../AGENTS.md) for the workspace architecture and
[`SPECIFICATION.md`](../../SPECIFICATION.md) (section 11) for the host
materializer profiles.
