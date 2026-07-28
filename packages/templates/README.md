# `@atlante/templates`

Template loading, composition, value interpolation, and Markdown rendering for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

```bash
npm install @atlante/templates
```

The package exports registry loaders, composition validation, bundled Draft
2020-12 template schemas, system-value resolution, and rendering helpers.

Bundled templates use the `atlante/` namespace and include `atlante/agent`,
`atlante/workflow`, `atlante/skill`, and the reusable skill section templates
`atlante/markdown`, `atlante/instructions`, and `atlante/gotchas`. Each template
directory pairs a direct `template.json` input schema with its `template.md`
renderer; IDs derive from namespace and directory.

`atlante/skill` accepts structured input and renders it as Markdown. It supplies
skill content only: it does not execute a skill, manage runtime state, or
register a native OpenCode skill.

Templates may declare nested slots with a `{ "template": "namespace/name" }`
marker inside an object property, array `items`, or `oneOf` branch. A slot's
schema path follows JSON Schema keywords such as `items` and `oneOf`; its data
path follows the input object and omits those schema-only keywords. Array-item
slots render each item in source order, and an active `oneOf` branch renders
only when its data is present. Child Markdown is inserted as opaque output, so
Handlebars syntax in child output is not evaluated by the parent. Referenced
schemas are expanded and validated before rendering; missing templates and
composition cycles are errors.
