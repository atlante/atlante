---
title: Author a pack
description: Create reusable static presets, templates, instances, and supporting content.
---

A pack distributes static Atlante content. Use a pack when several projects need
the same preset, template, or configured instance.

## Pack structure

A package pack has one trusted root and declares `atlante.format: 1` in its
`package.json`:

```text
review-pack/
├── package.json
├── atlante.jsonc
└── reviewer/
    ├── template.jsonc
    └── template.md
```

```json title="package.json"
{
  "name": "@acme/review-pack",
  "version": "1.0.0",
  "atlante": { "format": 1 }
}
```

The package can expose a preset root through `atlante.jsonc`:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "agents": {
    "reviewer": "./reviewer"
  }
}
```

## Define a template

`template.jsonc` contains a JSON Schema Draft 2020-12 input contract. The
paired `template.md` renders the validated input as Markdown. Keep input fields
specific to the resource and document their intended use in the template.

A resource may contain an instance as well:

```text
reviewer/
├── template.jsonc
├── template.md
└── instance.jsonc
```

An instance supplies input for exactly one effective template. It can be
selected from a project by its package locator.

## Keep packs static

Atlante reads selected metadata, resources, and transitive dependencies. It does
not load JavaScript from a pack, call registration hooks, install dependencies,
or enumerate unrelated package directories.

Version 0.1 has no plugin runtime or remote registry. A future extension may
introduce additional distribution behavior, but it must preserve the separation
between static prompt content and host execution.

## Test a pack locally

Declare and install the pack in a consuming project, then select it explicitly:

```sh
npm install --save-dev @acme/review-pack
npx @atlante/cli init --preset @acme/review-pack
npx @atlante/cli validate
npx @atlante/cli build
```

Use [resources and packs](/concepts/resources/) and [resolution and composition](/concepts/resolution/)
for locator and inheritance rules.
