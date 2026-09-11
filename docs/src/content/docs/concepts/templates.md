---
title: Templates
description: How reusable input contracts, configured content, and bindings become agent and skill instructions.
---

A template defines accepted input and renders it as a Markdown file for an
agent or skill. An instance stores reusable configured input for one template,
while a binding assigns selected content to a named agent or skill. Together,
these roles separate reusable structure, configured content, and host-facing
identity.

## Canonical Markdown input

The first-party `@atlante/pack/markdown` template accepts a canonical Markdown
AST rather than the former shorthand blocks. Each node identifies its kind with
`type`, and recursive content appears in `children`.

```json
[
  {
    "type": "heading",
    "depth": 2,
    "children": [{ "type": "text", "value": "Installation" }]
  },
  {
    "type": "paragraph",
    "children": [
      { "type": "text", "value": "Run " },
      { "type": "inlineCode", "value": "bun install" }
    ]
  },
  { "type": "code", "lang": "ts", "value": "const value = 1;" }
]
```

Supported block nodes include paragraphs, headings, code blocks, blockquotes,
nested ordered and unordered lists, thematic breaks, and GFM tables. Supported
phrasing nodes include emphasis, strong text, inline code, links, images, hard
breaks, and strikethrough. GFM task items use the optional `checked` field, and
ordered lists use `start` when numbering begins above one.

The persisted AST contains no parser positions or plugin-specific `data`. The
[Markdown input schema](https://github.com/atlante/atlante/blob/main/packages/pack/markdown/template.jsonc)
defines the accepted JSON contract, while the shared
[TypeScript AST union](https://github.com/atlante/atlante/blob/main/packages/schema/src/markdown-ast.ts)
describes the same node shapes for code that constructs input.

The 0.2.x Markdown contract is a breaking change. Existing shorthand blocks are
not accepted, and the current release provides no compatibility migration path.

## From input to a Markdown file

A template consists of two files: `template.jsonc` defines its input
contract, and `template.md` renders the validated input. The input contract
uses [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) to
describe accepted fields, their types, and which fields are required.

The first-party agent template requires `identity` and `mission`, which this
reviewer binding supplies directly in a configuration excerpt:

```jsonc
{
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews billing-api.",
      "identity": "You review billing-api.",
      "mission": "Find defects before merge."
    }
  }
}
```

The corresponding part of the agent template's renderer inserts those
fields beneath the headings it defines:

```hbs title="template.md — excerpt"
# Identity

{{identity}}

# Mission

{{mission}}
```

The resulting prompt contains the supplied content in that structure,
while `description` remains separate lookup metadata for the host:

```md
# Identity

You review billing-api.

# Mission

Find defects before merge.
```

## Reuse configured input

An instance preserves a template selection and configured input, so several
bindings can reuse the same starting content. For example, this local reviewer
instance selects the first-party agent template and supplies its required
fields:

```jsonc title="resources/reviewer/instance.jsonc"
{
  "$template": "@atlante/pack/agent",
  "description": "Reviews the implementation.",
  "identity": "You are a careful reviewer.",
  "mission": "Find defects before merge."
}
```

A binding can select that instance and customize its mission, preserving
the identity and description supplied by the instance:

```jsonc title="Configuration excerpt"
{
  "agents": {
    "reviewer": {
      "$instance": "./resources/reviewer",
      "mission": "Find breaking API changes before merge."
    }
  }
}
```

The bare locator `"reviewer": "./resources/reviewer"` selects the same
instance without adding a local override to its content. Resolution determines
which template renders the resulting input.

## Configuration and template fields

A binding combines fields owned by two schemas:

- **Configuration fields** come from Atlante's document schema. `$template`,
  `$instance`, `description`, and `values` control content selection,
  interpolation, or host metadata; they are not passed to the renderer.
- **Template fields** come from the selected template's schema and form the
  input passed to its renderer. The first-party agent template defines
  `identity`, `mission`, and `sections`, while another template can define
  different fields and validation rules.

Top-level agent and skill bindings can also omit the selector and use the
corresponding first-party default template.
The [binding reference](/reference/schema#binding-fields) documents the exact
defaults, selector rules, and distinction from nested resource selections.

## Template composition

A template can delegate part of its input to a child template through a
declared composition slot. For example, the first-party agent template can
use an instructions template to render a section of the reviewer's prompt.
The child owns that section's input and rendering, while the parent
determines where the rendered section appears. This lets several
templates reuse a section's structure without copying its renderer into
each parent template.

A workflow section is one example of template-defined content, rather than
a separate top-level collection in the configuration. Composed output remains
rendered content; it is not interpreted again as parent template source.

:::note
[Template syntax](/reference/template-syntax#composition-slots) defines slot
declarations and rendering rules, including required references and cycle
checks. [Author a pack](/guides/authoring-packs) covers the procedure for
creating templates and instances.
:::
