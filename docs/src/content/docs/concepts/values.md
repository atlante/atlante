---
title: Values and interpolation
description: Share explicit string inputs across descriptions and rendered prompt definitions.
---

Values are named string inputs. Define them at document level when several
bindings share the same input, or override them inside one binding when that
binding needs a different value.

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "values": {
    "project": "my-app",
    "language": "TypeScript"
  },
  "agents": {
    "implementer": {
      "$template": "@atlante/pack/agent",
      "description": "Implements changes in {{values.project}}.",
      "identity": "You are a {{values.language}} implementer on {{values.project}}.",
      "mission": "Write clean, tested code."
    }
  }
}
```

Use `{{values.key}}` in authored descriptions and prompt definitions. Atlante
replaces references before template rendering. A missing reference is a
diagnostic; it is not left as unresolved text.

## Local overrides

A binding can provide its own `values` map. Local values override global values
by key for that binding only:

```jsonc
{
  "values": {
    "project": "shared-project",
    "tone": "concise"
  },
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews {{values.project}}.",
      "values": {
        "project": "api-service"
      },
      "identity": "You review {{values.project}} in a {{values.tone}} style.",
      "mission": "Find defects before merge."
    }
  }
}
```

Global and local values are strings in the canonical document. Source overlays
may use `null` to remove an inherited value before canonical validation.

The values dictionary is not passed to a template as an undeclared input object.
Templates receive only the fields declared by their own input schema.
