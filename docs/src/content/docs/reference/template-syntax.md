---
title: Template syntax
description: The rendering syntax a template.md may use and the composition slots a template.jsonc declares.
---

A template pairs an input contract, `template.jsonc`, with a renderer,
`template.md`. Atlante renders `template.md` with
[Handlebars](https://handlebarsjs.com/) and HTML escaping disabled: everything
the renderer emits becomes Markdown verbatim, and `{{field}}` needs no escape
syntax. Missing input fields render as empty text, so required input belongs
in the schema, not in template conditionals.

This page documents the syntax surface Atlante v0.1 implements. It is the
de-facto contract for template authors; it evolves with the document contract,
and Handlebars features outside this surface are not part of it.

## The rendering input

Inside `template.md`, plain references address the validated template input —
the binding or instance fields left after the selected template owns them:

```hbs title="template.md"
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
| `{{#each list}}` | Iterate an array; `@index`, `@first`, `@last` address the position |
| `{{#if x}}` / `{{#unless x}}` | Branch on a present, truthy field |
| `{{/if}}` with `{{else}}` | Alternative branch |
| `(subexpression)` | Pass a computed value, as in `{{> blocks (input)}}` |
| `{{#*inline "name"}}` | Define a local partial for structural recursion |
| `{{~ ... ~}}` | Whitespace control around directives |

## Helpers

The renderer registers five helpers on top of the Handlebars built-ins:

| Helper | Result |
| --- | --- |
| `{{increment n}}` | `n + 1`; typically `{{increment @index}}` for 1-based numbering |
| `{{input}}` | The whole template input, for passing to a partial |
| `{{isEqual a b}}` | `true` when `a` and `b` are equal |
| `{{anyEqual list path expected}}` | `true` when any item of `list` has a `path` value equal to `expected` |
| `{{anyTruthy value list path}}` | `true` when `value` is an object with at least one truthy member, or any item of `list` has one at `path` |

## Composition slots

`template.jsonc` declares a composition slot wherever a field's schema uses
the marker `{ "template": "<locator>" }`. Each declared slot becomes a partial
named `slot/<path>` in the renderer, and invoking it renders the referenced
child template:

```jsonc title="template.jsonc"
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

```hbs title="template.md"
{{#each sections}}
{{#if instructions}}

{{> slot/sections/instructions instructions}}
{{/if}}
{{/each}}
```

An invocation may pass the slot value explicitly, as above, or let the
renderer resolve it from the input: `{{> slot/phases/output}}`. An
array-valued slot that resolves ambiguously fails the render with a diagnostic
that names the explicit form to use.

Composition rules:

- Every declared slot must resolve to an available template, including slots
  in schema branches a particular input does not select.
- Composed child Markdown is opaque output; it is never interpreted as parent
  template source.
- Circular composition is rejected.
- Only present slot values contribute output, and array order is preserved.

See [Templates](/concepts/templates) for bindings and template selection,
[Author a pack](/guides/authoring-packs) for the authoring walkthrough, and
the first-party templates in
[`@atlante/pack`](https://github.com/atlante/atlante/tree/main/packages/pack)
for working examples of every construct on this page.
