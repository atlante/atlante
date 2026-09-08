---
title: Author a pack
description: Organize or share reusable static presets, templates, instances, and supporting content.
---

Create a Pack when content deserves its own boundary. Several projects may need
the same preset, template, instance, or supporting Markdown. A single project
may also use a local Pack to keep a growing `atlante.jsonc` readable. A Pack is
Atlante static content, not a JavaScript plugin.

Choose the form that fits the boundary:
**By the end:** you will have a trusted static Pack layout, a template and
instance contract, and a local validate-and-build path.

| Form | Use it when | Source |
| --- | --- | --- |
| Local Pack | You are organizing one repository's configuration | A relative locator such as `./packs/review` |
| Package Pack | You are sharing content across projects or publishing it | A package locator such as `@acme/review-pack` |

## Split a growing configuration

A local Pack keeps a project-specific preset and its resources together without
requiring a package or a registry:

```text
my-project/
├── atlante.jsonc
└── packs/
    └── review/
        ├── atlante.jsonc
        └── reviewer/
            ├── template.jsonc
            └── template.md
```

Point the project configuration at the local preset:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "./packs/review"
}
```

The local preset can define values, agents, skills, and resource bindings just
like the project document. The locator resolves relative to the file that
contains it. Keep the local preset focused on one coherent part of the
harness, then add another layer only when it has a useful boundary of its own.

Local Packs do not need a package manifest for this use case. If the content
will be installed by other projects, turn it into a package Pack instead.

## Create a package Pack

Give a package Pack one trusted root and declare `atlante.format: 1` in its
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

## Test a Pack locally

The published CLI bundles the default first-party `@atlante/pack`, so it needs no
separate installation. For a custom Pack, select it with `--pack`: the CLI
installs it with the project's package manager, declares it in
`devDependencies`, and discovers the presets it provides:

```sh
npx @atlante/cli@latest init --pack @acme/review-pack
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

`--pack @acme/review-pack/<preset>` selects a named preset explicitly without
prompting, which suits CI and scripts. See the [CLI](/reference/cli) reference
for package installation and preset-selection behavior. Use
[Resources](/concepts/resources) for locator and Pack-loading rules.
