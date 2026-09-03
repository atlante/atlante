---
title: Getting started
description: Build a versioned coding-agent harness with the published CLI.
---

Atlante requires [Node.js](https://nodejs.org/) 22 or later. Run the CLI from the
project you want to configure. The published CLI bundles the first-party
`@atlante/pack`, so the default path does not require a separate pack install.

The goal is simple: finish with a versioned source document and host-native
agent and skill files your coding-agent host discovers directly.

## 1. Invoke or install the CLI

For a one-off first build, use `npx` from your project directory:

```sh
npx @atlante/cli@latest init
```

If the project should pin the CLI version, install it as a development
dependency, then keep using the project-local command through `npx`:

```sh
npm install --save-dev @atlante/cli
npx atlante init
```

## 2. See what `init` creates

`init` scaffolds `atlante.jsonc`, materializes the initial native outputs, and
enforces the ignore policy: `.opencode/agents/`, `.opencode/skills/`, and
`.atlante/` are added to `.gitignore`, so generated files stay local. If an
older Atlante version registered `@atlante/opencode` as an OpenCode plugin,
`init` removes that registration. Existing host settings in the OpenCode
config are preserved.
You do not need to create a second onboarding configuration.

The generated source selects the default first-party preset:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack"
}
```

Read the file, then add `values`, `agents`, or `skills` as the harness grows. See
[Configuration](/concepts/configuration) for the document model and
[Schema](/reference/schema) for the generated contract.

## 3. Validate and build

After changing `atlante.jsonc` or selected resources, validate the source first:

```sh
npx @atlante/cli@latest validate
```

Validation parses the document, resolves selected content, and checks values,
template schemas, composition, and template-owned input. It does not render or
materialize anything. Errors include structured diagnostics with codes and
source locations; see [Diagnostics](/reference/diagnostics).

When validation passes, materialize the native outputs:

```sh
npx @atlante/cli@latest build
```

Build repeats validation, renders deterministic Markdown, and materializes
the host-native files plus the ownership manifest. Both commands report the
resolved filesystem path they used, so output may be an absolute path rather
than the shortened examples shown here.

## 4. Inspect the native outputs

Inspect the generated files after `init` or `build`:

```text
<project>/.opencode/
├── agents/<id>.md
└── skills/<id>/SKILL.md
<project>/.atlante/opencode-native.json
```

The ownership manifest identifies each generated file with its ID, path, and
SHA-256 digest. OpenCode discovers these files when it starts; restart it to
pick up new or changed agents. Keep the generated outputs local: rendered
values may contain project-sensitive content, and they are generated output
rather than source configuration (`init` already ignores them in git).

That is the first useful boundary: Atlante renders the prompts and
materializes the files; the host discovers them and executes agents and
skills. Atlante does not execute agents, skills, project code, or LLM
inference.

## 5. Continue to the harness

Your next step can be small:

- [Build a harness](/guides/building-a-harness) to add an agent, skill, or value.
- [Use OpenCode](/guides/opencode) to connect the native outputs to the supported host.
- Read [CLI](/reference/cli) for command options, [Materialization](/reference/materialization) for output details, or [Diagnostics](/reference/diagnostics) when a build fails.
