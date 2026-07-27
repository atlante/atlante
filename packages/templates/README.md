# `@atlante/templates`

Template loading, composition, value interpolation, and Markdown rendering for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

```bash
npm install @atlante/templates
```

The package exports registry loaders, composition validation, bundled Draft
2020-12 template schemas, system-value resolution, and rendering helpers.

Bundled templates use the `atlante/` namespace and include `atlante/agent`,
`atlante/workflow`, and `atlante/skill`. Each template directory pairs a direct
`template.json` input schema with its `template.md` renderer; IDs derive from
namespace and directory.

`atlante/skill` requires a string `content` field and renders that field as
Markdown. It supplies skill content only: it does not execute a skill, manage
runtime state, or register a native OpenCode skill.
