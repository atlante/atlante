# Atlante Specification

**Status:** Draft  
**Version:** 0.1  
**Implementation profile:** Prompt-first

This document adds the technical details and normative requirements for the
first Atlante specification.

## 1. Scope

Version 0.1 defines a provider-neutral configuration model for structured agent
prompts and project-global Markdown skills. It defines a composable template
system that owns prompt and skill-content semantics, a two-level validation
model (document structure + template input schemas), deterministic resolution,
and an OpenCode adapter that materializes resolved prompts into host agent
definitions and exposes resolved skills through the in-memory `atlante_skill`
adapter tool.

Version 0.1 includes:

- a minimal document structure (`$schema`, `agents`, `values`, and optional
  `skills`);
- a composable, namespaced template system (`namespace/name`) with Markdown
  rendering and variable resolution;
- a template protocol for prompt rendering and validation;
- global values with per-agent overrides, resolved into prompt definitions via
  `{{values.x}}`;
- project-global skill bindings with descriptions and template-owned Markdown
  content;
- host-agent bindings whose prompt inputs are defined by templates;
- two-level validation (document structure + template input schema);
- deterministic prompt resolution;
- OpenCode prompt materialization and the `atlante_skill` lookup tool;
- bundled `starter` preset (`atlante init`).

Version 0.1 does not include:

- model selection, effort, permissions, or other host-agent configuration;
- user-defined prompt templates or third-party template authoring;
- LLM inference or direct agent execution;
- skill execution, skill runtime state, and remote skill loading;
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
- **Skill binding**: the association between a root `skills` map key and a
  description plus template-owned skill-content input. The map key is the
  binding's `skillId`.
- **Skill artifact**: a resolved, host-independent skill descriptor containing
  `skillId`, `templateId`, `description`, and rendered Markdown `content`.
- **Project-global skill**: a skill binding available independently of any one
  host agent. It is content exposed through an adapter lookup, not an execution
  task or an agent runtime.
- **Prompt definition**: the structured, user-authored values from which Atlante
  renders an agent system prompt; prompt sections are defined by the referenced
  template, not by the schema.
- **Orchestrator**: a host agent whose selected template includes workflow or
  delegation instructions and may coordinate other agents through host
  capabilities. Orchestration is a template-defined role; version 0.1 does not
  require an orchestrator, reserve a host-agent ID, or define a dedicated field.
- **Template**: a composable, namespaced Markdown renderer paired with a JSON
  Schema Draft 2020-12 input schema; templates define prompt semantics
  independently of the document schema.
- **Template ID**: a `namespace/name` identifier (e.g., `provider/template`);
  the namespace identifies the provider, the name identifies the template.
- **Template slot**: a property in a composable template's input schema
  declared as `{ "template": "namespace/name" }`, indicating that the slot
  expects the rendering of another template.
- **Preset**: a pre-configured root-level Atlante configuration bundled as a
  starting point for new projects; `atlante.jsonc` is the default form and
  `atlante.json` is also supported. Its logical `namespace/name` ID is assigned
  by the loader registry rather than serialized inside the document. A preset
  is a document, not a renderer, which distinguishes it from a **template**.
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

Configuration files are first parsed as raw overlay input for preset expansion. A
raw overlay MAY contain `extends` and MAY omit `agents` when those bindings are
inherited. After expansion, `extends` is consumed and the result MUST be a
strict canonical document; the field restrictions below apply to that canonical
document, not to the raw overlay's expansion metadata.

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
      // Prompt fields are defined by the selected template's input schema.
      "template": "provider/template",
    },
  },

  // Project-global Markdown skills — skillId → skill binding
  "skills": {
    "testing": {
      "description": "Testing guidance for {{values.project}}.",
      "template": "atlante/skill",
      "content": "Run the focused test suite.",
    },
  },
}
```

The document MUST NOT contain fields other than `$schema`, `values`, `agents`,
and optional `skills`. Unknown top-level fields MUST be rejected. `skills` is an
optional object whose non-empty keys are `skillId` values. Each skill binding
MUST contain a non-empty string `description`; `template` defaults to
`atlante/skill` and, when present, MUST be a non-empty template ID. `description`,
`template`, and `values` are reserved binding metadata. Every other skill field
is template-owned input and MUST be validated against the selected template's
input schema.

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

#### 4.1.1 Approved v0.1 compatibility exception

The addition of optional `skills` to the existing v0.1 schema URI is an
approved one-off additive compatibility exception for project-global skill
support. The URI remains
`https://atlante.sh/schema/v0.1/schema.json`; implementations MUST continue to
accept every previously valid v0.1 document with the same canonical agent and
value semantics, and documents without `skills` MUST resolve to the same agent
artifacts. Unknown fields other than the new optional `skills` field remain
errors. Future schema changes MUST NOT modify a released schema in place: they
remain immutable and MUST use a new versioned URI.

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
with `template`; when omitted, the implementation's configured default template
is used. `template` and `values` are binding metadata and are not passed as
template input. The selected template's JSON Schema is authoritative for the
prompt definition's fields and value types. The document schema does not
prescribe prompt field names, ordering, or content.

