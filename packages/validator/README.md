# `@atlante/validator`

Private workspace. Document discovery and parsing, raw and resolved
validation, template-input validation, and structured diagnostics with stable
codes, sources, and JSON Pointers.

## Boundaries

- Composes the lower `schema` and `resources` layers; it must not duplicate
  their logic.
- Validation must fail closed: any required failure produces no usable
  canonical document and no partial build output.

## Context

See [`AGENTS.md`](../../AGENTS.md) for the workspace architecture and
[`SPECIFICATION.md`](../../SPECIFICATION.md) (section 8) for the validation
contract.
