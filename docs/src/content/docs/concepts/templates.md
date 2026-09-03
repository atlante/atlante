---
title: Templates
description: Templates, instances, bindings, and template-owned input.
---

How do you reuse prompt structure without putting prompt-specific fields into
the document schema? Use a template. A template owns an input contract and a
Markdown renderer. Its resource has two required facets: `template.jsonc`, a
JSON Schema Draft 2020-12 document, and `template.md`, the renderer. The schema
owns the names, types, and composition slots of the input that the renderer
receives.

An instance is different: it is reusable configured input for one template. It
lives in `instance.jsonc` and resolves to exactly one effective template. A
binding in `agents` or `skills` selects one of these forms:

- `$template` selects a template and supplies its input in the binding.
- `$instance` selects a configured instance.
- A bare resource locator is shorthand for `$instance`.

`$template` and `$instance` cannot appear together. Binding metadata is removed
before the selected template validates its input, so the selected template owns
all fields beyond `description`, `values`, and the selector. A missing source
uses the applicable configured default.

```jsonc
{
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews the implementation.",
      "identity": "You are a careful reviewer.",
      "mission": "Find defects before merge."
    },
    "architect": "@atlante/pack/architect"
  }
}
```

## Selector-less bindings

At the top level of the document's `agents` and `skills` collections, an object
binding may omit both selectors. Atlante then uses the collection's default
first-party template: `@atlante/pack/agent` for an agent and
`@atlante/pack/skill` for a skill. This default applies only to those top-level
collections; nested resource source objects require `$template` or `$instance`.

```jsonc
{
  "agents": {
    "reviewer": {
      "description": "Reviews the implementation.",
      "identity": "You are a careful reviewer.",
      "mission": "Find defects before merge."
    }
  }
}
```

This selector-less form is valid. The default template still controls the
accepted fields and the rendered Markdown. A schema can declare a composition
slot with `{ "template": "..." }`; every declared slot must resolve, even when
the current input takes a different schema branch. Missing slots, invalid
schemas, incompatible input, and circular composition fail before rendering.
Rendered child Markdown is kept as opaque output rather than interpreted as
parent template source. See [Resolution](/concepts/resolution) for the stage
where this graph is checked and the [Materialization](/reference/materialization)
reference for the resulting output.
