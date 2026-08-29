---
title: Resources
description: Static packs, presets, and locators in the Atlante resource model.
---

Where does a referenced preset, template, or instance come from? A Pack is a
static content distribution with one trusted root. It can contain preset
documents, resources, and the supporting files those resources reference. A
Pack is Atlante content, not a runtime API: it has no JavaScript entry point,
registration hook, or executable API.

Do not confuse a Pack with a package. A package is the installation and
distribution container that may carry a Pack. Atlante recognizes a package Pack
only when its readable `package.json` declares numeric `atlante.format: 1`.
The Pack itself is still the static content inside that package.

## First-party and custom Packs

The published CLI bundles and resolves Atlante's first-party Pack for the
default setup. Running `npx @atlante/cli init` therefore does not require a
separate `@atlante/pack` installation. The default preset selection and
first-party ownership are separate ideas: `init` can select another preset
explicitly. The generated source can extend the default preset with:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack"
}
```

Custom Pack packages must already be declared and installed by the authoring
project's package manager before a document references them. Atlante does not
install packages, consult a registry, load URLs, or load remote Pack content.

An ordinary Pack may look like this:

```text
review-pack/
├── package.json          # atlante.format: 1 for a package Pack
├── atlante.jsonc         # optional preset root
└── reviewer/
    ├── template.jsonc
    ├── template.md
    └── instance.jsonc     # optional
```

A resource may contain either facet or both. A template facet is valid only when
`template.jsonc` and `template.md` appear together; an instance facet supplies
configured input for one effective template.

## Resource locators

A resource locator identifies a preset, template, or instance by either:

- A path relative to the file containing the locator, beginning with `./` or
  `../`.
- A package name, or a package name with an optional POSIX subpath, such as
  `@acme/review-pack` or `@acme/review-pack/reviewer`.

```jsonc
{
  "agents": {
    "localReviewer": "./resources/reviewer",
    "packReviewer": "@acme/review-pack/reviewer"
  }
}
```

Absolute paths, URLs, NUL-containing strings, backslash-separated paths, direct
facet filenames such as `template.md`, and paths that escape the selected Pack
root after normalization and realpath checks are not valid locators. Relative
paths must begin with `./` or `../`; package locators must use the package form
above. See [Configuration](/concepts/configuration) for where locators occur in
the document.

## Selected content only

Atlante reads selected metadata, the selected resource and its facet files, and
their transitive dependencies. Unselected sibling resources and unrelated
package directories are outside the resolution graph. A malformed unselected
sibling therefore does not invalidate a valid selected resource. This boundary
keeps a Pack reusable without scanning or executing an installed package.

The selected resource becomes a template or instance through the rules in
[Templates](/concepts/templates), then enters [Resolution](/concepts/resolution).
