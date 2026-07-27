# `@atlante/templates`

Template loading, composition, value interpolation, and Markdown rendering for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

```bash
npm install @atlante/templates
```

The package exports registry loaders, composition validation, bundled Draft
2020-12 template schemas, system-value resolution, and rendering helpers.

Bundled templates use the `atlante/` namespace and include `atlante/agent` and
`atlante/workflow`. Each template directory pairs a direct `template.json` input
schema with its `template.md` renderer; IDs derive from namespace and directory.
