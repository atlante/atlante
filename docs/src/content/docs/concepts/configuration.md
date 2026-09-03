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

These are the exact supported top-level fields:

- `$schema` identifies the document contract.
- `extends` selects one preset or an ordered, non-empty list of presets.
- `values` defines global named string values.
- `agents` maps agent IDs to resource bindings.
- `skills` maps skill IDs to resource bindings.
- `hosts` optionally selects the host materialization targets; v0.1 admits
  only `"opencode"`, which is also the default.

Unknown top-level fields are rejected. `extends` cannot be empty, `hosts`
cannot be empty or contain duplicates, and missing `agents` or `skills` maps
become empty collections in the canonical document. An absent `hosts` field
defaults to `["opencode"]` in the canonical document.
In a source overlay, `null` can remove an inherited field; it is resolved away
before the canonical document is used.

Within an agent or skill binding, `description`, `$template`, `$instance`, and
`values` are document metadata. The selected template owns every other field
and validates it as its input. A binding must have a non-empty description after
interpolation. See [Templates](/concepts/templates) for selector behavior and
[Resources](/concepts/resources) for locator behavior.

The hosted [Schema](https://atlante.sh/schema/v0.1/schema.json) and the
[generated schema file](https://github.com/atlante/atlante/blob/main/packages/schema/schema/v0.1/schema.json)
define the machine-readable contract. Use the [Schema](/reference/schema)
reference for the complete field and type contract, including binding details.

## Configuration versus a guide

This page explains what the source document means. For the practical sequence of
adding bindings, values, and selected content, use
[Build a harness](/guides/building-a-harness). For the shortest executable path,
start with [Getting started](/getting-started).
