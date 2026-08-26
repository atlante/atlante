# `@atlante/pack`

Atlante's first-party static pack gives a project a useful default agent and
skills for deliberate AI-assisted work. It provides the `architect` agent,
`brainstorming` and `workflow` skills, and reusable templates and instances for
composing your own agents, skills, workflows, and supporting prompt content.

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

The protocol assigns every adaptive phase exactly one disposition:

- `full` executes the complete phase.
- `reduced` executes only the explicitly justified reduced scope.
- `skipped` omits the phase only when its own instructions permit it.

Before acting, the protocol MUST record the classification, evidence,
disposition, and rationale. Missing or conflicting evidence, or material
uncertainty, MUST use the conservative `full` fallback. Reclassification MUST
follow implementation or review evidence that changes risk. Phase instructions
MUST own concrete eligibility and escalation criteria; developer or project
rules MAY strengthen the protocol but MUST NOT silently weaken a disposition.

This is one built-in, prompt-only declarative capability. It does not execute
phases or maintain runtime state, and it is not a configurable profile,
taxonomy, enum, or skip matrix.

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
`workflow` skills. The `workflow` skill is the `delivery-workflow` instance. The
agent template accepts optional top-level `responsibilities` alongside
`identity` and `mission`. The agent and skill templates support ordered
`markdown`, `instructions`, `gotchas`, `workflow`, and `invariants` sections.
Invariants are binding guarantees and approval gates, not suggestions.

## Pack behavior

This is a static pack with `atlante.format: 1`; it has no runtime
JavaScript entry point. Atlante loads only the selected template or instance
and its transitive dependencies. It does not scan installed packages or install
dependencies, so direct project references must be declared and installed by
the project's package manager.