The map key is the host-agent ID. Atlante MUST NOT define a second logical ID
for the same binding in version 0.1.

## 5. Canonical Model and Implementation Layers

The Atlante JSONC document is a declarative language for agent prompts. Its
contract is divided across four layers:

1. `@atlante/schema` defines the serializable document shape (`$schema`,
   `agents`, `values`, optional `skills`) and publishes the versioned JSON
   Schema and corresponding TypeScript types; it does not define prompt or
   skill semantics;
2. `@atlante/templates` defines prompt semantics through composable templates;
   each template pairs a Draft 2020-12 input schema with a Markdown renderer;
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

- `template.json` — the JSON Schema Draft 2020-12 object that validates the
  template's inputs and MAY use standard annotations such as `title` and
  `description`;
- `template.md` — the Markdown renderer that produces prompt text from validated
  inputs.

The loader registry supplies a namespace and derives the template name from its
directory. The template does not serialize a second ID.

### 6.2 Template naming

Template IDs follow the `namespace/name` convention:

- `atlante/` — bundled templates shipped with Atlante
- other namespaces are reserved for future template extensions

The specification does not enumerate bundled templates or prescribe their prompt
content. Implementations MAY distribute first-party templates through a template
package; that package's registry and documentation are authoritative for the
templates it provides.

### 6.3 Template composition

