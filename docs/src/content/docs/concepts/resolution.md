---
title: Inheritance and resolution
description: How presets, local overrides, and selected resources become the effective configuration of a harness.
---

Inheritance lets a configuration reuse existing choices and override only
the parts that differ for a project. Resolution follows those inherited
choices and selected resources to determine the effective configuration
that a build will render.

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

## Inheritance and value scope

Preset precedence determines the global configuration and the fields of
each binding after its inherited layers have combined. Binding-local values
then provide a separate scope for interpreting references within that
binding, overriding matching global keys.

[Values](/concepts/values) shows why a project-name override for one reviewer
leaves other agents and skills unchanged.

## From selected content to native output

Resolution also follows resource selections, combines instance content with
binding overrides, and determines the effective template for each binding.
Value interpolation and template-input validation establish the content
that the selected renderers will receive.

The resolved configuration is called the canonical document: it contains
effective bindings rather than inheritance instructions or unresolved
source selectors. [Templates and instances](/concepts/templates) explains how
template composition then turns validated input into Markdown.

`atlante validate` checks source structure, resolves selected content, and
validates effective input without rendering or materializing native files.
`atlante build` includes those checks, renders the content, and materializes
native output through the selected host adapter.

The same inputs produce the same resolved content, including any working
directory value described in [Values](/concepts/values#the-working-directory-value).
[Materialization](/reference/materialization) describes the generated files,
while [Evaluation](/concepts/evaluation) explains how a built harness is
assessed on tasks.

The [Schema reference](/reference/schema#defaults-and-precedence) defines
the exact precedence rules, and [Diagnostics](/reference/diagnostics)
documents failures encountered during validation and resolution.
