# Atlante Specification

**Status:** Draft  
**Version:** 0.1  
**Implementation profile:** Prompt-first

This document adds the technical details and normative requirements for the
first Atlante specification.

## 1. Scope

Version 0.1 defines a provider-neutral configuration model for structured agent
prompts. It defines a composable template system that owns prompt semantics, a
two-level validation model (document structure + template input schemas),
deterministic resolution, and an OpenCode adapter that materializes the resolved
prompts into host agent definitions.

Version 0.1 includes:

- a minimal document structure (`$schema`, `agents`, `values`);
- a composable, namespaced template system (`namespace/name`) with Markdown
  rendering and variable resolution;
- a template protocol for prompt rendering and validation;
- global values with per-agent overrides, resolved into prompt definitions via
  `{{values.x}}`;
- host-agent bindings whose prompt inputs are defined by templates;
- two-level validation (document structure + template input schema);
- deterministic prompt resolution;
- OpenCode prompt materialization;
- bundled `starter` preset (`atlante init`).

Version 0.1 does not include:

- model selection, effort, permissions, or other host-agent configuration;
- user-defined prompt templates or third-party template authoring;
- rules or skills;
- LLM inference or direct agent execution;
- Atlante runtime tools;
- preset export, sharing, or remote registry.

The excluded runtime capabilities remain possible future extensions of the
design and must not be implied by the version 0.1 schema.

## 2. Conformance and Normative Language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
normative.

An implementation conforms to version 0.1 if it:

1. accepts only documents that satisfy this specification;
2. rejects invalid references, missing required values, and unsupported fields
   before resolution;
3. produces deterministic resolution output for the same input document; and
4. preserves the semantics of the canonical document when materializing host
   artifacts.

The serialized configuration format is JSONC (JSON with comments). Strict JSON
is also supported as a compatible subset for `atlante.json` files. JSON Schema
Draft 2020-12 is the normative format for template input schemas. Zod MAY be
used by an implementation for runtime validation and type inference, but Zod
code is not part of the configuration format.

## 3. Terminology

- **Host**: the AI coding harness that executes agents, such as OpenCode.
- **Host agent**: an agent identified and configured by the host.
- **Agent binding**: the association between a host-agent ID and an Atlante
  prompt definition.
- **Prompt definition**: the structured, user-authored values from which Atlante
  renders an agent system prompt; prompt sections are defined by the referenced
  template, not by the schema.
- **Orchestrator**: a host agent whose selected template includes workflow or
  delegation instructions and may coordinate other agents through host
  capabilities. Orchestration is a template-defined role; version 0.1 does not
  require an orchestrator, reserve a host-agent ID, or define a dedicated field.
- **Template**: a composable, namespaced Markdown renderer with an input schema;
  templates define prompt semantics independently of the document schema.
- **Template ID**: a `namespace/name` identifier (e.g., `provider/template`);
  the namespace identifies the provider, the name identifies the template.
- **Template manifest**: the `template.json` file declaring a template's
  canonical `id`, optional `description`, and `inputSchema`.
- **Template slot**: a property in a composable template's `inputSchema`
  declared as `{ "template": "namespace/name" }`, indicating that the slot
  expects the rendering of another template.
- **Preset**: a pre-configured root-level Atlante configuration bundled as a
  starting point for new projects; `atlante.jsonc` is the default form and
  `atlante.json` is also supported. A preset carries a manifest declaring a
  versioned `$schema` and a `namespace/name` `id`, so presets can later be
  distributed by third parties on the same terms as templates. A preset is a
  document, not a renderer, which is what distinguishes it from a **template**.
- **Extends**: an optional field at the document level that references
  a preset by its `namespace/name` id. When present, the referenced preset's
  configuration is loaded, expanded recursively, and merged with the local
  configuration using JSON Merge Patch semantics. The local layer always takes
  precedence. `extends` is consumed during expansion and never reaches the
  resolved document or rendered prompt.
- **Values**: a flat dictionary of project-wide string values (`project`,
  `language`) in the document root, referenced from a prompt definition via
  `{{values.x}}` and resolved into it before rendering. Values are never
  passed to a template.
