---
title: Configuration fields
description: Exact fields accepted by the v0.1 Atlante document contract.
---

The configuration schema is strict at the document root. Every project document
must include the exact schema URI:

```json
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json"
}
```

## Top-level fields

| Field | Type | Description |
| --- | --- | --- |
| `$schema` | string | Required v0.1 schema URI |
| `extends` | string or non-empty string array | Preset locator or ordered preset layers |
| `values` | object | Named string values; source overlays may use `null` to remove inherited values |
| `agents` | object | Map from non-empty host-agent IDs to bindings or `null` tombstones |
| `skills` | object | Map from non-empty skill IDs to bindings or `null` tombstones |

Unknown top-level fields are rejected. `agents` and `skills` default to empty
maps in the canonical document.

## Binding fields

A binding can be a resource locator string or an object. Object bindings may
contain the following reserved metadata:

| Field | Type | Description |
| --- | --- | --- |
| `$template` | string | Selects a template resource |
| `$instance` | string | Selects an instance resource |
| `description` | non-empty string | Host lookup metadata, interpolated before validation |
| `values` | object | Binding-local string value overrides |
| other fields | template-defined | Input validated by the selected template |

`$template` and `$instance` cannot occur together. The legacy `template` field is
reserved and invalid. A bare locator is shorthand for `$instance`.

## Agent and skill maps

Agent map keys remain host-agent IDs. Skill map keys are the `skillId` values
used by the OpenCode adapter's `atlante_skill` lookup. Both binding types require
a non-empty `description` after interpolation.

The document schema leaves template-owned fields open. Resource resolution and
template validation determine whether those fields are valid for the selected
resource.

## Canonical form

After resolution, the canonical document contains the schema URI, resolved
values, agent bindings, and skill bindings. It has no `extends`, `$template`,
`$instance`, or unresolved `null` removals.

See the [versioned JSON Schema](./schema/) and [resolution and composition](/concepts/resolution)
for the validation stages around this contract.
