# `@atlante/presets`

Bundled configuration presets for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

> Internal workspace package — not published to npm. This package exists only
> inside the Atlante repository, where the published `@atlante/cli` and
> `@atlante/opencode-plugin` packages consume its source at build time.

Use `listPresets` to inspect registry-derived preset IDs and `readPreset` to read
a preset document. The package includes the `atlante/starter` preset used by
`atlante init`; each preset is an ordinary `atlante.jsonc` or `atlante.json`.
Preset documents may contain a root `skills` map. Skill bindings inherit using
the normal object-merge rules: objects merge by key, scalars replace, arrays
replace, local values take precedence, and `null` is a tombstone that removes
an inherited skill or field.

This package only loads and exposes raw preset documents. It intentionally does
not validate or expand their Atlante documents. A consuming validator, such as
`@atlante/validator`, owns the uniform overlay-expansion path and validates the
expanded canonical document; presets are not validated standalone by this
package.
