---
title: Resolution and composition
description: How Atlante loads, merges, validates, and renders a configuration.
---

Atlante treats configuration loading as a deterministic pipeline. Each stage
must succeed before the next stage can publish output.

## The pipeline

1. **Raw structural validation** parses JSON or JSONC and checks document shape,
   the schema URI, container types, `extends`, and selector shape.
2. **Resource resolution** loads selected presets, resources, instances, templates,
   package metadata, and transitive references.
3. **Resolved validation** checks the canonical document, values, selectors,
   composition, effective-template compatibility, and template-owned input.
4. **Build** renders validated input and atomically publishes the complete artifact tree.

`atlante validate` runs the first three stages without rendering. `atlante build`
runs all four stages.

## Preset inheritance

`extends` accepts one locator or an ordered list. Each layer resolves its own
inheritance first. Atlante then merges layers from left to right and applies the
local document last.

Merge behavior is deterministic:

- Objects merge recursively.
- Arrays replace the inherited array.
- Scalars replace the inherited scalar.
- `null` removes an inherited field.
- Local values always win over inherited values.

```jsonc
{
  "extends": [
    "@acme/base-pack",
    "@acme/review-pack/strict"
  ],
  "agents": {
    "reviewer": "./resources/reviewer"
  }
}
```

The second preset sees the resolved first preset. The local `reviewer` binding
wins over both inherited layers.

## Failure behavior

Missing targets, invalid locators, malformed schemas, missing value references,
unsupported fields, incompatible templates, and composition cycles fail before
rendering. The builder prepares a complete private tree and publishes nothing
partial when a required step fails.

Atlante loads only selected content and does not execute JavaScript, install
packages, consult a registry, load URLs, or execute arbitrary project code.
