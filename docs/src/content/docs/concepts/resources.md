---
title: Packs and resources
description: How packs organize reusable configuration, templates, and instances for a harness.
---

A resource supplies a template, configured input, or both for use in your
harness. A pack groups resources and reusable configuration so you can
maintain related content together or use it across projects.

The relationship between a pack and its contents is:

```text
pack
├── presets: reusable configuration
└── resources
    ├── templates: input contracts and renderers
    └── instances: configured input
```

A preset can select several agents and skills, while a resource supplies
content for an individual selection or a composed template. Selecting one
resource does not select every agent, skill, or preset in its pack.

## Packs and packages

A pack is the Atlante content; a package is one way to distribute that
content through a package manager. A local pack can instead live inside
your repository, keeping a project-specific preset and its resources together.

A package pack identifies its content through a readable `package.json`
declaring numeric `atlante.format: 1`. Custom package packs are available to
resolution through the authoring project's declared, installed dependencies.

The published CLI bundles the first-party `@atlante/pack`, so its default
harness needs no separate pack installation. That bundled content is a
starting point; a configuration can select other presets and resources.

[Author a pack](/guides/authoring-packs) describes local and package layouts,
including the files that make a resource a template or instance.

## Locators connect configuration to content

A locator identifies the preset or resource a configuration selects, using
a relative path or a package name. Relative paths begin with `./` or `../`
and resolve from the file containing the locator, not necessarily the
project root.

This configuration excerpt selects two reviewer instances from different
locations, giving each its own agent ID:

```jsonc
{
  "agents": {
    "localReviewer": "./resources/reviewer",
    "packReviewer": "@acme/review-pack/reviewer"
  }
}
```

The local locator selects a resource relative to this document; the package
locator selects `reviewer` inside an installed pack. A package locator can
also name the package alone, such as `@acme/review-pack`, to select its root.

Template and instance locators identify resource directories rather than
individual files such as `template.md` or `instance.jsonc`.
[Templates and instances](/concepts/templates) explains how a binding selects
the content available at that location.

## Selected content only

Atlante reads the content you select and the resources that content refers
to, including nested template dependencies. An unused sibling resource is
outside that selection, so a malformed unused resource does not invalidate
the reviewer you selected.

Each pack has a root that contains its presets, resources, and referenced
files, including the resolved targets of symlinks. Locators stay within that
root after path resolution; absolute paths and URLs are not resource locators.
The [locator contract](https://github.com/atlante/atlante/blob/main/SPECIFICATION.md#5-packs-and-resolution)
defines the complete path grammar and containment rules.
