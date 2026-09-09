---
title: Resolution
description: How presets, local overrides, and selected resources become the effective configuration of a harness.
---

Inheritance lets a configuration reuse existing choices and override only
the parts that differ for a project, while resolution follows those inherited
choices and selected resources to determine the effective configuration that
a build will render.

## Preset order and local choices

`extends` selects one preset or an ordered list, with each preset resolving
its own inherited configuration first. Atlante combines the presets from
left to right, then applies the project configuration as the final layer.

```text
base preset + another preset + project configuration
                         ↓
              effective configuration
```

Later layers replace conflicting scalar values, while fields they leave
unspecified can retain the values inherited from earlier layers.

## What an override changes

The following excerpts show only the fields involved in a project override
of a local review preset. Other binding fields, such as its template
selection and identity, are omitted from these excerpts.

The preset supplies shared values and an initial set of instructions for
the reviewer agent:

```jsonc title="packs/review/atlante.jsonc — excerpt"
{
  "values": {
    "project": "shared-project",
    "language": "TypeScript",
    "legacyRule": "Prefer callbacks."
  },
  "agents": {
    "reviewer": {
      "mission": "Find defects before merge.",
      "sections": [
        { "instructions": ["Review error handling.", "Check public APIs."] }
      ]
    }
  }
}
```

The project changes the name and review focus, replaces the sections, and
removes a value it no longer needs:

```jsonc title="atlante.jsonc — excerpt"
{
  "extends": "./packs/review",
  "values": {
    "project": "billing-api",
    "legacyRule": null
  },
  "agents": {
    "reviewer": {
      "mission": "Find breaking API changes before merge.",
      "sections": [
        { "instructions": ["Check database migrations."] }
      ]
    }
  }
}
```

The effective fields combine inherited values with the project's overrides,
while the removed value disappears from the result:

```jsonc title="Effective configuration — excerpt"
{
  "values": {
    "project": "billing-api",
    "language": "TypeScript"
  },
  "agents": {
    "reviewer": {
      "mission": "Find breaking API changes before merge.",
      "sections": [
        { "instructions": ["Check database migrations."] }
      ]
    }
  }
}
```

The example illustrates four merge rules that apply throughout configuration
inheritance, rather than only to agent bindings:

- Objects merge recursively.
- Arrays replace inherited arrays rather than appending to them.
- Scalars replace inherited scalars.
- `null` removes an inherited field.

Replacing `sections` removes the earlier instructions from this reviewer;
it does not add migration checks to the inherited list. Removing a value
also removes it as a possible input, so remaining references to that name
need another value in scope.

## From inheritance to native output

Preset precedence determines the global configuration and each binding's
inherited fields. [Binding-local values](/concepts/values) then override
matching global values only within that binding, so changing the project name
for one reviewer leaves other agents and skills unchanged.

Resolution follows selected resources, combines instance content with binding
overrides, interpolates values, and validates the result against each binding's
effective template. This produces the canonical document: effective bindings
without inheritance instructions or unresolved source selectors. Template
composition then renders that input as Markdown, as described in
[Templates](/concepts/templates).

`atlante validate` checks this resolved input without rendering files.
`atlante build` performs the same checks, then renders and
[materializes native output](/reference/materialization). The same inputs,
including [working directory values](/concepts/values#the-working-directory-value),
produce the same output. [Evaluation](/concepts/evaluation) assesses the built
harness on defined tasks.

:::note
For exact precedence and failures, see the
[Schema reference](/reference/schema#defaults-and-precedence) and
[Diagnostics](/reference/diagnostics).
:::
