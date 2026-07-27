# `@atlante/presets`

Bundled configuration presets for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

```bash
npm install @atlante/presets
```

Use `listPresets` to inspect registry-derived preset IDs and `readPreset` to read
a preset document. The package includes the `atlante/starter` preset used by
`atlante init`; each preset is an ordinary `atlante.jsonc` or `atlante.json`.

This package loads presets but intentionally does not validate their Atlante
documents; validation belongs to `@atlante/validator`.
