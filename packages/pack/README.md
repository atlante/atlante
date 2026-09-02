# `@atlante/pack`

Atlante's first-party static pack gives a project a useful default agent and
skills for deliberate AI-assisted work. It provides the `architect` agent, the
four delivery-phase skills `brainstorm`, `plan`, `build`, and `review`, the
additional non-phase `harness` stewardship skill, and reusable templates and
instances for composing your own agents, skills, workflows, and supporting
prompt content.

## Default usage

Initialize a project with the first-party pack:

```bash
npx @atlante/cli@latest init
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
      "sections": [
        {
          "responsibilities": [
            "Review implementations for bugs and design issues",
            "Check that project invariants remain satisfied.",
          ],
        },
      ],
    },
  },
}
```

`extends` selects a preset. `$template` selects a template, whose input
schema defines the remaining fields for that agent or skill. Local
configuration takes precedence over the inherited preset.

## Workflow

`@atlante/pack/workflow` provides a generic ordered prose-workflow template and
a concrete first-party instance. The generic template accepts only non-empty
`phases`, each with a `name`, non-empty `instructions`, and an optional
artifact `output`. It renders the phases in configured order but does not
execute or enforce them.

The concrete instance defines `Brainstorm`, `Plan`, `Build`, and `Review`. The
architect decides which phases materially improve the result, preserves the
order among the selected phases, and treats the phases and skills as guidance.
`Plan` and `Review` have persistent artifact paths rooted at
`{{values.workflow-root}}`; the preset default is `.atlante/workflows`, and
projects may override it. `Brainstorm` and `Build` outputs do not have file
paths. `Review` explicitly supports task-level and final review boundaries,
and Build/Review corrections are bounded to five rounds per task by the
instance prose, not by template or runtime enforcement. Checkpoints are
project-approved reviewable change boundaries, not automatically Git commits.

## Contents

Useful public locators include:

| Category | Locators |
| --- | --- |
| Default preset | `@atlante/pack` |
| Agent instance | `@atlante/pack/architect` |
| Phase skill instances | `@atlante/pack/brainstorm`, `@atlante/pack/plan`, `@atlante/pack/build`, `@atlante/pack/review` |
| Stewardship skill instance | `@atlante/pack/harness` |
| Agent and skill templates | `@atlante/pack/agent`, `@atlante/pack/skill` |
| Supporting templates | `@atlante/pack/workflow`, `@atlante/pack/markdown`, `@atlante/pack/artifact`, `@atlante/pack/gotchas`, `@atlante/pack/instructions`, `@atlante/pack/responsibilities`, `@atlante/pack/invariants`, `@atlante/pack/references` |

The default preset exposes exactly one agent binding, `architect`, and five
public skill bindings: the four delivery-phase skills `brainstorm`, `plan`,
`build`, and `review`, plus the non-phase `harness` stewardship skill. The
workflow instance's phases reference the four phase skills, and the architect
selects the phases and skills that materially improve the result. The skill
bindings are locator-only, so each skill instance owns its description. The
agent template requires `identity` and `mission`; both agent and skill templates
support ordered `markdown`, `instructions`, `responsibilities`, `gotchas`,
`workflow`, and `invariants` sections. The skill template also supports
`references` sections, which render named links with optional read-when guidance.
Responsibilities name owned outcomes, while instructions describe ordered
actions and invariants carry binding guarantees and approval gates.

## Harness stewardship

`@atlante/pack/harness` is not a workflow phase. It carries the conditional
operational guidance for initializing, configuring, validating, building,
troubleshooting, and improving an Atlante harness, and the architect prompt
routes harness-touching work to it alongside the active phase skills — it
supplements them rather than replacing them. The skill keeps permanent policy
(concepts, resource selection, the source-versus-generated boundary, and the
separately approved harness-improvement cycle) authoritative and treats
command-level mechanics as provisional, so deterministic tools can absorb the
mechanics later without changing the policy. Harness changes always require
explicit developer approval and run as their own delivery cycle.

## Pack behavior

The `@atlante/pack/markdown` template expects an ordered block array, not a
string. This is a breaking change for authored configurations that used the old
form: rewrite `{ "markdown": "Body" }` as
`{ "markdown": [{ "p": ["Body"] }] }` before upgrading to a release that
contains this template.

This is a static pack with `atlante.format: 1`; it has no runtime
JavaScript entry point. Atlante loads only the selected template or instance
and its transitive dependencies. It does not scan installed packages or install
dependencies, so direct project references must be declared and installed by
the project's package manager.
