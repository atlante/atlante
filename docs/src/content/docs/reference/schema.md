---
title: Schema
description: Exact fields and version boundaries for the v0.1 and v0.2 document contracts.
---

Atlante v0.1 documents use this exact, immutable schema URI:

```text
https://atlante.sh/schema/v0.1/schema.json
```

Atlante v0.2 documents use this exact schema URI:

```text
https://atlante.sh/schema/v0.2/schema.json
```

The minimal valid document adds one of them to `atlante.jsonc` or `atlante.json`:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json"
}
```

The schema is JSON Schema Draft 2020-12. Strict JSON is a compatible subset of
JSONC, so the same document contract applies to both supported filenames.

## Supported source files

The project's source configuration is exactly one of `atlante.jsonc` or
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
| `options` | object | Native output directories by kind; each kind accepts an `outDir` override |
| `agents` | object | Map from non-empty host-agent IDs to bindings or `null` tombstones |
| `skills` | object | Map from non-empty skill IDs to bindings or `null` tombstones |
| `eval` | object | Optional `atlante eval` configuration: host runner, scenario-document glob, model, and budget |
| `hosts` | non-empty string array | Host materialization targets; v0.1 admits only `"opencode"`, v0.2 additionally admits `"claude-code"` |

Unknown top-level fields are rejected. Missing `agents` and `skills` maps become
empty maps in the canonical document. `hosts` must not contain duplicates, and
an absent `hosts` field defaults to `["opencode"]` in the canonical document.
An absent `options` field defaults to default output directories in the
canonical document.

## Binding fields

A binding can be a resource locator string or an object. Object bindings may
contain this reserved metadata:

| Field | Type | Description |
| --- | --- | --- |
| `$template` | string | Selects a template resource |
| `$instance` | string | Selects an instance resource |
| `description` | non-empty string or `null` | Optional host lookup metadata overlay, interpolated before canonical validation; `null` removes inherited metadata |
| `values` | object | Binding-local string value overrides; `null` removes an inherited value |
| other fields | template-defined | Input validated by the selected template |

`$template` and `$instance` cannot occur together. The legacy `template` field is
reserved and invalid. A bare locator is shorthand for `$instance`.

An object binding in the top-level `agents` or `skills` collection may omit both
selectors. The document layer then uses `@atlante/pack/agent` for agents and
`@atlante/pack/skill` for skills. Selector-less behavior does not apply to nested
resource source objects, which require `$template` or `$instance`.

## Agent and skill maps

Agent map keys remain host-agent IDs, and skill map keys remain skill IDs.
Authored bindings may omit `description` or set it to `null`; canonical agent
and skill bindings require a non-empty `description` after composition and
interpolation. Canonical binding values contain strings only. The
[Materialization](/reference/materialization) reference explains how those IDs
become native output paths.

The document schema leaves template-owned fields open. Resource resolution and
template validation determine whether those fields are valid for the selected
resource.

See [Eval](/reference/eval) for the configuration and scenario contract.

Value keys match `[A-Za-z_$][A-Za-z0-9_$-]*`, and canonical values are strings.
The only supported system value is `{{sys.cwd.basename}}`, which resolves to the
current working directory's basename immediately before descriptions and
template input are rendered. Arbitrary filesystem and environment lookups are
not part of the document contract.

## Defaults and precedence

- An explicit configuration path is read directly. Without one, discovery
  accepts exactly one of `atlante.jsonc` or `atlante.json`; both files produce
  `ambiguous-config`.
- Missing `agents` and `skills` maps normalize to empty maps. Missing `hosts`
  normalizes to `["opencode"]`; host targets cannot repeat.
- Missing `options` normalizes to default output directories. The defaults are
  `.opencode/agents` for agents and `.opencode/skills/atlante` for skills.
  Each kind accepts an independent `outDir` override with a safe
  project-relative path. These directories are OpenCode-scoped: the Claude
  Code materializer publishes fixed `.claude/` locations described in
  [Materialization](/reference/materialization).
- Presets resolve from left to right, then the local document overlays them.
  Objects merge recursively, arrays and scalars replace, and `null` removes an
  inherited field.
- Project values override inherited preset values. Binding-local values
  override the effective global values only within that binding.

## Canonical form

After resolution, the canonical document contains the schema URI, merged values,
agent bindings, skill bindings, output options, host targets, and optional eval configuration.
Merged values can still contain the supported system reference until rendering.
The canonical document has no `extends`, `$template`, `$instance`, or unresolved
`null` removals.

## Failure cases and diagnostics

Raw validation rejects unknown fields, invalid container shapes, duplicate hosts,
and conflicting selectors. Resolution then checks packs, resources, templates,
and inherited values. Read [Diagnostics](/reference/diagnostics) for the stable
codes and recovery actions emitted by these stages.

## Hosted and repository sources

Use the [hosted v0.1 schema](https://atlante.sh/schema/v0.1/schema.json) or
the [hosted v0.2 schema](https://atlante.sh/schema/v0.2/schema.json) in editor
and tooling configuration. For repository inspection, use the committed
[generated schema files](https://github.com/atlante/atlante/tree/main/packages/schema/schema)
and their [schema source definitions](https://github.com/atlante/atlante/blob/main/packages/schema/src/document.ts).
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

Version 0.2 adds the `"claude-code"` host target to `hosts` and `eval.host`,
the `atlante-claude-code-native` manifest format, and pack suite
host-compatibility enforcement. Released v0.1 URIs stay immutable, and v0.1
documents keep identical behavior.

## Next steps

- [Configuration](/concepts/configuration) introduces the authored document.
- [Templates](/concepts/templates) explains template and instance selectors.
- [Resolution](/concepts/resolution) describes the validation and composition
  stages.