Composable templates MAY declare slot references directly in `template.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "section": { "template": "provider/template" }
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
is its `template.json` schema and nothing else: because `values` is a free-form,
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
complete system prompt. The template's `template.json` defines the accepted
fields. Rendering order and optional content are template implementation
concerns and are not part of the document schema.

A template MAY include workflow or delegation instructions that cause its bound
agent to serve as an orchestrator. The role is determined by the selected
template and its inputs, not by a reserved host-agent ID or schema field. The
specification does not require every configuration to define an orchestrator.

Host agent files MUST NOT contain an independent prompt that competes with the
Atlante prompt; the Atlante configuration is the prompt source of truth.

### 6.6 Skill content rendering

The bundled `atlante/skill` template has one required string input, `content`,
and renders it as Markdown without executing it. A skill's `description` is
resolved separately as binding metadata and listed in the tool description for
discovery; successful `atlante_skill` execution returns only rendered Markdown
`content`. The description is not template input. Skill content and skill
execution are distinct contracts: version 0.1 defines content validation,
interpolation, rendering, and lookup only, not execution, scheduling, runtime
state, or remote loading.

## 7. Agent Bindings

An agent binding associates one existing or materialized host agent with one
canonical prompt definition. The prompt definition's fields are defined by the
referenced template and its input schema.

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

### 7.1 Skill bindings

`skills` MUST be an object keyed by non-empty `skillId` strings. Each skill
binding MUST contain a non-empty `description`; the description is metadata for
lookup and is not passed to the template. `template` selects the skill content
renderer and defaults to `atlante/skill`. `values` contains local value
overrides. Every other field is template-owned input. Skills are global to the
project and are not associated with a host-agent ID.

The resolver renders each skill into a `SkillArtifact`; defining or resolving a
skill MUST NOT execute its content. The OpenCode adapter exposes the artifact
through `atlante_skill` rather than writing a native OpenCode skill file or
registering the native `skill` tool.

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
- a present `skills` field that is not an object, an empty skill ID, or a skill
  binding without a non-empty string `description`;
- unknown top-level fields;
- unknown or invalid prompt inputs as defined by the selected template's
  input schema;
- unsupported or unknown fields within version 0.1 entities.

For every skill, validation MUST use paths rooted at
`/skills/<skillId>`. It MUST interpolate `description` with the same resolved
global-plus-local values used by the skill input, reject missing or invalid
value references, and reject a description that is empty after interpolation.
The reserved fields `description`, `template`, and `values` MUST be removed
from the input presented to the selected skill template; all remaining fields
are template-owned input.

### 8.2 Template-level validation

Template validation operates on each direct input schema and its composition
graph.

The validator MUST reject:

- templates whose `template.json` is missing, malformed, or does not declare
  JSON Schema Draft 2020-12;
- templates whose `template.json` is not a valid input schema;
- template slot references (`{ "template": "namespace/name" }`) that point to
  non-existent templates;
- circular template composition (template A includes B which includes A);
- input values that do not satisfy a template's input schema.

The same template and composition failures apply to skills: unknown default or
explicit templates, missing slot references, circular composition, malformed or
invalid Draft 2020-12 input schemas, invalid skill input, unsupported value
references, missing values, value-reference collisions, and unknown system
values MUST fail validation with diagnostics at the relevant skill JSON Pointer.

Validation SHOULD also detect statically incompatible values where a future
runtime feature would consume them.

### 8.3 Template distribution

Template packages MAY distribute bundled templates. A validator MUST validate
configurations against the input schemas of templates selected for resolution.
Templates required by a configuration MUST be available without network access
during validation and resolution.

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
   default when `template` is omitted;
4. substitute resolved `{{values.x}}` references into the prompt definition,
   then render it with the selected template;
5. produce one agent artifact descriptor per binding;
6. preserve host-agent IDs in every descriptor.

For skills, the resolver MUST:

1. iterate the root `skills` map in its stable object-enumeration order;
2. select the explicit `template` or default to `atlante/skill`;
3. merge global values with skill-local `values`, resolve system values, and
   interpolate both `description` and template-owned input before rendering;
4. remove reserved skill metadata (`description`, `template`, and `values`) from
   template input;
5. produce one `SkillArtifact` per binding with exactly `skillId`, `templateId`,
   `description`, and rendered Markdown `content`.

`ResolvedHarness` MUST contain `agents`, `skills`, and `diagnostics`. The
`skills` array preserves root `skills` map order. Resolution is globally
fail-closed: if any agent or skill validation, value interpolation,
composition, or rendering fails, it MUST return no partial agent or skill
artifacts, MUST return empty `agents` and `skills` arrays, and MUST report
diagnostics. An empty `skills` array is a successful result when the document
contains no skills.

Materialization is performed by an adapter. The OpenCode adapter MUST:

- locate an existing host agent by its configured ID;
- create a missing host agent using OpenCode defaults where necessary;
- write the rendered Atlante prompt as that agent's system prompt;
- preserve host-owned configuration fields;
- report prompt replacement warnings;
- avoid executing the agent or any command.

The adapter MUST resolve the complete document once during OpenCode
initialization. It MUST stage all agent configuration changes on a clone and
commit the staged config only after agents and skills resolve successfully. A
failure MUST leave the host config unchanged; no partial agent injection or
partial skill availability is permitted.

Repeated materialization from the same valid document SHOULD produce the same
host artifacts and MUST NOT duplicate agents.

## 10. Package Boundaries

The v1 implementation SHOULD preserve these package responsibilities:

- `@atlante/schema`: document structure contract (`$schema`, `agents`, `values`,
  optional `skills`), versioned JSON Schema, and TypeScript types; no prompt or
  skill-content semantics, no template logic, no host or rendering logic;
- `@atlante/templates`: direct Draft 2020-12 input schemas; template loading,
  parsing, composition, and Markdown rendering; `namespace/name` convention;
  variable resolution and slot composition;
- `@atlante/validator`: document structural validation (references, required
  fields, types) and template-level validation (input schema compliance and
  composition acyclicity);
- `@atlante/resolver`: normalization, template composition, value
  resolution, and host-independent artifact descriptors;
- `@atlante/presets`: registry-derived preset loading and the bundled preset
  documents themselves;
- `@atlante/opencode-plugin`: OpenCode prompt materialization and the in-memory
  `atlante_skill` adapter tool; no skill execution runtime;
- `@atlante/cli`: validation, resolution, materialization, and
  `atlante init` entry point.

`@atlante/templates` and `@atlante/presets` are the two content packages and
MUST remain leaves of the dependency graph: neither depends on any other Atlante
package. `@atlante/presets` therefore loads and exposes presets but MUST NOT
validate or expand them. Validation of a preset MUST be performed by the
consuming validator as part of the uniform overlay-expansion path for the
document that uses it. Keeping both content packages dependency-free is what
allows third parties to distribute templates and presets without depending on
the core.

An adapter MUST receive resolved descriptors and MUST NOT contain a separate
execution branch for each renderer.

### 10.1 CLI JSON output

For `atlante resolve --json`, the CLI MUST emit exactly one JSON object to
standard output with exactly these top-level fields: `agents`, `skills`, and
`diagnostics`. The `agents` and `skills` fields contain the resolved artifact
arrays, and `diagnostics` contains the diagnostic array. The `--agent` option
filters only `agents`; it MUST NOT filter `skills`.

JSON-mode failures MUST also emit this envelope to standard output, with empty
`agents` and `skills` arrays and the reported diagnostics. JSON-mode diagnostics
MUST NOT be duplicated on standard error.

## 11. OpenCode Adapter Profile

The OpenCode adapter is the first host integration. Version 0.1 defines its
prompt materialization responsibilities and preset support. Runtime
execution and state management are outside this specification.

The adapter MUST treat the Atlante configuration as the only source of truth for
prompts. Users SHOULD not maintain a competing prompt in OpenCode agent
configuration.

### 11.1 Skill tool lifecycle

The OpenCode adapter performs one complete resolution during initialization.
After successful resolution and materialization it exposes an in-memory
`atlante_skill` tool for project-global skills. The tool input MUST be exactly an
object with one string field, `{ "name": "<skillId>" }`; the name is looked up
against the root `skills` map key. A successful known-name lookup returns only
the resolved Markdown `content`; the skill `description` is not returned by the
tool.

During preparation, the adapter is inactive and the tool is unavailable. If
overlay expansion, validation, or resolution fails during preparation, the
tool MUST be omitted and the host configuration MUST remain unchanged. After
the complete result is materialized, the tool is active. A failure after
materialization, including a runtime failure, MUST move the tool to the failed
lifecycle state. Unavailable, failed, malformed-input, and unknown-name
requests MUST return explicit errors and MUST NOT return partial skill content.
Skill content is not executed and does not carry runtime state.

The adapter MUST NOT write skill or agent files, create a skill cache, or
register Atlante skills as native OpenCode skills. The native OpenCode `skill`
tool MAY coexist with `atlante_skill`; neither tool replaces or intercepts the
other. The adapter MUST stage host config changes and commit no mutation when
resolution fails.

### 11.2 Preset inheritance

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
- `skills` merge by `skillId`; new IDs are added and existing IDs are
  recursively overridden.
- Objects merge recursively by key, scalars replace inherited values, arrays
  replace inherited arrays, and the local layer always takes precedence for
  skills exactly as it does for agents.
- `null` removes an inherited property, value entry, or agent binding.
- `null` also removes an inherited skill binding or skill property. Tombstones
  are consumed during expansion and MUST NOT reach the canonical resolved
  document.
- `extends` is consumed during expansion and MUST NOT be passed to a prompt
  template.

#### Validation and resolution

Every entry point that accepts a raw configuration overlay, including the CLI
and host adapters, MUST apply the same shared expansion path before validation
and resolution:

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
initialization target. The starter preset MUST provide at least an `architect`
agent and an `implement` agent.

## 12. Compatibility and Evolution

### 12.1 Version domains

Atlante uses separate version domains for separate contracts:

- **Document schema**: the project document's `$schema` URI identifies the
  versioned Atlante document contract. Released document schemas are immutable.
- **Template input schema**: each `template.json` MUST be valid JSON Schema Draft
  2020-12 and MUST declare that dialect with its own `$schema` property. This
  identifies the schema language, not a template release.
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

Template registries MUST assign IDs using the `namespace/name` convention. The
namespace is supplied by the registry and the name is derived from the template
directory; package versions MUST NOT become template IDs.

An implementation MUST reject a document whose `$schema` URI it does not
support. Version 0.1 does not define migrations.

Future versions MAY add:

- user-defined prompt templates and third-party template authoring;
- prompt extension namespaces;
- runtime tools and state;
- preset export, sharing, and remote registry;
- skill execution, runtime skill state, and remote skill loading.

These additions MUST preserve the distinction between Atlante-owned prompt
content (templates) and host-owned execution settings.

## 13. Acceptance Criteria

Version 0.1 is complete when a conforming implementation can:

1. validate minimal `atlante.jsonc` and `atlante.json` documents;
2. reject missing references and invalid template references;
3. validate template input schemas and their composition graph;
4. resolve global values and per-agent overrides into prompt definitions;
5. render a deterministic prompt from structured agent values using the selected
   template;
6. create a missing OpenCode agent with host defaults;
7. replace an existing agent prompt while preserving host-owned fields;
8. report a warning when a non-empty host prompt is replaced;
9. scaffold a project from the bundled `starter` preset via `atlante init`;
10. validate a skill with required description, default `atlante/skill`, and
    template-owned content;
11. interpolate skill descriptions and content with global and local values;
12. resolve skill template composition and reject missing references, cycles,
    invalid input, missing values, and other template failures;
13. apply preset skill inheritance, local precedence, and `null` tombstones;
14. expose the exact CLI `--json` envelope containing only `agents`, `skills`,
     and `diagnostics`, with JSON failures on stdout and no duplicate stderr
     diagnostics, while `--agent` filters only agents;
15. expose `atlante_skill` with the `{ "name": "<skillId>" }` lookup returning
     rendered Markdown content only, omit the tool on preparation failure, and
     use the failed lifecycle only after materialization/runtime failure;
16. initialize the tool once, commit staged host configuration atomically, and
    leave the host unchanged on failure;
17. allow native OpenCode `skill` coexistence without native skill
    registration; and
18. write no skill files, agent files, or skill cache during materialization.
