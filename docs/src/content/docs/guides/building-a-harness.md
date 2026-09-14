---
title: Customize your harness
description: Add a project-specific reviewer and a reusable review skill to your OpenCode harness.
---

Using a TypeScript project named `billing-api` as its example, this guide adds
a project-specific reviewer and reusable API-review skill, then builds the
native files OpenCode will load.

## Prerequisites

Follow [Getting started](/getting-started) to initialize the project and
[install a project-local CLI](/getting-started#use-a-project-local-cli).
Run the commands in this guide from that project directory.

The example uses the first-party `@atlante/pack` templates directly without
extending the full preset, so the build adds only the reviewer and skill shown
here.

## Configure the OpenCode context server

`atlante init` registers a version-pinned local Atlante MCP server in the
OpenCode configuration for the directory it initializes. It selects the first
existing file in this order: `.opencode/opencode.jsonc`,
`.opencode/opencode.json`, `opencode.jsonc`, and `opencode.json`. When none
exists, it creates root `opencode.jsonc`.

The registration invokes the CLI over stdio, in the native shape of the
detected dialect (`mcp.servers.atlante` with `"disabled": false` for V2,
`mcp.atlante` with `"enabled": true` for V1 — see
[MCP registration](/reference/mcp#opencode-registration)):

```json
{
  "mcp": {
    "servers": {
      "atlante": {
        "type": "local",
        "command": ["npx", "--yes", "atlante@<version>", "mcp"],
        "disabled": false
      }
    }
  }
}
```

The server uses that directory as its active project. Its tools inspect and
validate the project, list resolved resources, search and read bundled
documentation, and return supported schemas. The server does not write files,
build native output, execute agents, install packages, or fetch remote content.

Registration follows the `init` target rather than the CLI installation mode.
Installing `atlante` globally does not create a separate user-level
registration. Use `--no-mcp` when you want initialization without changing
OpenCode configuration:

```sh
npx atlante init --no-mcp
```

The [MCP reference](/reference/mcp) lists the six tools and their inputs and
result boundaries.

## Add the reviewer

Open `atlante.jsonc`. If it still contains only the generated preset
selection, replace its contents with this configuration. If you have already
customized it, add the `values` entries and the `reviewer` binding to your
existing maps instead.

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "values": {
    "project": "billing-api",
    "language": "TypeScript"
  },
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews {{values.project}} for defects and breaking API changes.",
      "identity": "You are a senior {{values.language}} reviewer on {{values.project}}.",
      "mission": "Find defects before changes are merged.",
      "sections": [
        {
          "responsibilities": [
            "Read the relevant source and tests.",
            "Check behavior against the project requirements.",
            "Report actionable findings with file and line references."
          ]
        },
        {
          "invariants": [
            "Do not change implementation files while reviewing."
          ]
        }
      ]
    }
  }
}
```

The `reviewer` key names the agent in OpenCode. Its `description` tells the
host when the agent is useful, while `identity`, `mission`, and `sections`
supply the prompt content accepted by the selected template.

The two values keep the project name and language in one place. Atlante
substitutes them into the description and identity before rendering the
prompt. See [Values](/concepts/values) for binding-local overrides and
[Templates](/concepts/templates) for other ways to select content.

## Add reusable review guidance

The reviewer defines the role, while a reusable skill gives that reviewer and
other agents a consistent procedure for checking API changes.

Add `api-review` to the top-level `skills` map in `atlante.jsonc`. Create the
map if it does not exist. This excerpt shows only the new binding; keep the
rest of your configuration.

```jsonc title="atlante.jsonc — add to skills"
{
  "skills": {
    "api-review": {
      "$template": "@atlante/pack/skill",
      "description": "Use when reviewing changes to API requests, responses, or error behavior.",
      "title": "API review",
      "overview": "Check whether an API change preserves the behavior existing clients depend on.",
      "sections": [
        {
          "instructions": [
            "Compare the changed request and response shapes with their previous definitions.",
            "Check status codes and error responses for compatibility changes.",
            "Look for tests covering existing clients and invalid requests.",
            "Record each breaking change with an affected endpoint and supporting evidence."
          ]
        }
      ]
    }
  }
}
```

Add the following instruction to the reviewer's `responsibilities` array so
its prompt tells it when to use the new skill:

```json title="Additional reviewer responsibility"
"Use the api-review skill when a change affects an API contract."
```

The agent's responsibilities describe what it is accountable for; the skill
provides the procedure for one kind of review. The skill's description also
helps other agents identify when that guidance is relevant.

## Validate and build

Check the edited configuration, then build the native files:

```sh
npx atlante validate
npx atlante build
```

Validation checks the configuration and selected template input without
writing native files. Build includes those checks, then renders and writes
the output. If either command reports a failure, use its code and location
to find the relevant [diagnostic](/reference/diagnostics).

On the first build of these additions, the output includes lines such as:

```text title="Build output — excerpt"
wrote opencode: .opencode/agents/reviewer.md
wrote opencode: .opencode/skills/api-review/SKILL.md
built /Users/example/billing-api
```

## Inspect the result

Open `.opencode/agents/reviewer.md`. Its prompt should contain the resolved
identity rather than the value references:

```md title=".opencode/agents/reviewer.md — prompt excerpt"
# Identity

You are a senior TypeScript reviewer on billing-api.

# Mission

Find defects before changes are merged.
```

The remaining sections contain your review criteria and the instruction to
use `api-review`. Open `.opencode/skills/api-review/SKILL.md` to inspect the
separate procedure.

Restart OpenCode from the project directory to discover the new agent and
skill. You can check that the agent is present with:

```sh
opencode agent list
```

Look for `reviewer`, then select it in OpenCode for a review task. Host setup
is covered in [Getting started](/getting-started#open-the-harness-in-opencode).

## Make another change

Update a review criterion in `atlante.jsonc`, rebuild, and inspect the
corresponding change in the generated prompt. For repeated edits, you can
leave a watcher running:

```sh
npx atlante build --watch
```

Watch mode rebuilds the output; restart OpenCode when you want a new session
to load it. See [Materialization](/reference/materialization) for the generated
file and ownership contract.

To check what the reviewer produces on a defined task, continue with
[Evaluate your harness](/guides/evaluating-a-harness). To reuse its configuration
in other projects, follow [Author a pack](/guides/authoring-packs).
