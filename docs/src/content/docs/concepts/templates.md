---
title: Templates and instances
description: Define reusable prompt and skill input contracts with static Markdown renderers.
---

A template owns the input contract and the Markdown renderer for a resource. It
is represented by a paired `template.jsonc` schema and `template.md` renderer.
The schema uses JSON Schema Draft 2020-12.

An instance supplies configured input for one template. It is represented by
`instance.jsonc` and can be selected from a document with `$instance` or a bare
resource locator.

## Select a template

Use `$template` when the binding supplies template-owned input directly:

```jsonc
{
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews the implementation.",
      "identity": "You are a careful reviewer.",
      "mission": "Find defects before merge."
    }
  }
}
```

Use `$instance` when a reusable configured resource should provide the input:

```jsonc
{
  "agents": {
    "architect": "@atlante/pack/architect"
  }
}
```

`$template` and `$instance` are mutually exclusive. A bare locator is `$instance`
shorthand. Binding metadata is removed before the effective template validates
its input.

## Compose sections

The first-party agent and skill templates support an ordered `sections` array.
Section variants include `markdown`, `instructions`, `gotchas`, `workflow`, and
`invariants`. Each section contributes a distinct part of the rendered output,
and array order is preserved.

```jsonc
{
  "$template": "@atlante/pack/agent",
  "description": "Implements requested changes.",
  "identity": "You are a senior implementer.",
  "mission": "Write tested, production-ready code.",
  "responsibilities": [
    "Implement the requested change",
    "Keep the project checks passing"
  ],
  "sections": [
    { "invariants": ["Every change ships with tests."] },
    { "instructions": ["Read the relevant source before editing."] }
  ]
}
```

An invariant is a binding guarantee or approval gate, not a suggestion. Keep
invariants minimal, concrete, and observable.

## Template composition

A template schema may declare composition slots with `{ "template": "..." }`.
Every declared slot must resolve to an available template. Circular composition,
missing slots, invalid schemas, and incompatible input fail before rendering.

Rendered child Markdown is preserved as opaque output. It is not interpreted as
parent template source.