- **System value**: a `{{sys.<key>}}` reference used inside a preset's `values`
  dictionary to supply a default that is resolved at runtime (e.g.,
  `{{sys.cwd.basename}}`). System values are resolved during document expansion
  — before `{{values.x}}` interpolation — so a user override always takes
  precedence. Unknown system value keys MUST be diagnosed. Version 0.1 defines
  `cwd.basename`; other system value keys are reserved for future versions.
- **Adapter**: the host-specific component that translates resolved Atlante
  artifacts into host configuration.

## 4. Configuration Document

The canonical project configuration MUST be stored as exactly one of:

```text
atlante.jsonc
atlante.json
```

`atlante.jsonc` is the default filename generated by `atlante init` and SHOULD
be preferred when comments are useful. `atlante.json` MUST contain strict JSON;
`atlante.jsonc` MAY contain JSONC comments. Both filenames MUST validate against
the same document schema and resolve to the same canonical document model.

When no explicit configuration path is provided, the CLI MUST discover either
root-level filename. If both files exist, the CLI MUST report an ambiguous
configuration and require an explicit path rather than choosing silently.

The document MUST contain exactly one agent map and MAY contain a values
dictionary. Its top-level shape is:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",

  // Global values — resolved into prompt definitions before rendering
  "values": {
    "project": "my-project",
    "language": "TypeScript",
  },

  // Agent bindings — host-agent-ID → prompt definition
  "agents": {
    "workflow-agent": {
      "values": {
        "scope": "Workflow-agent-specific constraint.",
      },
      // Prompt fields are defined by the selected template's inputSchema.
      "promptTemplate": "provider/template",
    },
  },
}
```

The document MUST NOT contain fields other than `$schema`, `values`, and
`agents`. Unknown top-level fields MUST be rejected.

### 4.1 Schema reference

`$schema` MUST be a versioned URI identifying the JSON Schema used for the
document. The version in the URI is the sole schema-version reference in the
configuration document. The schema document at a released URI MUST be immutable.
Validators MUST NOT require network access to validate a document; the
corresponding schema MUST also be available from the installed schema package.

An implementation MUST reject unsupported schema URIs rather than silently
interpreting them. The schema document MUST identify itself with a versioned
`$id`, for example:

```json
{
  "$id": "https://atlante.sh/schema/v0.1/schema.json",
  "$schema": "https://json-schema.org/draft/2020-12/schema"
}
```

### 4.2 Values

`values` MUST be a flat dictionary whose values are strings. Value names MUST
match `[A-Za-z_$][A-Za-z0-9_$-]*` and are referenced directly via
`{{values.key}}`; value names do not represent nested paths. Values are
project-wide and are resolved into prompt definitions via these references. An
agent definition MAY contain a `values` object for local overrides. The resolver
MUST merge local values over global values by key; a local value replaces the
global value with the same key for that agent only.

A preset value MAY use a `{{sys.<key>}}` reference to defer resolution to
runtime (see §11.1). System value references MUST be resolved during document
expansion, before `{{values.x}}` interpolation; this ensures that
`{{values.x}}` lookups never encounter unresolved system references. Unknown
`sys.<key>` keys MUST be diagnosed before rendering.

### 4.3 Agent map

`agents` MUST be an object whose keys are host-agent IDs. A host-agent ID is an
opaque, non-empty string owned by the host adapter.

Each value is a prompt definition. An agent MAY identify its prompt template
with `promptTemplate`; when omitted, the implementation's configured default
template is used. `promptTemplate` and `values` are binding metadata and are not
passed as template input. The selected template's `inputSchema` is authoritative
for the prompt definition's fields and value types. The document schema does not
prescribe prompt field names, ordering, or content.

The map key is the host-agent ID. Atlante MUST NOT define a second logical ID
for the same binding in version 0.1.

## 5. Canonical Model and Implementation Layers

The Atlante JSONC document is a declarative language for agent prompts. Its
contract is divided across four layers:

1. `@atlante/schema` defines the serializable document shape (`$schema`,
   `agents`, `values`) and publishes the versioned JSON Schema and corresponding
   TypeScript types; it does not define prompt semantics;
2. `@atlante/templates` defines prompt semantics through composable templates;
   each template carries a manifest with an input schema and a Markdown
   renderer;
3. `@atlante/validator` applies structural checks on the document and semantic
   checks on templates, including reference validity and template input schema
   validation;
4. `@atlante/resolver` normalizes the document into a structured,
   host-independent model, renders templates with resolved values, and produces
   artifact descriptors.

Templates render prompt content; they do not define execution semantics or
schedule execution.

The public v1 language is the JSONC document itself.

## 6. Prompt Definition and Template System

### 6.1 Template model

In version 0.1, prompt semantics are entirely defined by templates. The schema
does not prescribe prompt sections, ordering, or content. Templates are
composable, namespaced Markdown renderers with typed input schemas.

Each template consists of:

- `template.json` — a manifest declaring the canonical `id` (`namespace/name`),
  an optional `description`, and an `inputSchema` (JSON Schema Draft 2020-12)
  that validates the template's inputs;
- a Markdown renderer that produces the prompt text from validated inputs.
  Renderer syntax and source layout are template-package concerns.

### 6.2 Template naming

Template IDs follow the `namespace/name` convention:

- `atlante/` — bundled templates shipped with Atlante
- other namespaces are reserved for future template extensions

The specification does not enumerate bundled templates or prescribe their prompt
content. Implementations MAY distribute first-party templates through a template
package; that package's manifests and documentation are authoritative for the
templates it provides.

### 6.3 Template composition

Composable templates MAY declare slot references in their `inputSchema`:

```json
{
  "type": "object",
  "properties": {
    "section": { "template": "provider/template" }
  }
}
```

The template manifest continues to identify the containing template:

```json
{
  "$schema": "https://atlante.sh/schema/template/v0.1/schema.json",
  "id": "provider/composite",
  "description": "Composable prompt renderer.",
  "inputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object"
  }
}
```

The referenced template's input schema MUST be loaded and validated before the
containing template is rendered. The syntax used to invoke a slot is an
implementation concern as long as the composition semantics are preserved.

### 6.4 Variable resolution

Values are resolved into the prompt definition before rendering, not exposed to
templates. The resolver MUST merge global and per-agent values, then MUST
replace every `{{values.key}}` reference appearing in the prompt definition with
the resolved value, before the selected template is rendered. Per-agent
overrides take precedence over global values for that agent, using the
key-by-key merge defined in §4.2.

A template MUST NOT receive the `values` dictionary. A template's input contract
is its `inputSchema` and nothing else: because `values` is a free-form,
user-authored dictionary whose keys the schema does not define, a template that
read from it would produce output determined by data no schema can validate,
defeating the two-level validation model of §8 and allowing a template to depend
silently on undocumented conventions in a user's document.

Replacement MUST substitute, MUST NOT evaluate. Only `{{values.key}}`
references are replaced; all other content in the prompt definition, including
text that resembles other template syntax, MUST be preserved verbatim and MUST
NOT cause an error. A values-like construct with an unsupported key syntax, or a
`{{values.key}}` reference whose key is not present in the merged values, is
invalid and MUST be diagnosed before rendering. This constraint does not apply
to a template's own renderer source, which is a genuine template.

### 6.5 Agent prompt rendering

The selected template receives the agent's prompt definition and renders the
complete system prompt. The template's manifest and `inputSchema` define the
accepted fields. Rendering order and optional content are template
implementation concerns and are not part of the document schema.

A template MAY include workflow or delegation instructions that cause its bound
agent to serve as an orchestrator. The role is determined by the selected
template and its inputs, not by a reserved host-agent ID or schema field. The
specification does not require every configuration to define an orchestrator.

Host agent files MUST NOT contain an independent prompt that competes with the
Atlante prompt; the Atlante configuration is the prompt source of truth.

## 7. Agent Bindings

An agent binding associates one existing or materialized host agent with one
canonical prompt definition. The prompt definition's fields are defined by the
referenced template and its `inputSchema`.

The adapter:

- MUST use the map key as the host-agent ID;
- MUST render the prompt definition using the resolved template;
- MUST resolve all `{{values.x}}` references before rendering, applying
  per-agent overrides where present;
- MUST NOT change host-owned model, effort, permission, or tool settings;
- MUST create a host agent definition when the host agent does not exist, using
  host-specific defaults for fields outside the Atlante schema;
- MUST replace the host agent's prompt with the rendered Atlante prompt;
- SHOULD emit a warning when replacing a non-empty existing host prompt.

The exact warning channel and host-specific file format are adapter concerns.
The default adapter SHOULD report warnings through resolver, CLI, or plugin
diagnostics rather than creating an additional warning file.

## 8. Validation

Validation MUST happen before resolution or materialization. Validation operates
at two levels: document structure and template semantics.

### 8.1 Document-level validation

A document-level validator MUST report diagnostics with a document path whenever
possible.

The validator MUST reject:

- invalid JSON or an unsupported `$schema` URI;
- a missing required `agents` object;
- a present `values` field that is not an object;
- unknown top-level fields;
- unknown or invalid prompt inputs as defined by the selected template's
  `inputSchema`;
- unsupported or unknown fields within version 0.1 entities.

### 8.2 Template-level validation

Template validation operates on the template manifest and its composition graph.

The validator MUST reject:

- templates whose `template.json` manifest is missing or malformed;
- templates with an invalid or missing `inputSchema`;
- template slot references (`{ "template": "namespace/name" }`) that point to
  non-existent templates;
- circular template composition (template A includes B which includes A);
- input values that do not satisfy a template's `inputSchema`.

Validation SHOULD also detect statically incompatible values where a future
runtime feature would consume them.

### 8.3 Template distribution

Template packages MAY distribute bundled templates. A validator MUST validate
configurations against the manifests and input schemas of the templates selected
for resolution. Templates required by a configuration MUST be available without
network access during validation and resolution.

## 9. Resolution and Materialization

Resolution transforms the canonical document into host-independent artifact
descriptors. Resolution MUST be deterministic and MUST NOT execute agents,
commands, or arbitrary project code.

The resolver MUST:

1. operate only on a document that has already passed structural validation,
   and perform template-level validation itself, refusing to render when either
   level reports an error;
2. resolve global `values` and per-agent overrides;
3. load the selected template for each agent binding, using the configured
   default when `promptTemplate` is omitted;
4. substitute resolved `{{values.x}}` references into the prompt definition,
   then render it with the selected template;
5. produce one agent artifact descriptor per binding;
6. preserve host-agent IDs in every descriptor.

Materialization is performed by an adapter. The OpenCode adapter MUST:

- locate an existing host agent by its configured ID;
- create a missing host agent using OpenCode defaults where necessary;
- write the rendered Atlante prompt as that agent's system prompt;
- preserve host-owned configuration fields;
- report prompt replacement warnings;
- avoid executing the agent or any command.

Repeated materialization from the same valid document SHOULD produce the same
host artifacts and MUST NOT duplicate agents.

## 10. Package Boundaries

The v1 implementation SHOULD preserve these package responsibilities:

- `@atlante/schema`: document structure contract (`$schema`, `agents`,
  `values`), versioned JSON Schema, and TypeScript types; no prompt semantics,
  no template logic, no host or rendering logic;
- `@atlante/templates`: versioned template-manifest schema; template loading,
  parsing, composition, and Markdown rendering; `namespace/name` convention;
  template manifests and input schemas; variable resolution and slot
  composition;
- `@atlante/validator`: document structural validation (references, required
  fields, types) and template-level validation (manifest correctness, input
  schema compliance, composition acyclicity);
- `@atlante/resolver`: normalization, template composition, value
  resolution, and host-independent artifact descriptors;
- `@atlante/presets`: versioned preset-manifest schema; preset loading and the
  bundled presets themselves;
- `@atlante/opencode-plugin`: OpenCode materialization and future runtime;
- `@atlante/cli`: validation, resolution, materialization, and
  `atlante init` entry point.

`@atlante/templates` and `@atlante/presets` are the two content packages and
MUST remain leaves of the dependency graph: neither depends on any other Atlante
package. `@atlante/presets` therefore loads and exposes presets but MUST NOT
validate them — a preset is an Atlante document, so validating it belongs to the
validator and to whoever consumes the preset. Keeping both content packages
dependency-free is what allows third parties to distribute templates and presets
without depending on the core.

An adapter MUST receive resolved descriptors and MUST NOT contain a separate
execution branch for each renderer.

## 11. OpenCode Adapter Profile

The OpenCode adapter is the first host integration. Version 0.1 defines its
prompt materialization responsibilities and preset support. Runtime
execution and state management are outside this specification.

The adapter MUST treat the Atlante configuration as the only source of truth for
prompts. Users SHOULD not maintain a competing prompt in OpenCode agent
configuration.

### 11.1 Preset inheritance

`atlante init` scaffolds a project configuration that extends a bundled preset
via the `extends` field. The generated configuration carries only the document
`$schema` and the `extends` reference; values are left to the preset's system
value defaults (e.g. `project` resolves to the basename of `process.cwd()` at
runtime). Users add per-project overrides as needed.

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "atlante/starter"
}
```

