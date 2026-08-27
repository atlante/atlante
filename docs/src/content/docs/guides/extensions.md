---
title: Extension boundary
description: Understand the supported static-pack extension path and the limits of v0.1.
---

Atlante v0.1 extends through static packs. It does not provide a plugin runtime,
registration hook, lifecycle API, or remote registry.

## Publish static content

Use a pack when several projects need the same preset, template, instance, or
supporting Markdown. A pack declares its format in `package.json`:

```json
{
  "name": "@acme/review-pack",
  "version": "1.0.0",
  "atlante": { "format": 1 }
}
```

Expose a preset through `atlante.jsonc` and keep resources under the package root:

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "agents": {
    "reviewer": "./reviewer"
  }
}
```

The consuming project declares and installs the pack, then selects it with
`--preset`. Atlante reads only the selected static resources and their
transitive dependencies.

## What v0.1 does not load

Atlante does not load JavaScript from a pack, call package registration hooks,
install dependencies, consult a registry, load URLs, or execute project code.
The OpenCode adapter also reads verified artifacts instead of source packs.

## Future extension work

There is no plugin API to implement against in v0.1. Do not depend on internal
loader, resolver, validator, builder, or adapter modules as an extension surface.
When a future version defines an extension contract, it must be versioned and
must preserve the boundary between static content selection, artifact
publication, and host execution.

For the supported authoring workflow, read [Author a pack](/guides/authoring-packs/)
and [Resources and packs](/concepts/resources/).
