# `@atlante/validator`

Document and template-input validation for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

```bash
npm install @atlante/validator
```

The validator discovers and parses `atlante.jsonc` or `atlante.json`, expands
raw overlays through the uniform preset path, validates the resulting canonical
document structure, and validates each agent and skill through the shared
template/input validation path. Skill paths use
`/skills/<skillId>`; `description` is required, interpolated with the shared
values pipeline, and must remain non-empty. `description`, `template`, and
`values` are stripped as reserved binding metadata before skill template input
validation.

Unknown skill templates, missing values, invalid interpolated descriptions,
invalid template inputs, missing composition references, composition cycles,
and malformed template schemas are errors. Preset overlays are expanded before
the same checks and fail closed with JSON Pointer diagnostics, including skill
paths. Preset validation is performed by this consuming validator, not by the
raw-document loader.

Primary exports include `loadDocument`, `validateDocumentText`,
`validateTemplates`, `expandDocument`, and diagnostic formatting helpers.
