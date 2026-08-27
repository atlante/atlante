---
title: Schema
description: Use the immutable JSON Schema URI and inspect the generated v0.1 document contract.
---

Atlante v0.1 documents use this exact schema URI:

```text
https://atlante.sh/schema/v0.1/schema.json
```

Add it to `atlante.jsonc` or `atlante.json`:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json"
}
```

The schema is JSON Schema Draft 2020-12. Strict JSON is a compatible subset of
JSONC, so the same document contract applies to both supported filenames.

## What the schema covers

The document schema defines:

- The required `$schema` URI.
- Preset inheritance through `extends`.
- Global string values.
- Agent and skill maps.
- Binding selectors and metadata.
- Resource locator shape.

The selected template owns the remaining fields for an agent or skill. Its input
schema is resolved and validated separately from the document schema.

## Source and generated file

The authoritative generated schema is versioned at
[`packages/schema/schema/v0.1/schema.json`](https://github.com/atlante/atlante/blob/main/packages/schema/schema/v0.1/schema.json).
The TypeScript package also exposes it as `@atlante/schema/schema.json`.

The repository generates this file from the schema package source. Do not edit
the generated JSON directly; update its source and run the repository build and
validation checks.

## Version boundaries

The document schema version, artifact format version, template input schema, and
package version evolve independently. An adapter rejects an unsupported document
schema URI or artifact format instead of inferring a compatible version.
