# `@atlante/validator`

Document and template-input validation for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

```bash
npm install @atlante/validator
```

The validator discovers and parses `atlante.jsonc` or `atlante.json`, expands
presets, validates the document structure, and validates each agent against its
template input schema.

Primary exports include `loadDocument`, `validateDocumentText`,
`validateTemplates`, `expandDocument`, and diagnostic formatting helpers.
