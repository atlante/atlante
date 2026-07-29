# `@atlante/resolver`

Deterministic value merging and prompt resolution for
[Atlante](https://github.com/atlante/atlante). Requires Node.js 22 or later.

```bash
npm install @atlante/resolver
```

Use `resolve` to validate and render an Atlante document into host-neutral agent
and skill artifact descriptors. An `AgentArtifact` contains `hostAgentId`,
`templateId`, `description`, and `prompt`. A `SkillArtifact` contains
`skillId`, `templateId`, `description`, and rendered `content`;
`ResolvedHarness.skills` contains the
skill artifacts in root-map order alongside `ResolvedHarness.agents`.

Descriptions and skill content use the same global-plus-local value merge and
interpolation pipeline as agents. Resolution is deterministic and fails closed:
if validation, interpolation, composition, or rendering fails, no partial
artifact set is returned: `ResolvedHarness.agents` and
`ResolvedHarness.skills` are both empty on failure. An empty skill artifact
array is valid when the document has no skills; a missing or invalid skill is an
error, not an empty success.

The package also exports `mergeValues`, `DEFAULT_TEMPLATE_ID`, and the related
TypeScript types.
