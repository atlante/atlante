# `@atlante/schema`

Private workspace. The versioned document contract for Atlante: TypeScript
types, Zod schemas, and the generated JSON Schema documents (including the
committed `schema/v0.1/schema.json`, `schema/v0.2/schema.json`, and the eval-scenario schema).

## Boundaries

- Independent of higher orchestration, concrete packs, CLI policy, and host
  integrations.
- The committed JSON Schema and generated artifacts are build outputs of the
  TypeScript source and MUST NOT be edited directly.

## Context

See [`AGENTS.md`](../../AGENTS.md) for the workspace architecture and
[`SPECIFICATION.md`](../../SPECIFICATION.md) for the normative contract.
