# `@atlante/pack`

Atlante's first-party static pack gives a project a useful default agent and
skills for deliberate AI-assisted work. It provides the `architect` agent, the
four delivery-phase skills `brainstorm`, `plan`, `build`, and `review`, and
reusable templates and instances for composing your own agents, skills,
workflows, and supporting prompt content.

## Default usage

Initialize a project with the first-party pack:

```bash
npx @atlante/cli init
```

The CLI selects the default preset from `@atlante/pack` and writes
`"extends": "@atlante/pack"` to `atlante.jsonc`. It also registers the
OpenCode adapter package and builds the initial artifacts. The default initialization
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

`extends` selects a preset. `$template` selects a template, whose input
schema defines the remaining fields for that agent or skill. Local
configuration takes precedence over the inherited preset.

## Adaptive workflow phases

The reusable workflow template supports opt-in phase resizing:

```jsonc
{
  "phases": [
    {
      "name": "Review",
      "policies": { "adaptive": true },
      "instructions": ["Review the change."],
    },
  ],
}
```

`policies.adaptive` defaults to `false`, so an omitted or `false` value leaves
the phase mandatory. If any phase is adaptive, the rendered workflow emits one
shared protocol and labels each phase as `adaptive` or `mandatory`.

An adaptive phase is optional and SHOULD add only as much ceremony as the work
needs. Before running it, assess whether it would materially improve the
outcome using task complexity, risk, uncertainty, and existing evidence: skip
the phase when it would not materially improve the outcome, briefly stating
why, and otherwise run it with depth proportional to the work while preserving
its required output, approvals, and safety gates. Reassess later adaptive
phases when implementation or review reveals new material evidence; a
non-adaptive phase remains mandatory and runs as written.

This is one built-in, prompt-only declarative capability. It does not execute
phases or maintain runtime state, and it is not a configurable profile,
taxonomy, enum, or skip matrix.

## Contents

Useful public locators include:

| Category | Locators |
| --- | --- |
| Default preset | `@atlante/pack` |
| Agent instance | `@atlante/pack/architect` |
| Skill instances | `@atlante/pack/brainstorm`, `@atlante/pack/plan`, `@atlante/pack/build`, `@atlante/pack/review` |
| Agent and skill templates | `@atlante/pack/agent`, `@atlante/pack/skill` |
| Supporting templates | `@atlante/pack/workflow`, `@atlante/pack/markdown`, `@atlante/pack/artifact`, `@atlante/pack/gotchas`, `@atlante/pack/instructions`, `@atlante/pack/invariants` |

The default preset exposes exactly one agent binding, `architect`, and four
public skill bindings: `brainstorm`, `plan`, `build`, and `review`. These are
agent-agnostic phase contracts; the `architect` agent orchestrates them by
name. The skill bindings are locator-only, so each skill instance owns its
description. The agent template accepts optional top-level `responsibilities`
alongside `identity` and `mission`. The agent and skill templates support
ordered `markdown`, `instructions`, `gotchas`, `workflow`, and `invariants`
sections. Invariants are binding guarantees and approval gates, not
suggestions.

## Pack behavior

This is a static pack with `atlante.format: 1`; it has no runtime
JavaScript entry point. Atlante loads only the selected template or instance
and its transitive dependencies. It does not scan installed packages or install
dependencies, so direct project references must be declared and installed by
the project's package manager.
