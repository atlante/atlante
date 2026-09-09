---
title: Author a pack
description: Move review guidance into a local pack, customize its template, and reuse it from another project.
---

Move a reviewer's configuration into a pack so you can maintain it separately
from project settings and reuse it in other projects.

You will first build a local pack using an existing template. You can then
give it a custom renderer or package it for another project. Neither step
is required to use the local pack.

## Before you begin

Start with an initialized project and a
[project-local CLI](/getting-started#use-a-project-local-cli). The example
uses the same `billing-api` reviewer as
[Customize your harness](/guides/building-a-harness), but includes the files
needed to follow this guide independently.

Run commands from your project root unless a step names a different directory.

## Create a reusable reviewer instance

Create `packs/review/reviewer/instance.jsonc`. This file keeps the reviewer's
template selection and input together:

```jsonc title="packs/review/reviewer/instance.jsonc"
{
  "$template": "@atlante/pack/agent",
  "description": "Reviews {{values.project}} for defects.",
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
```

The instance uses the first-party agent template. You do not need to author
a renderer to share these instructions. Project-specific values will come
from the configuration that selects the pack.

If you are extracting an existing reviewer, move its input into this file
instead of using the sample wording. Include any skills that its instructions
refer to in the pack's preset as well.

## Add a preset

Create `packs/review/atlante.jsonc` to give the pack a preset that selects
the instance:

```jsonc title="packs/review/atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "values": {
    "project": "example-project",
    "language": "TypeScript"
  },
  "agents": {
    "reviewer": "./reviewer"
  }
}
```

The `./reviewer` locator selects `reviewer/instance.jsonc` relative to this
preset. The preset also supplies default values, which a consuming project
can override.

Your local pack now has three levels:

```text
my-project/
├── atlante.jsonc
└── packs/
    └── review/
        ├── atlante.jsonc
        └── reviewer/
            └── instance.jsonc
```

## Use the local pack

In the project's root `atlante.jsonc`, add the local preset after
`@atlante/pack` in `extends` and set the project values:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": ["@atlante/pack", "./packs/review"],
  "values": {
    "project": "billing-api",
    "language": "TypeScript"
  }
}
```

Keep any other project settings you already have. If you moved an inline
`agents.reviewer` binding into the pack, remove that binding from the root
configuration so it no longer overrides the extracted instance.

Build from the project root, not from the resource directory:

```sh
npx atlante validate
npx atlante build
```

Open `.opencode/agents/reviewer.md`. Its identity should name `billing-api`,
rather than the preset's default `example-project`:

```md title="Generated reviewer — excerpt"
# Identity

You are a senior TypeScript reviewer on billing-api.
```

You now have a local pack consumed through a preset. Changes to shared review
instructions belong in the instance; project-specific values remain in the
root configuration. [Resolution](/concepts/resolution) explains
how those layers combine.

## Define a custom template

Keep the existing template when its structure fits your guidance. Define
your own when consumers need a different input shape or Markdown layout.

For example, a review-specific template can accept a `focus` field and a list
of `checks`. Create the following two files beside `instance.jsonc`:

```jsonc title="packs/review/reviewer/template.jsonc"
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "focus": { "type": "string", "minLength": 1 },
    "checks": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "minItems": 1
    }
  },
  "required": ["focus", "checks"],
  "additionalProperties": false
}
```

```hbs title="packs/review/reviewer/template.md"
# Review focus

{{focus}}

## Checks

{{#each checks}}
- {{this}}
{{/each}}
```

Replace the instance with input for this template. The `./` selector points
to the template in the same resource directory:

```jsonc title="packs/review/reviewer/instance.jsonc"
{
  "$template": "./",
  "description": "Reviews {{values.project}} for breaking API changes.",
  "focus": "Review API compatibility in {{values.project}}.",
  "checks": [
    "Compare request and response shapes with the previous version.",
    "Check status codes and error responses.",
    "Report findings without changing implementation files."
  ]
}
```

The preset still selects `./reviewer`, so the consuming project needs no
changes. Run `npx atlante validate` and `npx atlante build` again from the
project root. The prompt should now contain:

```md title="Generated reviewer — prompt excerpt"
# Review focus

Review API compatibility in billing-api.

## Checks

- Compare request and response shapes with the previous version.
- Check status codes and error responses.
- Report findings without changing implementation files.
```

The schema checks the template's input; the renderer determines how that
input appears in the prompt. The instance's `description` remains host
metadata, separate from the renderer input. See
[Template syntax](/reference/template-syntax) for helpers and composition slots.

## Reuse the pack from another project

To install the pack as a package, add a manifest at its root. A local pack
does not need this file until you choose package-based distribution.

```json title="packs/review/package.json"
{
  "name": "@acme/review-pack",
  "version": "1.0.0",
  "files": ["atlante.jsonc", "reviewer/"],
  "atlante": { "format": 1 }
}
```

`@acme/review-pack` is an example package name. Use a name and scope your team
owns when preparing a package for publication. Keep every resource selected
by the pack inside the packaged files, including any additional skills.

To try this package before publishing it, create a separate consumer directory
inside your project. Run these commands from that new `pack-consumer` directory:

```sh
npm init -y
npm install --save-dev @atlante/cli ../packs/review
npx atlante init --pack @acme/review-pack
npx atlante validate
npx atlante build
```

The relative installation path assumes this layout:

```text
my-project/
├── packs/review/
└── pack-consumer/
    └── package.json
```

The package manager installs your local pack as a declared dependency. `init`
then selects its preset and builds it in the fresh consumer project. Inspect
`pack-consumer/.opencode/agents/reviewer.md` to confirm that the package supplies
the reviewer, using `example-project` until the consumer overrides that value.

For an already initialized consumer, install the pack and add its package name
to `extends` instead of running `init` again. This excerpt keeps the default
harness and applies the review preset after it:

```jsonc title="Existing consumer atlante.jsonc — extends excerpt"
{
  "extends": ["@atlante/pack", "@acme/review-pack"]
}
```

Rebuild that consumer after changing its preset selection. The
[CLI reference](/reference/cli) covers named preset selection and installation
behavior; [Resources](/concepts/resources) explains locator resolution.

## Check the content you share

Validate and build a representative consumer for each preset or resource you
intend others to use. A build checks selected content and its dependencies,
not every unused resource in the pack.

Inspect the generated prompts as well as the command results. To test what
an agent does with those instructions, follow
[Evaluate your harness](/guides/evaluating-a-harness).
