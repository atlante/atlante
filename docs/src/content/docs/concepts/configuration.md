---
title: Configuration
description: The authored document that defines an Atlante harness.
---

What should your project keep under version control, and what should Atlante
generate? Keep the configuration document: it is the authored, versioned source
for the harness. It selects presets, defines values, and binds agents and skills
to static resources. The build turns that source into host-native output;
generated files do not replace it.

The source-to-output flow is:

```text
atlante.jsonc or atlante.json
        -> validate and resolve
        -> build
        -> .opencode/ + .atlante/opencode-native.json
```

## Supported source files

The project root may contain exactly one of these source files:

- `atlante.jsonc`, which permits JSONC comments and trailing commas.
- `atlante.json`, which uses strict JSON.

If both files exist, Atlante reports an ambiguity and requires an explicit
choice. The same document contract applies to either filename.

## Document contract

The document must declare the exact v0.1 schema URI:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack"
}
```

At a high level, a document selects presets, defines values, binds agents and
skills to resources, optionally configures `atlante eval`, and selects a host.
The [Schema](/reference/schema) reference defines the exact fields, types, and
constraints. [Templates](/concepts/templates) explains selector behavior,
[Resources](/concepts/resources) explains locators, and the [CLI
reference](/reference/cli#atlante-eval) explains eval configuration and scenario
documents.

The hosted [Schema](https://atlante.sh/schema/v0.1/schema.json) and the
[generated schema file](https://github.com/atlante/atlante/blob/main/packages/schema/schema/v0.1/schema.json)
define the machine-readable contract. Use the [Schema](/reference/schema)
reference for the complete field and type contract, including binding details.

## Configuration versus a guide

This page explains what the source document means. For the practical sequence of
adding bindings, values, and selected content, use
[Build a harness](/guides/building-a-harness). For the shortest executable path,
start with [Getting started](/getting-started).
