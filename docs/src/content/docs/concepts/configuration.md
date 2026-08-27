---
title: Configuration
description: The authored Atlante document and the fields that define a harness.
---

The configuration document is the authored source for an Atlante harness. It is
normally stored as `atlante.jsonc`; strict JSON in `atlante.json` is also
supported.

Only one configuration filename may exist in a project root. If both
`atlante.jsonc` and `atlante.json` exist, Atlante reports an ambiguity and
requires an explicit path.

## Document shape

A document must contain the versioned `$schema` URI. The other top-level fields
are optional:

| Field | Purpose |
| --- | --- |
| `$schema` | Identifies the v0.1 document contract |
| `extends` | Selects one preset or an ordered list of presets |
| `values` | Defines named string values for interpolation |
| `agents` | Maps host-agent IDs to resource bindings |
| `skills` | Maps skill IDs to resource bindings |

Unknown top-level fields are rejected. Missing `agents` and `skills` maps
normalize to empty collections after resolution.

## Minimal document

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack"
}
```

`extends` accepts one non-empty locator or a non-empty ordered array. A local
configuration is applied after its selected preset layers, so local fields win.

## Bindings

Each entry in `agents` or `skills` is either a resource locator or an object
with a selector and local overlay fields:

```jsonc
{
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews changes for defects and design issues.",
      "identity": "You are a careful reviewer.",
      "mission": "Find defects before changes are merged."
    }
  },
  "skills": {
    "testing": {
      "$template": "@atlante/pack/skill",
      "description": "Testing guidance for this project.",
      "sections": [
        { "instructions": ["Run the relevant test suite."] }
      ]
    }
  }
}
```

`description`, `$template`, `$instance`, and `values` are binding metadata.
The selected template owns every other field. An effective agent or skill must
have a non-empty description after value interpolation.

## Raw and resolved documents

The authored document may contain preset selectors, source overlays, and
`tombstones` represented by `null`. Resolution turns it into a canonical
document with no `extends`, source selectors, or unresolved removals. Templates
then validate the fields they own.

Read [resolution and composition](/concepts/resolution/) for the stages and
[configuration fields](/reference/configuration/) for the complete field reference.
