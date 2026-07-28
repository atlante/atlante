# `@atlante/schema`

Document contract for [Atlante](https://github.com/atlante/atlante), including
TypeScript types, Zod schemas, and the versioned JSON Schema. Requires Node.js
22 or later.

```bash
npm install @atlante/schema
```

The package exports `atlanteDocumentSchema`, `agentBindingSchema`,
`skillBindingSchema`, value schemas, their TypeScript types, `SCHEMA_URI`, and
`documentJsonSchema`. The root document's optional `skills` map is keyed by
`skillId`; each skill reserves `description`, `template`, and `values` while
leaving its content fields to the selected template.

The generated JSON Schema is also available at
`@atlante/schema/schema.json` (the source generated path is
`packages/schema/schema/v0.1/schema.json`).
