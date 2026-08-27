---
title: Give form to your harness
description: The configuration and build layer for a coding-agent harness.
---

Atlante is the configuration and build layer for your coding-agent harness. It
turns agents, skills, and workflows into one versioned system in your repository,
then materializes that system through a host adapter.

The authored source is a JSONC configuration document. Atlante validates the
document and its selected content, renders deterministic Markdown, and publishes
verified artifacts under `.atlante/artifacts/`.

:::note
Atlante v0.1 supports OpenCode as its host adapter. Atlante does not execute
agents, skills, project code, or LLM inference.
:::

## Start with the source

A project normally contains one `atlante.jsonc` file. It selects a preset, binds
agents and skills to templates or instances, and provides the values those
bindings need.

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack",
  "values": {
    "project": "my-app"
  }
}
```

Run `npx @atlante/cli init` to scaffold this starting point. Continue with the
[installation guide](/getting-started), or read [your first build](/getting-started/first-build)
for the complete source-to-artifact path.

## The system boundary

Atlante owns configuration, static content selection, validation, composition,
interpolation, rendering, and artifact publication. The host adapter owns
materialization into a host configuration, while the host and prompted model own
execution.

This separation keeps the authored system reviewable in Git and keeps generated
output independent from host settings.

## Documentation map

- **Start here** explains installation and the first build.
- **Concepts** explains documents, packs, templates, values, resolution, and artifacts.
- **Guides** shows how to build a harness, author a pack, use OpenCode, and watch for changes.
- **Reference** records the CLI, configuration fields, artifact format, diagnostics, and schema.

If a page and the implementation differ, the shipped implementation, tests, and
`SPECIFICATION.md` are the authoritative sources for v0.1 behavior.
