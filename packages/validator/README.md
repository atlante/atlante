# `@atlante/validator`

Document, resource-resolution, and template-input validation for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

The validator discovers and parses `atlante.jsonc` or `atlante.json`, validates
the raw overlay, resolves local or installed static-package preset and facet
references through `@atlante/resources`, validates the resulting canonical
document, and validates each agent and skill against its effective template
facet. Agent and skill paths use `/agents/<agentId>` and `/skills/<skillId>`;
`description` is required for both, interpolated with the shared values
pipeline, and must remain non-empty. `description`, `$template`, `$instance`,
and `values` are stripped as reserved binding metadata before template input
validation. Agent and skill diagnostics retain their respective subjects and
paths.

Unknown resources, missing values, invalid interpolated descriptions, invalid
template inputs, missing composition references, composition cycles, malformed
template schemas, and unsafe paths are errors. Resolution and validation fail
closed with JSON Pointer diagnostics, including agent and skill paths. Resource
loading is lazy and does not parse unrelated siblings.

Primary exports include `loadDocument`, `parseDocumentOverlay`,
`validateDocumentText`, `validateResolvedDocument`, and diagnostic formatting
helpers.
