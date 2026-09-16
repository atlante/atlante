---
title: Configuration
description: How configuration brings agents, skills, and reusable guidance into one versioned harness.
---

Your `atlante.jsonc` is the entry point for the harness configuration. It
selects the agents, skills, presets, and resources to build, while values
provide project-specific input to reusable content stored in separate files.

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

## Output directories

Output options select where native files land. Agents default to
`.opencode/agents`, and skills default to `.opencode/skills/atlante`. Each
kind accepts an independent `outDir` override. A custom directory keeps the
same file layout and remains your responsibility for version control and host
discovery.

## Presets as a starting point

A preset is a reusable configuration document that can supply agents,
skills, values, and other configuration fields. Selecting it through
`extends` lets your project inherit those choices and override the parts
that differ.
For example, the bundled `@atlante/pack` preset supplies a starting harness
that your local configuration can customize.
[Resources](/concepts/resources) explains where reusable content lives, and
[Resolution](/concepts/resolution) explains how those layers combine.

## Source and native output

The configuration and selected resources form the source of the harness. Each
build turns that source into native agent and skill files for the host.

```text
configuration + selected resources
    -> validation and resolution
    -> rendering
    -> native agent and skill files
```

OpenCode discovers the generated files when it starts, while the ownership
manifest tells later builds which files Atlante manages.
[Evaluation](/concepts/evaluation) uses the built harness to run defined tasks
and check their results.

:::note
See the [Schema reference](/reference/schema) for fields and source formats,
[Customize your harness](/guides/building-a-harness) for the authoring workflow,
and [Materialization](/reference/materialization) for native output paths and
ownership.
:::
