---
title: Configuration
description: How configuration brings agents, skills, and reusable guidance into one versioned harness.
---

The configuration describes which agents and skills belong to your harness
and where their guidance comes from. It brings those choices together with
the values that adapt reusable content to your project.

Your `atlante.jsonc` is the entry point to that configuration, while selected
presets and resources supply content it can reuse. The configuration can grow
across several files without requiring every instruction to live in the
root document.

## Agents and skills

An agent binding gives a named agent the instructions that define its role
in the host. A skill binding provides named, reusable guidance that the host
can make available when relevant to a task.

For example, a reviewer agent can have a project-specific mission while a
review skill provides reusable review guidance. Both select content through
the same [template and instance model](/concepts/templates), but they become
different kinds of native output.

This configuration defines a reviewer for `billing-api` and selects an
existing skill from the first-party pack:

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
    }
  },
  "skills": {
    "code-review": "@atlante/pack/review"
  }
}
```

The map keys, `reviewer` and `code-review`, identify the resulting agent and
skill in the host. Their content can change without changing those names or
the places that refer to them.

## Presets as a starting point

A preset is a reusable configuration document that can supply agents,
skills, values, and other configuration fields. Selecting it through
`extends` lets your project inherit those choices and override the parts
that differ.

For example, the bundled `@atlante/pack` preset supplies a starting harness
that your local configuration can customize. [Packs and resources](/concepts/resources)
explains where reusable content lives; [Inheritance and resolution](/concepts/resolution)
explains how those layers combine.

## Source and native output

The configuration and selected resources are the source you maintain;
native agent and skill files are derived from them.

```text
configuration + selected resources
    -> validation and resolution
    -> rendering
    -> native agent and skill files
```

A build turns that source into files OpenCode can discover, together with
an ownership manifest recording the generated files. [Evaluation](/concepts/evaluation)
uses the built harness to assess results on defined tasks, beyond checking
that the configuration is valid.

The [Schema reference](/reference/schema) defines the exact fields and both
supported source formats, `atlante.jsonc` and `atlante.json`.
[Build a harness](/guides/building-a-harness) covers the authoring procedure,
and [Materialization](/reference/materialization) describes the native output.
