---
title: Getting started
description: Build a versioned coding-agent harness with the published CLI.
---

Atlante requires [Node.js](https://nodejs.org/) 22 or later. Run the CLI from the
project you want to configure. The published CLI bundles the first-party
`@atlante/pack`, so the default path does not require a separate pack install.

The goal is simple: finish with a versioned source document and a verified,
host-neutral artifact tree that an adapter can hand to your coding-agent host.

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

`init` scaffolds `atlante.jsonc`, registers `@atlante/opencode` in
`opencode.jsonc` (or an existing `opencode.json`), and builds the initial state. It is both the starting scaffold
and the first build. Existing host settings in the OpenCode config are preserved.
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
publish artifacts. Errors include structured diagnostics with codes and source
locations; see [Diagnostics](/reference/diagnostics).

When validation passes, build the new artifact tree:

```sh
npx @atlante/cli@latest build
```

Build repeats validation, renders deterministic Markdown, and atomically
publishes a complete host-neutral artifact tree. Both commands report the
resolved filesystem path they used, so output may be an absolute path rather
than the shortened examples shown here.

## 4. Inspect the artifacts

Inspect `<project>/.atlante/artifacts/` after `init` or `build`:

```text
<project>/.atlante/artifacts/
├── manifest.json
├── agents/
└── skills/
```

`manifest.json` identifies each agent or skill payload and its SHA-256 digest.
The adapter verifies the complete tree before consuming it. Keep `.atlante/`
local: rendered values may contain project-sensitive content, and artifacts are
generated output rather than source configuration.

That is the first useful boundary: Atlante prepares and verifies the prompts;
the adapter materializes them, and the host executes agents and skills. Atlante
does not execute agents, skills, project code, or LLM inference.

## 5. Continue to the harness

Your next step can be small:

- [Build a harness](/guides/building-a-harness) to add an agent, skill, or value.
- [Use OpenCode](/guides/opencode) to connect verified artifacts to the supported host adapter.
- Read [CLI](/reference/cli) for command options, [Artifact](/reference/artifact) for verification details, or [Diagnostics](/reference/diagnostics) when a build fails.
