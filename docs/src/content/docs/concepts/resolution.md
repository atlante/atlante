---
title: Resolution
description: The deterministic pipeline from authored source to validated input.
---

Resolution combines authored configuration with selected Pack content, validates
the result, and produces a canonical document plus resolved template inputs.
The same source and selected content produce the same result, apart from the
supported system value described in [Values](/concepts/values).

## Precedence and inheritance

`extends` accepts one locator or an ordered, non-empty list. Each preset resolves
its own inheritance first. Atlante merges preset layers from left to right, then
applies the local document last, so local configuration takes precedence.

The merge rules are:

- Objects merge recursively.
- Arrays replace inherited arrays.
- Scalars replace inherited scalars.
- `null` removes an inherited field as a source overlay.
- Binding-local values override global values for that binding.

The result is a canonical document without `extends`, source selectors, or
unresolved removals. It contains the resolved values, agent bindings, and skill
bindings that the build will render. [Configuration](/concepts/configuration)
describes the authored shape; [Resources](/concepts/resources) describes what
can be loaded.

## Interpolation and composition

Atlante resolves supported system values and substitutes explicit value
references before selected templates render. A template's JSON Schema can also
declare a composition slot with `{ "template": "..." }`. The referenced child
template is resolved, and its rendered Markdown remains opaque output rather than
being interpreted as parent source. Every declared slot must resolve, including
slots in unselected schema branches; only present values contribute output and
array order is preserved. Missing slots, incompatible input, invalid schemas,
and composition cycles fail before rendering.

## Validation stages

The lifecycle checks the document in order:

1. Raw structural validation parses JSON or JSONC and checks the document shape,
   schema URI, containers, inheritance, and selectors.
2. Resource resolution loads selected presets, resources, instances, templates,
   package metadata, and transitive references.
3. Resolved validation checks values, effective templates, composition, and
   template-owned input.
4. Build renders the validated input into a prepared project and materializes
   the complete native output set.

`validate` runs the first three stages without rendering or materializing.
`build`
runs all four. Missing targets, invalid locators, malformed schemas, missing
value references, unsupported fields, incompatible templates, and invalid input
are reported as [Diagnostics](/reference/diagnostics) with stable codes and
source locations. The resource system fails closed: invalid input produces no
canonical document and the builder materializes no partial output.

See the [Introduction](/introduction) for Atlante's execution boundary.
[Materialization](/reference/materialization) describes the result of the final
stage.
