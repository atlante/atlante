---
title: Author a pack
description: Move review guidance into a local pack, customize its template, and reuse it from another project.
---

This guide moves a reviewer's configuration out of project settings and into a
reusable local pack built on an existing template, then covers the optional
steps of adding a custom renderer and packaging it for other projects.

## Prerequisites

Run this guide from the root of an initialized project with a
[project-local CLI](/getting-started#use-a-project-local-cli); it uses the
`billing-api` reviewer from
[Customize your harness](/guides/building-a-harness), but includes every file
needed to follow it independently and notes when a command runs elsewhere.

## Import an existing Markdown file

Use `atlante import` when an agent or skill already exists as a Markdown file.
The command creates a source pack with a preset and one resource instance.

For an agent, add the required metadata to the file's YAML frontmatter:

```md
---
identity: You are a senior reviewer.
mission: Find defects before changes are merged.
description: Reviews the project for defects.
---

Read the relevant source and tests before reporting findings.
```

Import the file into `packs/review`:

```sh
npx atlante import review.md --kind agent --out packs/review
```

The required `--kind` option selects `agent` or `skill`. Skills require
`title`, `overview`, and `description`; agents require `identity`, `mission`,
and `description`. Atlante does not infer missing metadata.

Without `--name`, the command uses the sanitized Markdown filename stem as the
pack, resource, and binding ID. The final filename extension is removed before
sanitization. Use `--name <id>` to choose a different ID; resulting IDs use
lowercase kebab-case and contain at most 64 characters.

The generated pack has this structure:

```text
packs/review/
├── atlante.jsonc
├── package.json
└── review/
    └── instance.jsonc
```

Add the generated preset to the project's source configuration:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": ["@atlante/pack", "./packs/review"]
}
```

Validate and build the consuming project:

```sh
npx atlante validate
npx atlante build
```

The importer supports the CommonMark and GFM nodes listed in the
[template reference](/concepts/templates#canonical-markdown-input). Unsupported
syntax, unresolved references, invalid metadata, and failed validation stop the
operation before the output directory is created.

The manual workflow below is a separate alternative to importing an existing
file. If you used `atlante import`, stop after the commands above and inspect
the generated ID instead of the `reviewer` example when checking native output.

## Create a reusable reviewer instance

Create the resource directory and instance file:

```sh
mkdir -p packs/review/reviewer
touch packs/review/reviewer/instance.jsonc
```

Open `packs/review/reviewer/instance.jsonc` and add the reviewer's template
selection and input:

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

The instance reuses the first-party agent renderer, so the pack only needs to
store the reviewer's input. The preset in the next step supplies default
values for `project` and `language`, which a consuming project can override.

When moving an existing reviewer into the pack, replace the sample fields with
the input from its current binding. Add every skill referenced by those
instructions to the pack's preset so consuming projects receive all required
guidance.

## Add a preset

Create the preset file:

```sh
touch packs/review/atlante.jsonc
```

Open `packs/review/atlante.jsonc` and add a preset that selects the reviewer
instance:

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
file, which also supplies default values that a consuming project can override.

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
of `checks`. Create the two template files beside `instance.jsonc`:

```sh
touch packs/review/reviewer/template.jsonc
touch packs/review/reviewer/template.md
```

Open `packs/review/reviewer/template.jsonc` and define the accepted input:

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

Open `packs/review/reviewer/template.md` and define how that input becomes
Markdown:

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
changes. From the project root, validate the updated pack and rebuild the
native files:

```sh
npx atlante validate
npx atlante build
```

The generated reviewer prompt should now contain:

```md title="Generated reviewer — prompt excerpt"
# Review focus

Review API compatibility in billing-api.

## Checks

- Compare request and response shapes with the previous version.
- Check status codes and error responses.
- Report findings without changing implementation files.
```

The instance's `description` remains host metadata rather than renderer input.
[Template syntax](/reference/template-syntax) documents the available helpers
and composition slots.

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
npm install --save-dev atlante ../packs/review
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

Before sharing a pack, validate and build a representative consumer for each
preset or resource you expect others to select, then inspect both the command
output and generated prompts. A build covers only its selected content and
dependencies, so exercise other supported selections separately. If you have
not evaluated the generated harness yet, run [Evaluate your harness](/guides/evaluating-a-harness)
before sharing the pack.

## List the pack in the explorer

The [pack explorer](https://packs.atlante.sh/) is a curated directory of
Atlante packs published on npm, synchronized at build time from npm and public
GitHub data. To list your pack, open an issue or pull request in the
[Atlante repository](https://github.com/atlante/atlante) that adds its package
name to the explorer's manifest.
