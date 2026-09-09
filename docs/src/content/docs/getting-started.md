---
title: Getting started
description: Initialize Atlante in your project and build your first OpenCode agents and skills.
---

Initialize Atlante in an existing project and build the agent and skill files
that OpenCode will load.

## Before you begin

You need [Node.js](https://nodejs.org/) 22 or later. Open a terminal in the
project directory where you want to keep your harness configuration.

You can initialize and build without installing OpenCode. To use the resulting
agents and skills, you will also need [OpenCode](https://opencode.ai/docs/).

## Initialize your project

Create the configuration and run the first build:

```sh
npx @atlante/cli@latest init
```

The CLI uses the bundled `@atlante/pack` preset, so you do not need to install
a separate pack. The preset provides an `architect` agent, the `brainstorm`,
`plan`, `build`, and `review` skills, and a `harness` skill for working on the
harness itself.

## Inspect the configuration and output

Open `atlante.jsonc`. Its configuration selects the preset through `extends`:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack"
}
```

The build creates native files alongside that source:

```text
my-project/
├── atlante.jsonc
├── .opencode/
│   ├── agents/
│   │   └── architect.md
│   └── skills/
│       ├── brainstorm/SKILL.md
│       ├── plan/SKILL.md
│       ├── build/SKILL.md
│       ├── review/SKILL.md
│       └── harness/SKILL.md
└── .atlante/
    └── opencode-native.json
```

Open `.opencode/agents/architect.md` to inspect the agent's description and
instructions. The ownership manifest, `.atlante/opencode-native.json`, records
the files managed by the build.

Keep `atlante.jsonc` and any resources you author in version control. `init`
adds `.opencode/agents/`, `.opencode/skills/`, and `.atlante/` to `.gitignore`
because those files can be rebuilt from the source.

:::note
Make changes in `atlante.jsonc` or its selected resources, then rebuild. Native
files are generated output. See [Materialization](/reference/materialization)
for output ownership and [Troubleshooting](/troubleshooting) for versioning
alternatives and recovery from output edits.
:::

## Open the harness in OpenCode

Start OpenCode from the same project directory, or restart an existing session
so it discovers the new files. The `architect` agent should now be available.

You can also inspect the agent list from the terminal:

```sh
opencode agent list
```

Look for `architect` in the list. If it is missing, confirm that you ran the
command from the directory containing `.opencode/agents/architect.md`.

Choose a model and configure permissions through
[OpenCode's configuration](https://opencode.ai/docs/config/). These settings
remain in OpenCode's own files when Atlante rebuilds the harness.

You now have the default harness built from a configuration in your project.

## Use a project-local CLI

For ongoing work, install the CLI as a development dependency in the project
that owns your `package.json`:

```sh
npm install --save-dev @atlante/cli
```

If the repository has no `package.json`, create one with `npm init -y` before
installing. Commit the manifest and lockfile with your configuration so other
contributors can install the same CLI version.

After installing locally, use `npx atlante` rather than requesting `@latest`.
For example, rebuild after a configuration change with:

```sh
npx atlante build
```

The guides use this project-local command. You do not need to run `init`
again when installing the CLI into an already initialized project.

## Next steps

- [Customize your harness](/guides/building-a-harness) with a project-specific
  reviewer and reusable review guidance.
- [Evaluate your harness](/guides/evaluating-a-harness) on a task with explicit
  checks for the result.
- Read [Configuration](/concepts/configuration) to understand how presets,
  agents, skills, and values fit together.
