---
title: Build a harness
description: Organize agents, skills, workflows, and project values in one configuration.
---

A harness starts with a small set of roles and reusable guidance. Keep the
configuration in the repository so changes can be reviewed alongside code.

## Start from the first-party pack

```sh
npx @atlante/cli init
```

The default preset provides the `architect` agent and the `brainstorming` and
`workflow` skills. Extend it rather than copying its resources into the project.

## Add an agent

Use the `@atlante/pack/agent` template when a project needs a local role:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack",
  "values": {
    "project": "billing-api",
    "language": "TypeScript"
  },
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews changes for defects and design risks.",
      "identity": "You are a senior {{values.language}} reviewer on {{values.project}}.",
      "mission": "Find defects before changes are merged.",
      "responsibilities": [
        "Read the relevant source and tests",
        "Check behavior against the project requirements",
        "Report actionable findings with file and line references"
      ],
      "sections": [
        {
          "invariants": [
            "Do not approve a change while a material defect remains unresolved."
          ]
        }
      ]
    }
  }
}
```

The template owns the prompt fields. Read [templates and instances](/concepts/templates/)
for the supported section variants and composition rules.

## Add reusable skills

Skills are reusable Markdown guidance. They are addressed by `skillId` and are
not host-agent IDs:

```jsonc
{
  "skills": {
    "release-check": {
      "$template": "@atlante/pack/skill",
      "description": "Release checks for this project.",
      "sections": [
        {
          "instructions": [
            "Run the project checks before creating a release."
          ]
        }
      ]
    }
  }
}
```

The OpenCode adapter exposes resolved content through `atlante_skill`. Atlante
renders the skill but does not execute it.

## Version the change

Commit `atlante.jsonc` with the project code. Build artifacts are derived output
and should remain local. In review, inspect the source document and the command
results rather than committing `.atlante/`.
