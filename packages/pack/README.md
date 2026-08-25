# `@atlante/pack`

Atlante's first-party resource pack gives a project a useful default agent and
skills for deliberate AI-assisted work. It provides the `architect` agent,
`brainstorming` and `workflow` skills, and reusable facets for composing your
own agents, skills, workflows, and supporting prompt content.

## Default usage

Initialize a project with the first-party pack:

```bash
npx @atlante/cli init
```

The CLI uses `@atlante/pack` as the default preset and writes
`"extends": "@atlante/pack"` to `atlante.jsonc`. It also registers the
OpenCode plugin and builds the initial artifacts. The default initialization
path resolves the pack from the CLI installation, so it does not require a
separate `@atlante/pack` installation.

## Explicit usage

Install the pack when a project-authored configuration references it directly:

```bash
npm install --save-dev @atlante/pack
```

Then extend the preset and select a reusable template in `atlante.jsonc`:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack",
  "values": {
    "project": "my-app",
  },
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews changes for defects and design issues.",
      "identity": "You are a thorough code reviewer on {{values.project}}.",
      "mission": "Find defects and design risks before changes are merged.",
      "responsibilities": [
        "Review implementations for bugs and design issues",
        "Check that project invariants remain satisfied.",
      ],
    },
  },
}
```

`extends` selects a preset. `$template` selects a template facet, whose input
schema defines the remaining fields for that agent or skill. Local
configuration takes precedence over the inherited preset.

## Contents

Useful public locators include:

| Category | Locators |
| --- | --- |
| Default preset | `@atlante/pack` |
| Agent instance | `@atlante/pack/architect` |
| Skill instances | `@atlante/pack/brainstorming`, `@atlante/pack/delivery-workflow` |
| Agent and skill templates | `@atlante/pack/agent`, `@atlante/pack/skill` |
| Supporting templates | `@atlante/pack/workflow`, `@atlante/pack/markdown`, `@atlante/pack/artifact`, `@atlante/pack/gotchas`, `@atlante/pack/instructions`, `@atlante/pack/invariants` |

The default preset exposes the `architect` agent and the `brainstorming` and
`workflow` skills. The `workflow` skill is the `delivery-workflow` instance.

## Pack behavior

This is a static resource package with `atlante.format: 1`; it has no runtime
JavaScript entry point. Atlante loads only the selected facet and its
transitive dependencies. It does not scan installed packages or install
dependencies, so direct project references must be declared and installed by
the project's package manager.
