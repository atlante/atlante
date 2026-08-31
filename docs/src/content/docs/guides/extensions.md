---
title: Extension boundary
description: Understand the supported static-Pack extension path and the limits of v0.1.
---

In v0.1, the supported extension path is a static Pack. This gives projects
reusable Atlante content without adding executable code to the loader or host
boundary.

## Publish static content

Use a Pack when several projects need the same preset, template, instance, or
supporting Markdown. Declare its format in `package.json`:

```json
{
  "name": "@acme/review-pack",
  "version": "1.0.0",
  "atlante": { "format": 1 }
}
```

Expose a preset through `atlante.jsonc` and keep resources under the package
root:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "agents": {
    "reviewer": "./reviewer"
  }
}
```

The consuming project declares and installs a custom Pack, then selects it with
`--preset`. The published CLI resolves the first-party `@atlante/pack` from its
bundled content, so the default Pack does not need a separate installation.
Atlante reads only selected static resources and their transitive dependencies.

## Know what is public

The publishable packages are `@atlante/pack`, `@atlante/cli`, and
`@atlante/opencode`. The `@atlante/resources`, `@atlante/validator`,
`@atlante/schema`, and `@atlante/builder` workspaces are private implementation
packages, not public installation targets.

## Know the runtime boundary

Atlante does not load JavaScript from a Pack, call package registration hooks,
install dependencies, consult a registry, load URLs, or execute project code.
The [OpenCode](https://opencode.ai/) adapter reads verified artifacts instead of
source Packs.

There is no plugin runtime, registration hook, lifecycle API, or remote registry
in v0.1. Do not depend on internal loader, resolver, validator, builder, or
adapter modules as an extension surface. A future version must define and version
its extension contract while preserving the boundary between static content
selection, artifact publication, and host execution.

For the authoring workflow, read [Author a pack](/guides/authoring-packs) and
[Resources](/concepts/resources). For the host boundary, read
[Artifacts](/concepts/artifacts) and [Use OpenCode](/guides/opencode).
