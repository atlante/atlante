# `@atlante/pack`

The first-party Atlante resource pack is a versioned, static package containing
presets, template facets, and instance facets. Reference its default preset with
`@atlante/pack` or a contained resource with `@atlante/pack/<resource>`.

This package contains content only. It has no executable registration API,
runtime hooks, or source entry point. Atlante loads only the selected files and
their referenced facets through its generic package resolver.