To override a value, add a `values` object:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "atlante/starter",
  "values": {
    "project": "my-project"
  }
}
```

`atlante init --preset <name>` generates a configuration extending the named
preset. The `extends` field names a preset by its full `namespace/name` id.

#### Override semantics

Preset inheritance uses JSON Merge Patch semantics with the local layer always
taking precedence:

- An absent property preserves the inherited value.
- Scalars replace inherited values.
- Objects merge recursively by key.
- Arrays replace inherited arrays completely.
- `values` merge by key; agent-local values override document-level values.
- `agents` merge by agent ID; new IDs are added and existing IDs are
  recursively overridden.
- `null` removes an inherited property, value entry, or agent binding.
  Tombstones are consumed during expansion and MUST NOT reach the canonical
  resolved document.
- `extends` is consumed during expansion and MUST NOT be passed to a prompt
  template.

#### Validation and resolution

The implementation MUST apply one shared expansion path before validation and
resolution:

1. Parse the local document as an overlay that may contain `extends` and
   tombstone `null` values.
2. Load and recursively expand referenced presets, detecting inheritance cycles.
3. Merge inherited and local layers according to the override semantics above.
4. Produce a canonical document without `extends` or tombstones.
5. Run the existing document, value, composition, and template-input validation
   against that canonical document.
6. Resolve and render exactly as for a non-inherited configuration.

Diagnostics MUST identify the local JSON Pointer and preset chain for at least:

- unknown preset IDs;
- inheritance cycles;
- depth limits exceeded.

The validator package MUST NOT depend directly on bundled presets. A preset
loader or registry MUST be injected so that CLI and host adapters can provide
built-in or, later, plugin-contributed presets through the same path.

Version 0.1 MUST include the `atlante/starter` preset as the default
initialization target. The starter preset MUST provide at least a guide
agent and a build agent.

## 12. Compatibility and Evolution

### 12.1 Version domains

Atlante uses separate version domains for separate contracts:

- **Document schema**: the project document's `$schema` URI identifies the
  versioned Atlante document contract. Released document schemas are immutable.
- **Template manifest schema**: a template manifest's `$schema` URI identifies
  the versioned manifest format, independently of the document schema. Version
  0.1 uses `https://atlante.sh/schema/template/v0.1/schema.json`.
