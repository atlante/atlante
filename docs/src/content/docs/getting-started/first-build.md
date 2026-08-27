---
title: Your first build
description: Create, validate, and build a project-local Atlante configuration.
---

This walkthrough creates one agent from the first-party pack and produces its
host-neutral artifact. Work from the root of the project you want to configure.

## 1. Initialize the project

```sh
npx @atlante/cli init
```

The CLI writes an `atlante.jsonc` document and an OpenCode registration. It also
runs an initial build, so a valid project is ready for the host adapter.

## 2. Inspect the source

Open `atlante.jsonc`. A minimal document selects the first-party preset:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack"
}
```

The preset supplies the default `architect` agent and the `brainstorming` and
`workflow` skills. Add a local binding when the project needs a different role:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack",
  "values": {
    "project": "my-app"
  },
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Reviews changes for defects and design issues.",
      "identity": "You are a careful reviewer on {{values.project}}.",
      "mission": "Find defects and design risks before changes are merged.",
      "responsibilities": [
        "Review the implementation against repository conventions",
        "Check that project invariants remain satisfied"
      ]
    }
  }
}
```

The fields after `description` belong to the selected template. Read [templates
and instances](/concepts/templates) before adding template-owned fields.

## 3. Validate the document

```sh
npx @atlante/cli validate
```

A successful validation prints a line like:

```text
validated atlante.jsonc
```

Validation checks the document, selected resources, template schemas, values,
and template input. It does not render or publish artifacts.

## 4. Build the artifacts

```sh
npx @atlante/cli build
```

A successful build prints a line like:

```text
built .atlante/artifacts
```

The builder prepares the complete output privately, then publishes it as one
artifact tree. Run this command after changing source configuration or selected
resources when watch mode is not active.

## 5. Let OpenCode consume the result

The OpenCode adapter reads only the verified artifact tree. It materializes the
rendered prompts and exposes the resolved skills through `atlante_skill`.

See [Use OpenCode](/guides/opencode) for the adapter boundary and host-owned
settings.
