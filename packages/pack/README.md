# `@atlante/pack`

Atlante's first-party static pack is, first of all, a set of templates:
generic agent, skill, workflow, and content templates that you compose into
your own agents, skills, and instances through `$template` selections in
`atlante.jsonc`. On top of those templates, the pack ships a default preset
so a new project starts from a working harness: the `atlante` agent, the four
delivery-phase skills `brainstorm`, `plan`, `build`, and `review`, and the
`harness` stewardship skill.

## Preset design

The preset is minimal on purpose. Current models follow instructions closely
but stall on unclear or conflicting guidance, so provider guidance favors
flexible harnesses with few, precise, outcome-focused instructions and
expects scaffolding to shrink as capabilities improve. See [OpenAI's
prompting best practices](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices)
and the curated [harness-engineering resource list](https://github.com/ai-boost/awesome-harness-engineering)
for the full picture. The pack follows that shape: each section carries one
concern, invariants state only binding guarantees, and the atlante selects
the phases and skills a task actually needs instead of running a fixed
pipeline.

## Default usage

Initialize a project with the first-party pack:

```bash
npx atlante init
```

The CLI selects the default preset from `@atlante/pack` and writes
`"extends": "@atlante/pack"` to `atlante.jsonc`, then materializes the initial
native outputs. The default initialization path resolves the pack from the CLI
installation, so it does not require a separate `@atlante/pack` installation.

## Explicit usage

Install the pack when a project-authored configuration references it directly:

```bash
npx atlante pack install @atlante/pack
```

The command validates the pack and delegates the installation to your
project's package manager.

Then extend the preset and select a reusable template in `atlante.jsonc`:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack",
  "values": {
    "project": "my-app",
  },
  "agents": {
    // A project-specific agent: the preset already provides the
    // general-purpose atlante, so add the roles your project needs.
    "migration-writer": {
      "$template": "@atlante/pack/agent",
      "description": "Writes and reviews schema migrations for {{values.project}}.",
      "identity": "You are the migration specialist on {{values.project}}.",
      "mission": "Ship safe, reversible, and tested schema migrations.",
      "sections": [
        {
          "responsibilities": [
            "Write forward and rollback migrations for schema changes",
            "Review migrations for data-loss risks before they merge",
          ],
        },
        {
          "invariants": ["Every migration ships with a tested rollback path."],
        },
      ],
    },
  },
}
```

`extends` selects a preset. `$template` selects a template, whose input
schema defines the remaining fields for that agent or skill. Local
configuration takes precedence over the inherited preset. The
[customize your harness](https://docs.atlante.sh/guides/building-a-harness)
guide walks through a complete project-specific agent and skill on top of
the preset.

## Workflow

`@atlante/pack/workflow` provides a generic ordered prose-workflow template and
a concrete first-party instance. The generic template accepts only non-empty
`phases`, each with a `name`, non-empty `instructions`, and an optional
artifact `output`. It renders the phases in configured order but does not
execute or enforce them.

The concrete instance defines `Brainstorm`, `Plan`, `Build`, and `Review`. The
atlante decides which phases materially improve the result, preserves the
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
| Agent instance | `@atlante/pack/atlante` |
| Phase skill instances | `@atlante/pack/brainstorm`, `@atlante/pack/plan`, `@atlante/pack/build`, `@atlante/pack/review` |
| Stewardship skill instance | `@atlante/pack/harness` |
| Agent and skill templates | `@atlante/pack/agent`, `@atlante/pack/skill` |
| Workflow and content templates | `@atlante/pack/workflow`, `@atlante/pack/markdown`, `@atlante/pack/artifact` |
| Section templates | `@atlante/pack/gotchas`, `@atlante/pack/instructions`, `@atlante/pack/responsibilities`, `@atlante/pack/invariants`, `@atlante/pack/references` |

The preset's skill bindings are locator-only, so each skill instance owns its
description. The agent template renders an optional identity and mission with
ordered sections; the skill template additionally supports `references`
sections, which render named entries with their locations and optional
read-when guidance. Both templates support ordered `markdown`,
`instructions`, `responsibilities`, `gotchas`, `workflow`, and `invariants`
sections. Responsibilities name owned outcomes, instructions describe
ordered actions, and invariants carry binding guarantees and approval gates.
The [templates](https://docs.atlante.sh/concepts/templates) concept explains
how templates compose, and the
[template syntax](https://docs.atlante.sh/reference/template-syntax)
reference covers the interpolation you can use when authoring your own.

## Harness stewardship

`@atlante/pack/harness` is not a workflow phase. It carries the conditional
operational guidance for initializing, configuring, validating, building,
troubleshooting, and improving an Atlante harness. The atlante prompt routes
harness-touching work to it alongside the active phase skills; it supplements
them rather than replacing them. The skill keeps permanent policy
authoritative: concepts, resource selection, the source-versus-generated
boundary, and the separately approved harness-improvement cycle.
Command-level mechanics are provisional, so deterministic tools can absorb
them later without changing the policy. Harness changes always require
explicit developer approval and run as their own delivery cycle.

## Evaluation suite

The first-party pack publishes an evaluation suite under `eval/`, including
scenario documents, their fixtures, and a self-reported run report. The
suite is a starting point: its three scenarios cover the agent binding and
the workflow's policy boundaries, and individual skills have no dedicated
scenarios yet. A project that extends the pack does not run this suite
automatically. Opt in from the project configuration:

```jsonc
{
  "eval": {
    "host": "opencode",
    "include": ["@atlante/pack"]
  }
}
```

Pack scenario fixtures resolve relative to the pack root. The consuming
project's host, model, and budget remain authoritative. Atlante reads pack
metadata during discovery, but resolution, validation, build, and package sync
do not execute the suite; only an explicit `atlante eval` run delegates it to
the host.

The published report is labeled **self-reported evaluation** wherever a pack
consumer displays it. Its run date, Atlante version, host, model, model
version, and per-scenario pass rates provide provenance, not Atlante
certification or an independent security or quality verdict. Fixtures, setup
commands, and checks remain executable tool-level policy and should be reviewed
before running a pack suite.

## Markdown template

The `@atlante/pack/markdown` template accepts an ordered array of canonical,
type-discriminated Markdown nodes. For example:

```json
[
  {
    "type": "heading",
    "depth": 2,
    "children": [{ "type": "text", "value": "Installation" }]
  },
  {
    "type": "paragraph",
    "children": [
      { "type": "text", "value": "Run " },
      { "type": "inlineCode", "value": "bun install" }
    ]
  }
]
```

The AST supports the selected CommonMark and GFM block and inline nodes,
including nested lists, block quotes, fenced code, links, images, tables, task
items, hard breaks, and strikethrough. Parser-only fields such as `position`
and plugin-specific `data` are not part of the contract. The contract is
strict: unsupported syntax is rejected rather than emitted through a raw
fallback. The template is also the import contract:
[`atlante import`](https://docs.atlante.sh/reference/cli) converts an
existing host agent or skill from a Markdown file into a local pack,
emitting the markdown nodes this template accepts.

## Community

Join the [Atlante Discord](https://discord.com/invite/W5EcwZvx7) to discuss
this pack, or a pack you are thinking of building. The
[author a pack](https://docs.atlante.sh/guides/authoring-packs) guide shows
how a pack is put together. Contributions follow
[CONTRIBUTING.md](https://github.com/atlante/atlante/blob/main/CONTRIBUTING.md).

## License

[MIT](https://github.com/atlante/atlante/blob/main/packages/pack/LICENSE).
