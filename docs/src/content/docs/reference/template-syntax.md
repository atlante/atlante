---
title: Template syntax
description: Handlebars expressions, built-in helpers, and composition slots for template renderers.
---

A template pairs an input contract, `template.jsonc`, with a renderer,
`template.md`. Atlante renders `template.md` with
[Handlebars](https://handlebarsjs.com/) and HTML escaping disabled: everything
the renderer emits becomes Markdown verbatim, and `{{field}}` needs no escape
syntax. Missing input fields render as empty text, so required input belongs
in the schema, not in template conditionals.

This page covers the rendering expressions and helpers used by Atlante v0.1.
For a complete schema, renderer, and instance example, see
[Author a pack](/guides/authoring-packs#define-a-custom-template).

## The rendering input

Inside `template.md`, expressions read validated template input. Binding
metadata such as `description` and `values` is excluded from that input.

```hbs title="template.md — excerpt"
# Identity

{{identity}}

{{#each sections}}
{{#if instructions}}

{{> slot/sections/instructions instructions}}
{{/if}}
{{/each}}
```

`{{values.*}}` references are different: they are resolved before rendering,
in authored document and instance content, and the values dictionary is never
passed to a renderer as input. A template reads only its declared input.

## Syntax surface

The first-party templates rely on this subset of Handlebars, all of which the
renderer supports:

| Construct | Use |
| --- | --- |
| `{{field}}`, `{{a.b}}` | Insert a validated input field |
| `{{this}}` | Insert the current context, such as a string item inside `each` |
| `{{#each list}}` | Iterate an array; `@index`, `@first`, `@last` address the position |
| `{{#if x}}` / `{{#unless x}}` | Branch on a present, truthy field |
| `{{else}}` | Introduce an alternative branch before the closing `{{/if}}` or `{{/unless}}` |
| `(subexpression)` | Pass a computed value, as in `{{> blocks (input)}}` |
| `{{#*inline "name"}}` | Define a local partial for structural recursion |
| `{{~ ... ~}}` | Whitespace control around directives |

## Helpers

The renderer registers five helpers on top of the Handlebars built-ins:

| Helper | Result |
| --- | --- |
| `{{increment n}}` | `n + 1`; typically `{{increment @index}}` for 1-based numbering |
| `{{input}}` | The whole template input, for passing to a partial |
| `{{isEqual a b}}` | `true` when `a === b` |
| `{{anyEqual list path expected}}` | `true` when `list` is an array and an item has a `path` value strictly equal to `expected` |
| `{{anyTruthy value list path}}` | `true` when `value` is a plain object with a truthy member, or `list` is an array with an item whose plain object at `path` has a truthy member |

## Composition slots

`template.jsonc` declares a composition slot wherever a field's schema uses the
exact marker object `{ "template": "<locator>" }`. The object must have no
other keys. Each declared slot becomes a partial named `slot/<path>` in the
renderer, and invoking it renders the referenced child template:

```jsonc title="template.jsonc — composition excerpt"
{
  "properties": {
    "sections": {
      "type": "array",
      "items": {
        "properties": {
          "instructions": { "template": "@atlante/pack/instructions" }
        }
      }
    }
  }
}
```

```hbs title="template.md — composition excerpt"
{{#each sections}}
{{#if instructions}}

{{> slot/sections/instructions instructions}}
{{/if}}
{{/each}}
```

An invocation may pass the slot value explicitly, as above, or let the
renderer resolve it from the input: `{{> slot/phases/output}}`. An
array-valued slot that resolves ambiguously fails with
`ambiguous-slot-invocation`, which names the explicit form to use. Other
renderer failures use `template-render-failed`.

Composition rules:

- Every declared slot must resolve to an available template, including slots
  in schema branches a particular input does not select.
- When schema branches declare several templates at the same data path,
  normalized input records the selected template. Without a recorded
  selection, rendering uses the lexicographically first template ID.
- Composed child Markdown is opaque output; it is never interpreted as parent
  template source.
- Circular composition is rejected.
- Only present slot values contribute output, and array order is preserved.

See [Templates](/concepts/templates) for bindings and template selection,
[Author a pack](/guides/authoring-packs) for the authoring walkthrough, and
the first-party templates in
[`@atlante/pack`](https://github.com/atlante/atlante/tree/main/packages/pack)
for working examples of every construct on this page.