- **Template input schema**: each template's `inputSchema` MUST be valid JSON
  Schema Draft 2020-12 and MUST declare that dialect with its own `$schema`
  property. This identifies the schema language, not a template release.
- **Package release**: package versions identify implementation releases and
  MUST NOT be used as serialized document schema references. Template
  implementations MUST be selected reproducibly by an exact package version
  recorded in a project lockfile, or by a template ID paired with an immutable
  version or digest.

Template implementation changes MUST NOT silently change the behavior selected
by an existing reproducible configuration. A change to a template's input schema
or rendered output MUST use a new package version, template version, or digest.
Such a change MUST NOT require a new document schema URI unless the document
contract itself changes.

Template manifests MUST declare an `id` using the `namespace/name` convention.
The manifest ID MUST match the template's resolved identity. The `id` is the
canonical template identity; it MUST NOT be inferred from a package version.

An implementation MUST reject a document whose `$schema` URI it does not
support. Version 0.1 does not define migrations.

Future versions MAY add:

- user-defined prompt templates and third-party template authoring;
- prompt extension namespaces;
- runtime tools and state;
- preset export, sharing, and remote registry;
- rules and skills.

These additions MUST preserve the distinction between Atlante-owned prompt
content (templates) and host-owned execution settings.

## 13. Acceptance Criteria

Version 0.1 is complete when a conforming implementation can:

1. validate minimal `atlante.jsonc` and `atlante.json` documents;
2. reject missing references and invalid template references;
3. validate template manifests and their input schemas;
4. resolve global values and per-agent overrides into prompt definitions;
5. render a deterministic prompt from structured agent values using the selected
   template;
6. create a missing OpenCode agent with host defaults;
7. replace an existing agent prompt while preserving host-owned fields;
8. report a warning when a non-empty host prompt is replaced;
9. scaffold a project from the bundled `starter` preset via `atlante init`.
