# `@atlante/builder`

Private workspace. Host-neutral preparation and build orchestration: it keeps
the prepared project in memory and runs injected host materializers.

## Boundaries

- Must not import host packages; host materializers are injected at the CLI
  composition root, selected by the document's `hosts` field.
- Builds accept only validated documents, render deterministically, and
  materialize no partial result.

## Context

See [`AGENTS.md`](../../AGENTS.md) for the workspace architecture and
[`SPECIFICATION.md`](../../SPECIFICATION.md) (section 9) for the build and
materialization contract.
