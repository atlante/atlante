---
title: Templates and instances
description: How reusable input contracts, configured content, and bindings become agent and skill instructions.
---

A template defines the input it accepts and how that input becomes
Markdown for an agent or skill. An instance supplies reusable configured
input for one template, while a binding connects selected content to a
named agent or skill.

These roles separate the structure you reuse from the content you
customize and the host-facing name you give it.

## From input to Markdown

A template consists of two files: `template.jsonc` defines its input
contract, and `template.md` renders the validated input. The input contract
uses JSON Schema Draft 2020-12 to describe accepted fields, their types, and
which fields are required.

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
bindings can reuse the same starting content. This local reviewer instance
selects the first-party agent template and supplies its required fields:

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
instance without adding a local override to its content. An instance stores
configured input rather than rendered Markdown, and resolution determines
the single effective template that renders it.

## Configuration fields and template fields

Atlante's document schema defines configuration fields and binding metadata;
the selected template defines the input fields for its prompt content.
`$template`, `$instance`, `description`, and `values` are binding metadata,
separate from the input passed to the renderer.

Fields such as `identity`, `mission`, and `sections` come from the
first-party agent template, rather than a universal agent shape. A different
template can define other fields, with its own validation and rendering rules.

Top-level agent and skill bindings can also omit the selector and use the
corresponding first-party default template. The [binding reference](/reference/schema#binding-fields)
documents the exact defaults, selector rules, and distinction from nested
resource selections.

## Compose templates from smaller parts

A template can delegate part of its input to a child template through a
declared composition slot. For example, the first-party agent template can
use an instructions template to render a section of the reviewer's prompt.

The child owns that section's input and rendering, while the parent
determines where the resulting Markdown appears. This lets several
templates reuse a section's structure without copying its renderer into
each parent template.

A workflow section is one example of template-defined content, rather than
a separate top-level collection in the configuration. Composed Markdown
remains rendered content; it is not interpreted again as parent template
source.

[Template syntax](/reference/template-syntax#composition-slots) defines slot
declarations and rendering rules, including required references and cycle
checks. [Author a pack](/guides/authoring-packs) covers the procedure for
creating templates and instances.
