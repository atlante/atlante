---
title: Getting started
description: Build a versioned coding-agent harness with the published CLI.
---

Run the CLI from the project you want to configure. The published CLI bundles
the first-party `@atlante/pack`, so the default path does not require a
separate pack install.

**By the end:** you will have a versioned `atlante.jsonc` and host-native agent
and skill files that OpenCode can discover.

## 1. Invoke or install the CLI

For a one-off first build, use `npx` from your project directory:

```sh
npx @atlante/cli@latest init
```

If the project should pin the CLI version, install it as a development
dependency and keep using the project-local command through `npx`:

```sh
npm install --save-dev @atlante/cli
npx atlante init
```

:::note
The CLI requires [Node.js](https://nodejs.org/) 22 or later. It bundles the
first-party `@atlante/pack`, so the default path needs no separate pack
install.
:::

## 2. See what `init` creates

`init` scaffolds `atlante.jsonc`, runs the first build, and adds the generated
folders to `.gitignore`:

```text
.opencode/agents/
.opencode/skills/
.atlante/
```

The entries exist because generated files are derived from the source, and
rendered values may contain project-sensitive content. They are a default, not
a rule: if your team prefers generated output under version control, remove
the entries and commit the files. The ownership manifest detects any
out-of-band edit, and the next build fails closed rather than overwrite one.
[Troubleshooting](/troubleshooting) describes both directions.

:::caution
Generated native files are derived output. Edit `atlante.jsonc` and rebuild
instead of changing `.opencode/` or `.atlante/` directly.
:::

The generated source selects the default first-party preset:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack"
}
```

Read the file, then add `values`, `agents`, or `skills` as the harness grows.
[Configuration](/concepts/configuration) explains the document model and
[Schema](/reference/schema) the exact contract.

## 3. Validate and build

After changing `atlante.jsonc` or selected resources, validate first:

```sh
npx @atlante/cli@latest validate
```

Validation parses the document, resolves selected content, and checks values,
template schemas, composition, and template-owned input — without writing
anything. Failures come as structured diagnostics with stable codes and source
locations; see [Diagnostics](/reference/diagnostics).

When validation passes, materialize the native outputs:

```sh
npx @atlante/cli@latest build
```

Build repeats the validation, renders deterministic Markdown, and writes the
host-native files plus the ownership manifest.
[Materialization](/reference/materialization) documents the output contract.

## 4. Open the generated harness

OpenCode discovers the generated agents and skills when it starts; restart it
to pick up new or changed files. Model, mode, permission, and tool settings
stay in OpenCode's own configuration, outside the document.

## 5. Test the harness (optional)

`atlante eval` runs scenarios against the built outputs in a disposable
sandbox and grades them with deterministic checks. The checks never call a
model, so a scenario verdict is reproducible. Add an `eval` section and one
scenario document:

```jsonc title="atlante.jsonc"
{
  // ...
  "eval": {
    "host": "opencode",
    "scenarios": "eval/scenarios/*.eval.json*"
  }
}
```

```json title="eval/scenarios/hello.eval.json"
{
  "$schema": "https://atlante.sh/schema/v0.1/eval-scenario.json",
  "version": "0.1",
  "name": "hello",
  "task": {
    "fixture": "eval/fixtures/empty",
    "prompt": "Create a file named hello.txt containing hello."
  },
  "checks": [
    { "type": "file-contains", "path": "hello.txt", "pattern": "hello" },
    { "type": "diff-allowlist", "allow": ["hello.txt"] }
  ]
}
```

```sh
npx @atlante/cli@latest eval
```

Each trial copies the fixture into a fresh sandbox, runs the prompt with the
built agents and skills, and grades the checks. Eval reads the outputs of the
build above; rebuild after source changes. The [Eval](/reference/eval)
reference documents scenarios, checks, budgets, and reports.

## 6. Continue

- [Build a harness](/guides/building-a-harness) to add an agent, skill, or
  value.
- [CLI](/reference/cli) for command options,
  [Materialization](/reference/materialization) for output details, and
  [Diagnostics](/reference/diagnostics) when a build fails.
