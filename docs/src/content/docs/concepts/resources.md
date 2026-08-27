---
title: Resources and packs
description: How Atlante selects static presets, templates, instances, and local resources.
---

A pack is a static distribution of Atlante content. It can contain presets,
templates, instances, and supporting files. A pack has no JavaScript entry point,
registration hook, or executable API.

`@atlante/pack` is Atlante's first-party pack and the default preset selected by
`atlante init`. First-party ownership and default selection are separate ideas:
a different pack can provide a project's default through an explicit `--preset`.

## Pack layout

A package pack must expose `package.json` with `atlante.format: 1`. Resource
directories contain one or both typed facets:

```text
pack/
├── package.json
├── atlante.jsonc          # optional preset root
└── reviewer/
    ├── template.jsonc     # template facet, paired with template.md
    ├── template.md
    └── instance.jsonc     # optional instance facet
```

A template facet is valid only when both `template.jsonc` and `template.md` are
present. An instance facet contains configured input and resolves to exactly one
effective template.

## Resource locators

Locators are either containing-file-relative paths or package locators:

```jsonc
{
  "agents": {
    "localReviewer": "./resources/reviewer",
    "packReviewer": "@acme/review-pack/reviewer"
  }
}
```

Relative locators begin with `./` or `../`. Package locators use a package name
with an optional POSIX subpath. Absolute paths, URLs, backslash-separated paths,
direct facet filenames, and paths escaping the trusted pack root are invalid.

The selected package must already be declared and installed. Atlante does not
install dependencies, enumerate unrelated package directories, consult a
registry, or load remote content.

## Lazy selection

Resolution reads selected metadata, selected resources, and their transitive
dependencies. An unrelated malformed resource sibling does not invalidate a
valid selected resource. This keeps pack loading bounded and makes watch mode
follow the actual dependency graph.
