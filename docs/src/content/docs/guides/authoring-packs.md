---
title: Author a pack
description: Create reusable static presets, templates, instances, and supporting content.
---

Create a Pack when several projects need the same preset, template, instance, or
supporting Markdown. A Pack is Atlante static content, not a JavaScript plugin.

## Create the package root

Give the Pack one trusted root and declare `atlante.format: 1` in its
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

Expose a preset root through `atlante.jsonc`:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "agents": {
    "reviewer": "./reviewer"
  }
}
```

Keep resources under the Pack root. The [Resources](/concepts/resources) page
explains how Pack roots and resource locators constrain what Atlante can load.

## Define a template

`template.jsonc` contains a JSON Schema Draft 2020-12 input contract. The paired
`template.md` renders validated input as Markdown. Keep fields specific to the
resource and explain their intended use in the template.

A resource can contain an instance as well:

```text
reviewer/
├── template.jsonc
├── template.md
└── instance.jsonc
```

An instance supplies input for exactly one effective template. A project can
select it with a package locator. A binding can also select a template directly,
or a top-level agent or skill collection can use the first-party default template
by omitting a selector. See [Templates](/concepts/templates) for the binding
choices.

## Keep the Pack static

Atlante reads selected metadata, resources, and transitive dependencies. It does
not load JavaScript from a Pack, call registration hooks, install dependencies,
or enumerate unrelated package directories. Version 0.1 has no plugin runtime or
remote registry.

## Test a Pack locally

The published CLI bundles the default first-party `@atlante/pack`, so it needs no
separate installation. For a custom Pack, declare and install it in the consuming
project, then select it explicitly:

```sh
npm install --save-dev @acme/review-pack
npx @atlante/cli@latest init --preset @acme/review-pack
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

The selected package must already be declared and installed. Atlante does not
install packages or load remote content. Use [Configuration](/concepts/configuration)
for source-document rules and [Resolution](/concepts/resolution) for inheritance
and composition behavior.
