---
title: Resources
description: How packs organize reusable configuration, templates, and instances for a harness.
---

A pack collects reusable content for one or more projects. It can contain
presets and resources. A preset defines a reusable harness configuration,
including agents and skills. A resource contains a template, configured input
for a template, or both.

The relationship between a pack and its contents is:

```text
pack
├── presets: reusable configuration
└── resources
    ├── templates: input contracts and renderers
    └── instances: configured input
```

Selecting a resource does not include the rest of its pack. Atlante follows
that resource's references but leaves unrelated presets and resources
unselected.

A pack can live in your repository or be distributed through a package
manager. A local pack keeps project-specific presets and resources together.
A pack distributed as a package identifies its content through a readable
`package.json` declaring numeric `atlante.format: 1` and is available to
resolution through the authoring project's declared, installed dependencies.

The published CLI bundles the first-party `@atlante/pack`, so its default
harness needs no separate pack installation. That bundled content is a
starting point; a configuration can select other presets and resources.
[Author a pack](/guides/authoring-packs) describes local and package layouts,
including the files that define templates and instances.

## The first-party pack

`@atlante/pack` includes:

- An `atlante` agent that selects the phase skills relevant to a task while
  preserving their order.
- Four phase skills: `brainstorm`, `plan`, `build`, and `review`.
- A `harness` skill for initializing, configuring, validating, and improving
  the harness itself.
- Reusable agent, skill, workflow, and section templates for project-specific
  configurations.

These skills provide guidance to the host; they do not schedule or enforce a
workflow.
The [pack README](https://github.com/atlante/atlante/tree/main/packages/pack)
lists its public locators and describes the default workflow in detail.

## Locators connect configuration to content

A locator identifies the preset or resource a configuration selects, using
a relative path or a package name. Relative paths begin with `./` or `../`
and resolve from the file containing the locator, not necessarily the
project root.

For example, the following configuration gives two reviewer instances their
own agent IDs. `./resources/reviewer` resolves from the configuration file,
while `@acme/review-pack/reviewer` selects `reviewer` from an installed pack:

```jsonc
{
  "agents": {
    "localReviewer": "./resources/reviewer",
    "packReviewer": "@acme/review-pack/reviewer"
  }
}
```

A package locator can also name the package alone, such as
`@acme/review-pack`, to select its root.
Template and instance locators identify resource directories rather than
individual files such as `template.md` or `instance.jsonc`.
[Templates](/concepts/templates) explains how a binding selects
the content available at that location.

Each pack has a root containing its presets and resources. Referenced files,
including resolved symlink targets, must remain inside that root. Absolute
paths and URLs are not resource locators. The
[locator contract](https://github.com/atlante/atlante/blob/main/SPECIFICATION.md#5-packs-and-resolution)
defines the complete path grammar and containment rules.

:::caution
Atlante loads only the selected resource and its dependencies, including
nested templates. It does not validate unrelated resources in the same pack,
so a successful build does not establish that every resource in the pack is
valid.
:::
