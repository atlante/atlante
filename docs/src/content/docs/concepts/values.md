---
title: Values
description: How named string values adapt reusable guidance to projects and individual bindings.
---

Values name the pieces of a prompt that change from one project or binding to
another. They let a project name or shared rule appear in several instructions
without maintaining a separate copy in every field.

## Global values and local overrides

Global values provide shared inputs for the harness, while binding-local
values adapt those inputs to one agent or skill. A local value overrides a
matching global key only within the binding that declares it.

This configuration gives the main reviewer a shared project name and
overrides that name for a worker-specific reviewer:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "values": { "project": "billing-api" },
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews {{values.project}}.",
      "identity": "You review {{values.project}}.",
      "mission": "Find defects before merge."
    },
    "worker-reviewer": {
      "$template": "@atlante/pack/agent",
      "values": { "project": "billing-worker" },
      "description": "Reviews {{values.project}}.",
      "identity": "You review {{values.project}}.",
      "mission": "Find defects before merge."
    }
  }
}
```

After interpolation, each description contains the project name from the
value scope of its own binding:

```text
reviewer.description        -> Reviews billing-api.
worker-reviewer.description -> Reviews billing-worker.
```

The worker override leaves the global value unchanged, so other bindings
still receive `billing-api` unless they define their own override.

## From a value reference to rendered text

Interpolation substitutes `{{values.key}}` references in descriptions and
template-owned content before the selected template renders its input.
For the main reviewer, the identity passes through these stages:

```text
authored identity:  You review {{values.project}}.
resolved identity:  You review billing-api.
renderer field:    {{identity}}
rendered text:     You review billing-api.
```

The value reference belongs to the authored content, while `{{identity}}`
belongs to the template's rendering syntax. The renderer receives the
resolved identity field, not the values dictionary as an additional input.

Missing value references produce diagnostics rather than unresolved prompt
text, making a misspelled name visible during validation.

## Values and structured input

Values are strings, which makes them suitable for names, descriptions, and
rules inserted into other text fields. A template can separately accept
arrays, objects, or other input types defined by its own schema.

For example, the first-party agent template accepts a `sections` array as
structured input rather than as a named value. [Templates and instances](/concepts/templates)
explains that input contract, while [Inheritance and resolution](/concepts/resolution)
describes removing an inherited value with `null`.

## The working directory value

The supported system value `{{sys.cwd.basename}}` supplies the basename of
the process's current working directory as a string. It can provide a
project name when the directory is an appropriate source for that value:

```jsonc title="Configuration excerpt"
{
  "values": {
    "project": "{{sys.cwd.basename}}"
  }
}
```

The working directory then becomes an input to the rendered content, so
changing its basename can change the resulting prompt. The [Schema reference](/reference/schema#agent-and-skill-maps)
defines the supported value namespace, and [Template syntax](/reference/template-syntax#the-rendering-input)
describes the input a renderer receives.
