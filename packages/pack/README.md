# `@atlante/pack`

The first-party Atlante resource pack is a versioned static npm package. Its
`package.json` contains `"atlante": { "format": 1 }`; the package directory is
the immutable content root.

It contains the default preset, named presets, template facets, and instance
facets. Reference them with package locators:

```jsonc
{
  "extends": "@atlante/pack",
  "agents": {
    "reviewer": {
      "$template": "@atlante/pack/agent",
      "description": "Review this repository.",
      "identity": "You review code.",
      "mission": "Find defects."
    }
  }
}
```

Package locators may use a scoped or unscoped package name and an optional
contained POSIX subpath. `extends` selects a preset, `$template` selects a
template facet, and `$instance` or a bare locator selects an instance facet.
Only selected files and their transitive dependencies are loaded. There is no
node-module scan, registry lookup, install step, configurable sub-root, or
executable registration API. The package has no runtime code entry point.

Third-party packs follow the same contract and may compose other packs through
declared `dependencies` or `optionalDependencies`. Project references must be
declared by the project's package manager; Atlante never mutates `package.json`.
