---
title: Schema
description: Exact fields and version boundaries for the v0.1 document contract.
---

Atlante v0.1 documents use this exact, immutable schema URI:

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

## Supported source files

The canonical project configuration is exactly one of `atlante.jsonc` or
`atlante.json`. `atlante.jsonc` may contain comments; `atlante.json` must contain
strict JSON. If both exist and no explicit path was supplied, the CLI reports
`ambiguous-config` instead of choosing silently.

## Top-level fields

The document contract accepts these fields:

| Field | Type | Description |
| --- | --- | --- |
| `$schema` | string | Required v0.1 schema URI |
| `extends` | string or non-empty string array | Preset locator or ordered preset layers |
| `values` | object | Named string values; source overlays may use `null` to remove inherited values |
| `agents` | object | Map from non-empty host-agent IDs to bindings or `null` tombstones |
| `skills` | object | Map from non-empty skill IDs to bindings or `null` tombstones |
| `eval` | object | Optional `atlante eval` configuration: OpenCode host, scenario-document glob, model, and budget |
| `hosts` | non-empty string array | Host materialization targets; v0.1 admits only `"opencode"` |

Unknown top-level fields are rejected. Missing `agents` and `skills` maps become
empty maps in the canonical document. `hosts` must not contain duplicates, and
an absent `hosts` field defaults to `["opencode"]` in the canonical document.

## Binding fields

A binding can be a resource locator string or an object. Object bindings may
contain this reserved metadata:

| Field | Type | Description |
| --- | --- | --- |
| `$template` | string | Selects a template resource |
| `$instance` | string | Selects an instance resource |
| `description` | non-empty string | Host lookup metadata, interpolated before validation |
| `values` | object | Binding-local string value overrides |
| other fields | template-defined | Input validated by the selected template |

`$template` and `$instance` cannot occur together. The legacy `template` field is
reserved and invalid. A bare locator is shorthand for `$instance`.

An object binding in the top-level `agents` or `skills` collection may omit both
selectors. The document layer then uses `@atlante/pack/agent` for agents and
`@atlante/pack/skill` for skills. Selector-less behavior does not apply to nested
resource source objects, which require `$template` or `$instance`.

## Agent and skill maps

Agent map keys remain host-agent IDs, and skill map keys remain skill IDs. Both
binding types require a non-empty `description` after interpolation. The
[Materialization](/reference/materialization) reference explains how those IDs
become native output paths.

The document schema leaves template-owned fields open. Resource resolution and
template validation determine whether those fields are valid for the selected
resource.

See [Eval](/reference/eval) for the configuration and scenario contract.

Values are strings. The only supported system value is `{{sys.cwd.basename}}`,
which resolves to the current working directory's basename. Arbitrary filesystem
and environment lookups are not part of the document contract.

## Canonical form

After resolution, the canonical document contains the schema URI, resolved
values, agent bindings, skill bindings, and optional eval configuration. It has
no `extends`, `$template`, `$instance`, or unresolved `null` removals.

## Hosted and repository sources

Use the [hosted v0.1 schema](https://atlante.sh/schema/v0.1/schema.json) in editor
and tooling configuration. For repository inspection, use the committed
[generated schema file](https://github.com/atlante/atlante/blob/main/packages/schema/schema/v0.1/schema.json)
and its [schema source definitions](https://github.com/atlante/atlante/blob/main/packages/schema/src/document.ts).
The private `@atlante/schema` package also exposes the generated file as
`@atlante/schema/schema.json`.

The repository generates the JSON file from the schema package source. Do not edit
the generated JSON directly. Change the authoritative source, then run the
repository generation, build, and validation checks.

See [Templates](/concepts/templates) for template-owned input and
[Resolution](/concepts/resolution) for the validation stages around this
contract. See [Resources](/concepts/resources) for locator behavior.

## Version boundaries

The document schema version, ownership-manifest format version, template input
schema, and package version evolve independently. The CLI rejects an
unsupported document schema URI, and a materializer rejects an unsupported
manifest format, instead of inferring a compatible version.
