# `@atlante/schema`

Document contract for [Atlante](https://github.com/atlante/atlante), including
TypeScript types, Zod schemas, and the versioned JSON Schema. Requires Node.js
22 or later.

The package exports `atlanteDocumentSchema`, `agentBindingSchema`,
`skillBindingSchema`, the shared `bindingDescriptionSchema`, value schemas, their
TypeScript types, `SCHEMA_URI`, and `documentJsonSchema`. Every agent and skill
binding requires a non-empty `description`; each binding reserves
`description`, `$template`, `$instance`, and `values` while leaving its content
fields to the selected template. A bare resource locator is `$instance`
shorthand, and `$template`/`$instance` are mutually exclusive.

The generated JSON Schema is also available at
`@atlante/schema/schema.json` (the source generated path is
`packages/schema/schema/v0.1/schema.json`).
