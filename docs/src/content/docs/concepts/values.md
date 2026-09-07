---
title: Values
description: Explicit string values and interpolation in an Atlante document.
---

Values name the pieces of a prompt that change from one project or binding to
another. They are explicit string inputs: a document can define global values
for all bindings, and a binding can define local values that override matching
global keys for that binding only.

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "values": {
    "project": "billing-api",
    "language": "TypeScript"
  },
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews {{values.project}}.",
      "identity": "You are a {{values.language}} reviewer.",
      "mission": "Find defects before merge."
    }
  }
}
```

Interpolation replaces `{{values.key}}` references in binding descriptions and
template-owned prompt definitions before rendering. A binding-local value wins
over the global value with the same key only within that binding. Missing value
references produce structured diagnostics instead of remaining unresolved.

For example, a shared project name can be overridden for one binding:

```jsonc
{
  "values": { "project": "shared-project" },
  "agents": {
    "reviewer": {
      "description": "Reviews {{values.project}}.",
      "values": { "project": "billing-api" }
    }
  }
}
```

Source overlays may use `null` to remove an inherited value. After resolution,
global and local values are strings. The values dictionary itself is not passed
to a template as undeclared input; a template receives only fields its own
schema declares.

The v0.1 system namespace supports the current working directory basename:

```jsonc
{
  "values": {
    "project": "{{sys.cwd.basename}}"
  }
}
```

`{{sys.cwd.basename}}` resolves to the basename of the process's current working
directory. It is the only supported system value. Atlante does not provide
arbitrary filesystem or environment access. Read [Resolution](/concepts/resolution)
for the stage where interpolation occurs and [Schema](/reference/schema) for the
document field contract.
