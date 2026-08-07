# Atlante Specification

**Status:** Draft  
**Version:** 0.1  
**Implementation profile:** Prompt-first

This document adds the technical details and normative requirements for the
first Atlante specification.

## 1. Scope

Version 0.1 defines a provider-neutral configuration model for structured agent
prompts and Markdown skills. It defines a local-first resource system whose
template and instance facets own prompt and skill-content semantics, a
two-level validation model (document structure + template input schemas),
deterministic artifact building, and an OpenCode adapter that materializes built
prompts into host agent definitions and exposes built skills through the
`atlante_skill` adapter tool.

Version 0.1 includes:

- a minimal document structure (`$schema` plus optional `agents`, `values`, and
  `skills`);
- local resource locators and the temporary first-party `atlante/*` resource
  namespace;
- composable template facets with Markdown rendering and variable resolution;
- configured instance facets that select or derive an effective template;
- a template protocol for prompt rendering and validation;
- binding descriptions and global values with per-agent overrides, resolved into
  agent metadata and prompt definitions via
  `{{values.x}}`;
- skill bindings with descriptions and template-owned input rendered as Markdown;
- host-agent bindings whose prompt inputs are defined by templates;
- two-level validation (document structure + template input schema);
- deterministic prompt building;
- OpenCode prompt materialization and the `atlante_skill` lookup tool;
- the bundled `starter` preset (`atlante init`), addressed as
  `atlante/starter`;
- source-aware resource provenance, deterministic overlays, and fail-closed
  resource diagnostics.

Version 0.1 does not include:

- model selection, effort, permissions, or other host-agent configuration;
- package or plugin resource resolution;
- LLM inference or direct agent execution;
- skill execution, skill runtime state, and remote skill loading;
- preset export, sharing, or remote registry.

The public terms `module`, `$module`, and `module.jsonc` are not introduced.

The excluded runtime capabilities remain possible future extensions of the
design and must not be implied by the version 0.1 schema.

## 2. Conformance and Normative Language

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
normative.

An implementation conforms to version 0.1 if it:

1. accepts only documents that satisfy this specification;
2. rejects invalid authored structure before resolution and rejects invalid
   references, missing resolved values, and unsupported fields after resolution;
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
  description plus prompt definition.
- **Skill binding**: the association between a root `skills` map key and a
  description plus template-owned skill input. The map key is the binding's
  `skillId`.
- **Prompt definition**: the structured, user-authored values from which Atlante
  renders an agent system prompt; prompt sections are defined by the referenced
  template, not by the schema.
- **Orchestrator**: a host agent whose selected template includes workflow or
  delegation instructions and may coordinate other agents through host
  capabilities. Orchestration is a template-defined role; version 0.1 does not
  require an orchestrator, reserve a host-agent ID, or define a dedicated field.
- **Resource**: an addressable directory beneath a trusted resource-pack
  content root. A resource MAY provide a template facet, an instance facet, or
  both.
- **Template facet**: the pair `template.jsonc` and `template.md` in one
  resource directory. The JSONC file contains the Draft 2020-12 input schema;
  the Markdown file is the renderer source.
- **Instance facet**: `instance.jsonc` in one resource directory. It contains
  configured input for an effective template and MAY select or derive that
  template.
- **Template**: the effective renderer and input schema supplied by a template
  facet. Template semantics remain independent of the document schema.
- **Resource locator**: either a containing-file-relative path beginning with
  `./` or `../`, or a temporary built-in locator in the `atlante/*` namespace.
  A local locator has no global ID.
- **Resource origin**: stable source identity. Project origins use
  content-root-relative paths; bundled origins use `atlante/<resource>/<facet>`.
- **Template slot**: a location in a composable template's input schema declared
  as `{ "template": "..." }`, indicating that the slot expects the rendering
  of another template. This is a template-composition marker, not a root
  resource binding selector.
- **Preset**: a pre-configured root-level Atlante configuration bundled as a
  starting point for new projects. A preset is the optional `atlante.jsonc` or
  `atlante.json` root of a resource pack, not a renderer. The bundled starter
  root is selected by `atlante/starter`.
- **Extends**: an optional field at the document level that references
  a preset by a local resource locator or the temporary `atlante/*` namespace.
  When present, the referenced preset's configuration is loaded, expanded
  recursively, and merged with the local configuration using the resource
  merge contract. The local layer always takes precedence. `extends` is
  consumed during expansion and never reaches the resolved document or
  rendered prompt.
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

Configuration files are first parsed as raw overlay input for resource
resolution. A raw overlay MAY contain `extends`, source selectors, and MAY omit
`agents` or `skills`. During resolution, omission preserves inherited bindings
when present. After resolution, `extends` and source selectors are consumed and
the result MUST be a strict canonical document; the field restrictions below
apply to that canonical document, not to the raw overlay's resolution metadata.

When no explicit configuration path is provided, the CLI MUST discover either
root-level filename. If both files exist, the CLI MUST report an ambiguous
configuration and require an explicit path rather than choosing silently.

The document MUST contain `$schema` and MAY contain `values`, `agents`, and
`skills` maps. Missing `agents` and `skills` maps normalize to empty
collections. Its top-level shape is:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",

  // Global values — resolved into prompt definitions before rendering
  "values": {
    "project": "my-project",
    "language": "TypeScript",
  },

  // Agent bindings — host-agent-ID → a source and optional local overlay
  "agents": {
    "architect": "atlante/architect",
    "reviewer": {
      "$instance": "./resources/architect",
      "description": "Coordinates the project workflow.",
      "values": {
        "scope": "Workflow-agent-specific constraint.",
      },
      // Prompt fields are defined by the effective template's input schema.
      "mission": "Review changes against repository conventions.",
    },
  },

  // Skills — skillId → skill binding
  "skills": {
    "testing": {
      "description": "Testing guidance for {{values.project}}.",
      "$template": "./resources/skill",
      // Remaining fields are defined by the selected template.
    },
  },
}
```

The document MUST NOT contain fields other than `$schema`, `values`, and
optional `agents` and `skills`. Unknown top-level fields MUST be rejected.
When present, `skills` is an object whose non-empty keys are `skillId` values.
Each skill binding MUST contain a non-empty string `description`; an omitted
source defaults to the bundled `atlante/skill` template facet. `$template` and
`$instance` are mutually exclusive source selectors. `description`,
`$template`, `$instance`, and `values` are reserved binding metadata. Every
other skill field is template-owned input and MUST be validated against the
selected template's input schema. A bare resource locator is `$instance`
shorthand.

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
agent definition MAY contain a `values` object for local overrides. The builder
MUST merge local values over global values by key; a local value replaces the
global value with the same key for that agent only.

A preset value MAY use a `{{sys.<key>}}` reference to defer resolution to
runtime (see §11.1). System value references MUST be resolved during document
expansion, before `{{values.x}}` interpolation; this ensures that
`{{values.x}}` lookups never encounter unresolved system references. Unknown
`sys.<key>` keys MUST be diagnosed before rendering.

### 4.3 Agent map

When present, `agents` MUST be an object whose keys are host-agent IDs. A
host-agent ID is an opaque, non-empty string owned by the host adapter.

Each value is a binding with a required, non-empty string `description` after
resource resolution and a prompt definition. An agent MAY select a template
facet with `$template`, select or derive an instance with `$instance`, or use a
bare resource locator as `$instance` shorthand. When no selector is present,
the configured default template is used. `$template`, `$instance`, and `values`
are binding metadata and are not passed as template input. The selected
template's JSON Schema is authoritative for the prompt definition's fields and
value types. The document schema does not prescribe prompt field names,
ordering, or content.

The map key is the host-agent ID. Atlante MUST NOT define a second logical ID
for the same binding in version 0.1.

## 5. Canonical Model and Implementation Layers

The Atlante JSONC document is a declarative language for agent prompts. Its
contract is divided across four layers:

1. `@atlante/schema` defines the serializable document shape (`$schema`,
   optional `agents`, `values`, and `skills`) and publishes the versioned JSON
   Schema and corresponding TypeScript types; it does not define prompt or
   skill semantics;
2. `@atlante/resources` owns resource identities, safe local and bundled
   locators, facets, provenance, overlays, and the composition, interpolation,
   and Markdown-rendering engine for bundled source content;
3. `@atlante/validator` applies the raw document structural checks and the
   resolved canonical, semantic, and template-input checks, including
   reference validity and schema validation;
4. `@atlante/builder` orchestrates preparation and publication, passing
   resolved inputs to `@atlante/resources` and publishing host-independent
   artifact descriptors. It does not implement the resource engine.

Templates render prompt content; they do not define execution semantics or
schedule execution.

The public v1 language is the JSONC document itself.

### 5.1 Resource pack and facet layout

A resource pack owns one fixed, canonical realpath content root. A project pack
is rooted at the directory containing the discovered `atlante.jsonc` or
`atlante.json`. The bundled pack is rooted at the embedded
`@atlante/resources/bundled` directory. The root is captured before resolving
any child and is immutable for the lifetime of that pack.

Resources are directories beneath the selected root. A resource MAY contain
either facet or both facets:

```text
resource-directory/
  template.jsonc   # optional template facet schema
  template.md      # required with template.jsonc
  instance.jsonc   # optional instance facet input
```

The package-level `atlante.jsonc` or `atlante.json` at a pack root is an
optional preset root. The bundled pack MUST provide `atlante.jsonc` for the
starter preset. `atlante/starter` is the explicit temporary locator for that
root file; direct bundled child directories remain addressable as
`atlante/<child>`.

Resources do not acquire agent or skill IDs. Consuming `agents` and `skills`
map keys remain the host-facing IDs.

### 5.2 Source selection

The source selector at a root binding or instance boundary is one of:

- `$template`, selecting a template facet and starting with no inherited
  instance input;
- `$instance`, selecting a configured instance and inheriting its effective
  template; or
- a bare resource locator, which is shorthand for `$instance`.

`$template` and `$instance` MUST NOT occur together. An instance facet without a
selector uses its sibling template facet and is valid only when that sibling is
present. Every instance MUST have exactly one effective template after
resolution. A local overlay MAY add or replace fields after source selection.

Agents and skills remain root-only bindings and cannot be nested. Their
descriptions MUST remain required after resolution. At a root binding boundary,
`description` is binding metadata and is excluded from template input. In a
template-defined nested slot, a template-owned field named `description` is
ordinary child input and MUST be retained.

### 5.3 Locator grammar, roots, and security

General authored resource references MUST:

- begin with `./` or `../`;
- resolve relative to the file containing the reference, never the process
  current working directory;
- identify a directory rather than a facet file; and
- remain inside the immutable realpath content root of the selected pack.

`extends` targets a directory containing exactly one `atlante.jsonc` or
`atlante.json`. `$instance` targets a directory containing `instance.jsonc`.
`$template` targets a directory containing both `template.jsonc` and
`template.md`. Missing or ambiguous target files are errors.

Authored `../` segments are allowed when the normalized target remains inside
the selected root. Traversal MUST be rejected only when normalization or
realpath resolution would escape that root. Absolute paths, home-directory
paths, URLs, backslash separators, and realpath or symlink escapes MUST be
rejected. Symlinks resolving within the selected root MAY be used. A symlink to
an external target MUST be rejected. Resource resolution MUST NOT use npm,
`node_modules`, package-manager layout, or plugin lookup. A future external pack
MUST establish its own trusted content root rather than weakening this
containment rule.

### 5.4 Lazy loading

Resolution MUST load only the selected facet and its transitive dependencies.
It MUST NOT enumerate or parse unrelated resource siblings as a prerequisite
for selecting a resource. A malformed unrelated sibling therefore MUST NOT
affect a valid configuration. The resolver records selected source files and
unresolved target parent directories for watch reconciliation.

### 5.5 Provenance and normalized data

Every parsed and merged node retains a non-enumerable or otherwise separate
authoring origin. Project source identities use content-root-relative POSIX
paths. Bundled source identities use stable paths such as
`atlante/architect/instance.jsonc`; normal diagnostics MUST NOT expose
machine-specific absolute paths. Provenance MUST NOT be attached to normalized
template input where it could be observed by a renderer.

Resolution proceeds deterministically:

1. parse the selected source as JSONC and retain its authoring file;
2. resolve `$instance`, `$template`, or the context-supplied template;
3. merge inherited and local fields;
4. preserve origins for the winning value of every node;
5. resolve nested references from the file that authored each reference;
6. validate effective-template compatibility; and
7. strip selectors and binding metadata at the relevant boundary before input
   validation, interpolation, and rendering.

### 5.6 Merge contract

Root `extends`, instance derivation, and source overlays use one merge contract:

- objects merge recursively;
- arrays replace inherited arrays;
- scalars replace inherited scalars;
- `null` is a tombstone for an inherited field; and
- local fields always win.

Tombstones are consumed during resolution and MUST NOT reach canonical
template input or rendered output. Repeated resolution of the same sources
MUST produce isolated, deterministic normalized data.

### 5.7 Resource graph

The resolver models preset roots, instance facets, and template facets as typed
graph nodes (`PresetResourceGraphNode`, `InstanceResourceGraphNode`, and
`TemplateResourceGraphNode`). A `ResourceGraphChain` is a complete, ordered,
non-empty chain of those nodes. Cycles are detected across mixed node kinds
rather than only within one facet kind. A shared maximum of 32 reference hops
applies to all resource chains. Cycle, depth, and incompatible-template
diagnostics MUST carry the complete typed chain in deterministic order.

A nested configured instance is compatible with a template slot only when its
effective template has the exact same canonical template locator required by
that slot. Structural schema similarity is not sufficient. Inline slot objects
remain template-owned input and are validated by the selected slot template.

### 5.8 Resource diagnostics and failure behavior

Resource failures are structured with a stable error code, source identity when
available, authored locator when needed, JSON Pointer, and one-based authoring
location. Error families cover invalid locator grammar, missing or wrong target
types, missing or ambiguous facets, malformed JSONC, invalid template schemas,
conflicting selectors, absent effective templates, unsafe paths, cycles, depth
exhaustion, incompatible nested templates, and invalid resolved instance input.

Diagnostics MUST sort deterministically by source, JSON Pointer, location, and
code. Normal formatting MUST use stable project-relative or bundled identities,
not machine-specific absolute paths.

The resource system is globally fail-closed. Any resource, resolution, or
semantic validation error yields no usable normalized document. Preparation
returns no partial agent or skill descriptors, and a failed build MUST preserve
the last complete artifact tree. CLI commands report failure. The OpenCode
adapter continues to consume only a complete verified artifact set and never
loads source resources.

### 5.9 Watch contract

Watch mode MUST use the selected resource dependency set and unresolved target
parent directories as its watch inputs. It MUST exclude unrelated resource
siblings. After a rebuild, it reconciles the dependency set so newly resolved
transitive resources replace stale candidates. A resource failure is reported,
but watch mode continues monitoring known sources and unresolved parent
directories for recovery.

## 6. Prompt Definition and Template System

### 6.1 Template model

In version 0.1, prompt semantics are entirely defined by effective template
facets. The schema does not prescribe prompt sections, ordering, or content.
Template facets are composable Markdown renderers with typed input schemas.

Each template facet consists of:

- `template.jsonc` — the JSON Schema Draft 2020-12 object that validates the
  template's inputs and MAY use standard annotations such as `title` and
  `description`;
- `template.md` — the Markdown renderer that produces prompt text from validated
  inputs.

The containing resource directory supplies the local identity. A bundled
resource is addressable through the temporary `atlante/*` namespace. A template
facet does not serialize a second ID.

### 6.2 Template naming

Bundled resource locators follow the `atlante/<resource>` convention:

- `atlante/` — bundled resources shipped with Atlante;
- local resources use containing-file-relative paths; and
- other package or plugin namespaces are out of scope for version 0.1.

Here, `atlante/` is only a namespace prefix. A concrete built-in resource
locator requires a non-empty direct-child resource name, such as
`atlante/starter`.

The specification does not enumerate bundled templates or prescribe their prompt
content. The bundled resource pack and its facet files are authoritative for
the first-party resources it provides.

### 6.3 Template composition

Composable templates MAY declare slot references directly in `template.jsonc`.
A declared slot is an object containing a `template` property whose value is a
template-composition reference. Slots MAY be nested within object properties,
array item schemas, and declared schema branches such as `oneOf`. The `template`
property in this schema marker is not a root binding selector; root bindings
use `$template` or `$instance`.

Every declared slot reference MUST identify an available template, including
references in branches not selected by a particular input. Circular composition,
invalid slot declarations or schemas, and input that does not satisfy the
composed template schemas MUST be rejected before rendering. An absent optional
slot contributes no output.

Composed output MUST preserve the order of array input. Only slot values present
in the validated input contribute output. Child Markdown is opaque output: it
MUST be preserved verbatim and MUST NOT be interpreted as parent template
source. Resolution MUST produce deterministic output for the same valid input.

### 6.4 Variable resolution

Values are resolved into binding metadata and the prompt definition before
rendering, not exposed to templates. The `@atlante/resources` engine MUST merge
global and per-agent values, then MUST replace every `{{values.key}}` reference
appearing in the agent's `description` and prompt definition with the resolved
value, before the selected template is rendered. Per-agent overrides take
precedence over global values for that agent, using the key-by-key merge defined
in §4.2.

A template MUST NOT receive the `values` dictionary. A template's input contract
is its `template.jsonc` schema and nothing else: because `values` is a free-form,
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

The selected template facet receives the agent's prompt definition and renders the
complete system prompt. The agent's `description` is resolved separately as
binding metadata and is not template input. The template's `template.jsonc`
defines the accepted fields. Rendering order and optional content are template
implementation concerns and are not part of the document schema.

A template MAY include workflow or delegation instructions that cause its bound
agent to serve as an orchestrator. The role is determined by the selected
template and its inputs, not by a reserved host-agent ID or schema field. The
specification does not require every configuration to define an orchestrator.

The bundled `atlante/workflow` template defines a sequential workflow. It has a
`phases` array; each phase requires a non-empty `instructions` array of
non-empty strings and a non-empty `name` unless it declares a `plan`, `build`,
or `review` `kind`, which then serves as the phase name. A phase may include a
non-empty `description`, `subagent`, phase `policies`, `output`, or inline
string `validation`. Workflow-level `policies`
may mark the orchestrator read-only. Phase policies may enable per-task commits
or reviews and may set `maxLoops` to a positive integer correction-loop limit.
All kinds and policies are optional; omission preserves a generic workflow,
policy objects reject unknown fields, and active policies render as a
consolidated `Policies` section.

A phase that includes `subagent` delegates the entire phase to the named
configured or delegable agent. When `subagent` is omitted, the orchestrator
handles the phase. A phase `output` is the aggregate artifact for the phase and
may be marked `updateable`, in which case rendering identifies it as a living
artifact that later phases may revisit before looping back. A phase `validation`
is its final quality gate.

Phase instructions execute sequentially in their containing phase as an ordered
Markdown list. They are inline strings rather than task objects, and the
workflow template does not compose the reusable `atlante/instructions` template
inside a phase.

Host agent files MUST NOT contain an independent prompt that competes with the
Atlante prompt; the Atlante configuration is the prompt source of truth.

### 6.6 Skill content rendering

The bundled `atlante/skill` template accepts structured, template-owned input
and renders it as Markdown without executing it. A skill's `description` is
resolved separately as binding metadata and listed in the tool description for
discovery; successful `atlante_skill` execution returns only rendered Markdown
content. The description is not template input. Skill content and skill
execution are distinct contracts: version 0.1 defines content validation,
interpolation, rendering, and lookup only, not execution, scheduling, runtime
state, or remote loading.

## 7. Agent Bindings

An agent binding associates one existing or materialized host agent with one
canonical description and prompt definition. The prompt definition's fields are
defined by the referenced template and its input schema.

The adapter:

- MUST use the map key as the host-agent ID;
- MUST consume the rendered prompt and resolved description from the published
  artifact;
- MUST NOT change host-owned model, effort, permission, or tool settings;
- MUST create a host agent definition when the host agent does not exist, using
  host-specific defaults for fields outside the Atlante schema;
- MUST replace the host agent's prompt with the rendered Atlante prompt;
- MUST replace the host agent's description with the resolved Atlante description;
- SHOULD emit a warning when replacing a non-empty existing host prompt.

The exact warning channel and host-specific file format are adapter concerns.
The default adapter SHOULD report warnings through builder, CLI, or plugin
diagnostics rather than creating an additional warning file.

### 7.1 Skill bindings

When present, `skills` MUST be an object keyed by non-empty `skillId` strings.
Each skill binding MUST contain a non-empty `description`; the description is
metadata for lookup and is not passed to the template. `$template` selects the
skill content renderer, `$instance` selects a configured instance, and an
omitted source defaults to the bundled `atlante/skill` template. `values`
contains local value overrides. Every other field is template-owned input.
Skills are not associated with a host-agent ID.

Defining or resolving a skill MUST NOT execute its content. The OpenCode adapter
exposes resolved skill content through `atlante_skill`.

## 8. Validation

Validation, resource resolution, and building are an ordered pipeline. Every
entry point that accepts source configuration MUST execute these stages in this
order:

1. **Raw document structural validation** parses the JSON or JSONC overlay and
   checks its document shape, supported schema URI, container types, and the
   shape of authored source selectors. It does not require a referenced
   resource, inspect a template schema, or validate template-owned input.
2. **Resource resolution** uses `@atlante/resources` to resolve the selected
   preset, instance, and template graph, load only selected facets, merge the
   source layers, and produce a canonical candidate. Resource graph failures
   fail this stage and retain their typed chain.
3. **Resolved canonical, semantic, and template validation** validates the
   canonical candidate, value references, effective-template compatibility,
   composition semantics, and template-owned input against the resolved
   schemas. The validator obtains any interpolated inputs from the resources
   engine rather than implementing interpolation itself. No build or
   publication may start until this stage succeeds.
4. **Build** is the builder orchestration stage. It asks the resources engine
   to render the validated, interpolated inputs, then prepares and publishes the
   complete artifact tree.

Validation therefore operates at two levels, but the raw structural level and
the resolved semantic/template level occur on the respective sides of resource
resolution; the old rule that all validation precedes resolution is not valid.

### 8.1 Document-level validation

A document-level validator MUST report diagnostics with a document path whenever
possible. Raw structural validation reports overlay shape errors in stage 1;
the checks below that depend on inherited fields or selected resources run
against the resolved canonical document in stage 3.

The validator MUST reject:

- invalid JSON or an unsupported `$schema` URI;
- a present `values` field that is not an object;
- a present `agents` field that is not an object, an empty agent ID, or a
  resolved agent binding without a non-empty string `description`;
- a present `skills` field that is not an object, an empty skill ID, or a skill
  binding without a non-empty string `description` after resource resolution;
- unknown top-level fields;
- unknown or invalid prompt inputs as defined by the selected template's
  input schema;
- unsupported or unknown fields within version 0.1 entities.

For every agent and skill, validation MUST use paths rooted at
`/agents/<agentId>` or `/skills/<skillId>`. It MUST interpolate `description`
through the resources engine with the same resolved global-plus-local values
used by the template input, reject missing or invalid value references, and
reject a description that is empty after interpolation. The reserved fields
`description`, `$template`,
`$instance`, and `values` MUST be removed from the input presented to the
selected agent or skill template; all remaining fields are template-owned input.
Agent-specific
diagnostics MUST retain the `agent` subject and `/agents/<agentId>` path; skill
diagnostics MUST retain the `skill` subject and `/skills/<skillId>` path.

### 8.2 Template-level validation

Template validation operates in stage 3 on each resolved direct input schema and
its composition graph.

The validator MUST reject:

- templates whose `template.jsonc` is missing, malformed, or does not declare
  JSON Schema Draft 2020-12;
- templates whose `template.jsonc` is not a valid input schema;
- template slot references (`{ "template": "..." }`) that point to
  non-existent templates;
- circular template composition (template A includes B which includes A);
- input values that do not satisfy a template's input schema.

The same template and composition failures apply to agents and skills: unknown
default or explicit templates, missing slot references, circular composition,
malformed or invalid Draft 2020-12 input schemas, invalid template input,
unsupported value references, missing values, value-reference collisions, and
unknown system values MUST fail validation with diagnostics at the relevant
entity JSON Pointer.

Validation SHOULD also detect statically incompatible values where a future
runtime feature would consume them.

### 8.3 Template distribution

The bundled resource pack MAY distribute first-party templates and instances. A
validator MUST validate configurations against the input schemas of selected
template facets. Required resources MUST be available without network access
during validation and resolution.

## 9. Build and Materialization

Building transforms the validated canonical document into host-independent
artifact descriptors. Building MUST be deterministic and MUST NOT execute
agents, commands, or arbitrary project code. The builder is an orchestration
boundary: resource selection, composition, interpolation, and rendering are
delegated to `@atlante/resources`, not reimplemented in the builder.

The builder MUST:

1. accept only a document that has passed raw structural validation, resource
   resolution, and resolved canonical/semantic/template validation;
2. pass the resolved and interpolated template inputs to the resource engine for
   rendering;
3. produce one agent artifact descriptor per binding; and
4. preserve host-agent IDs and resolved descriptions in every descriptor.

For skills, the builder MUST:

1. pass the resolved explicit `$template` or `$instance` source, or the default
   bundled `atlante/skill` template facet, to the resource engine;
2. pass the resolved and interpolated skill inputs from the resource engine to
   its renderer;
3. produce one resolved descriptor per binding containing `skillId`, the
   effective template identity, `description`, and rendered Markdown `content`.

Build preparation MUST contain `agents`, `skills`, and `diagnostics`. Building is
globally fail-closed: if any agent or skill validation, value interpolation,
composition, or rendering fails, it MUST return no partial agent or skill
descriptors and MUST report diagnostics. An empty `skills` collection is a
successful result when the document contains no skills.

Materialization is performed by an adapter from the published artifact set. The
OpenCode adapter MUST:

- locate an existing host agent by its configured ID;
- create a missing host agent using OpenCode defaults where necessary;
- write the rendered Atlante prompt and resolved description as Atlante-owned
  agent fields;
- preserve host-owned configuration fields;
- report prompt replacement warnings;
- avoid executing the agent or any command.

Materialization MUST be atomic. A failure MUST leave the host configuration
unchanged; no partial agent injection or partial skill availability is
permitted.

Repeated materialization from the same valid document SHOULD produce the same
host artifacts and MUST NOT duplicate agents.

### 9.1 Artifact format and publication

The builder MUST publish a host-independent artifact tree under
`.atlante/artifacts/`. The artifact contract is separate from the document
schema contract: the document `$schema` URI identifies the configuration schema,
while the artifact manifest's `format` and numeric `version` identify the build
output format. Version 0.1 defines:

```json
{
  "format": "atlante-artifacts",
  "version": 1,
  "agents": [
    {
      "id": "reviewer",
      "description": "Built description",
      "path": "agents/<ascii-slug>-<id-sha256>-<content-sha256>.md",
      "sha256": "<64 lowercase hex characters>"
    }
  ],
  "skills": []
}
```

The manifest MUST be UTF-8 JSON and MUST contain only `format`, `version`,
`agents`, and `skills`. Each entry MUST contain a non-empty `id`, a
`description`, a relative POSIX `path` in its declared namespace, and the
lowercase SHA-256 digest of the exact UTF-8 Markdown payload at that path. The
payload filename MUST have the form
`<ascii-slug>-<id-sha256>-<content-sha256>.md`. To form `<ascii-slug>`, an
implementation MUST fold only ASCII `A` through `Z` to lowercase, replace each
maximal run outside ASCII `[a-z0-9]` with one hyphen, trim outer hyphens, keep
at most the first 48 characters, and trim a trailing hyphen again. If no
characters remain, it MUST use `artifact`. The algorithm MUST NOT apply Unicode
normalization, transliteration, or Unicode case folding. The ID digest MUST be
the lowercase SHA-256 digest of the original ID's UTF-8 bytes, and the content
digest MUST be the lowercase SHA-256 digest of the exact payload bytes. The
filename component MUST be at most 181 ASCII bytes. The slug is a display hint;
the ID digest distinguishes IDs with the same slug. IDs, paths, manifest
entries, and payloads MUST be unique.

An adapter MUST verify the format and version, reject unknown fields, unsafe
paths, symlinks, non-regular files, invalid UTF-8, missing payloads, duplicate
entries, and digest mismatches before returning any descriptors. Verification
provides local integrity checking, not a privilege or trust boundary. Rendered
values MAY contain sensitive data; implementations SHOULD keep the artifact
tree local, ignore it in source control, and MUST NOT publish its payloads as a
package or registry artifact.

Publication MUST prepare the complete tree privately and then replace the live
artifact directory atomically by directory rename. A reader MUST observe a
complete previous tree, a complete new tree, or no usable tree, never a partial
tree. A failed pre-publication replacement MUST preserve the previous complete
tree when possible.

## 10. Package Boundaries

The version 0.1 implementation MUST preserve these package responsibilities:

- `@atlante/schema`: document structure contract (`$schema`, `values`, binding
  descriptions, and optional `agents` and `skills`), versioned JSON Schema, and
  TypeScript types;
  no prompt or skill-content semantics, no template logic, no host or rendering
  logic;
- `@atlante/resources`: resource identities and locators; template and instance
  facets; preset roots; safe lazy loading; provenance-aware merge and graph
  traversal; the template composition, variable interpolation, Markdown
  rendering engine; and bundled source content;
- `@atlante/validator`: document structural validation (references, required
  fields, types) and template-level validation (input schema compliance and
  composition acyclicity);
- `@atlante/builder`: preparation orchestration and host-independent artifact
  publication. It delegates resource loading, composition, interpolation, and
  rendering to `@atlante/resources`;
- `@atlante/opencode-plugin`: OpenCode prompt materialization and skill lookup;
- `@atlante/cli`: validation, artifact building, and the `atlante init` entry
  point.

`@atlante/resources` is a private workspace package and MUST NOT be published
as an npm package in version 0.1. It MUST remain independent of
`@atlante/schema`, `@atlante/validator`, `@atlante/builder`, and the former
content packages. Later consumers may depend on resources, but resources MUST
NOT depend upward into validation, building, or host integration. Package and
plugin resolution are not part of this boundary.

Resource loading and preset validation are separate responsibilities:
`@atlante/resources` loads selected source content, runs its resource engine,
and reports typed failures; the consuming validator validates the resulting
canonical document and template input. No resource loader may eagerly validate
or parse unrelated siblings.

An adapter MUST consume verified artifact descriptors and MUST NOT contain a
separate execution branch for each renderer.

## 11. OpenCode Adapter Profile

The OpenCode adapter is the first host integration. Version 0.1 defines its
prompt materialization responsibilities and preset support. Runtime
execution and state management are outside this specification.

The builder treats the Atlante configuration as the source of truth for prompts;
the adapter treats the verified artifact tree as its only input. Users SHOULD
not maintain a competing prompt in OpenCode agent configuration.

### 11.1 Skill lookup

After successful artifact verification and materialization, the OpenCode adapter exposes
an `atlante_skill` tool for skill lookups. The tool input MUST be exactly
an object with one string field, `{ "name": "<skillId>" }`; the name is looked
up against the root `skills` map key. A successful known-name lookup returns
only the resolved Markdown `content`; the skill `description` is not returned
by the tool.

If artifact discovery or verification fails, `atlante_skill` MUST be unavailable
and the host configuration MUST remain unchanged. Malformed input and unknown
names MUST return explicit errors without partial skill content.
Skill content is returned as data and is not executed.

### 11.2 Preset inheritance

`atlante init` scaffolds a project configuration that extends a bundled preset
via the `extends` field and builds the initial artifact tree before reporting
success. The generated configuration carries only the document
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
preset locator. The `extends` field accepts a local resource locator or a
temporary `atlante/*` locator such as `atlante/starter`.

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
- `extends`, `$template`, and `$instance` are consumed during expansion and
  MUST NOT be passed to a prompt template.

#### Validation and resolution

Every entry point that accepts a raw configuration overlay, including the CLI
and builder, MUST apply the same ordered pipeline before publication. Host
adapters consume published artifacts and do not accept or expand source
configuration:

1. Run raw document structural validation on the local overlay.
2. Resolve and recursively expand referenced presets and facets through
   `@atlante/resources`, detecting mixed resource cycles and depth exhaustion.
3. Merge inherited and local layers according to the resource merge contract and
   produce a canonical document without `extends`, source selectors, or
   tombstones.
4. Run resolved canonical, semantic, and template validation against that
   canonical document.
5. Ask the resource engine to interpolate and render, then publish the complete
   artifact tree.

Diagnostics MUST identify the local JSON Pointer and typed resource chain for at
least:

- missing or invalid resource locators;
- mixed resource cycles; and
- depth limits exceeded.

The validator MUST consume resources through the resource seam and MUST NOT
duplicate bundled-content loading or weaken the pack containment rules. Package
and plugin resource locators are not supported by this version.

Version 0.1 MUST include the `atlante/starter` preset as the default
initialization target. The starter preset MUST provide at least an `architect`
agent and an `implement` agent.

After changing the source configuration, users MUST run `atlante build` before
the host adapter can observe the change. The adapter consumes the published
artifact tree and MUST NOT load or render the source configuration itself.

## 12. Compatibility and Evolution

### 12.1 Version domains

Atlante uses separate version domains for separate contracts:

- **Document schema**: the project document's `$schema` URI identifies the
  versioned Atlante document contract. Released document schemas are immutable.
- **Template input schema**: each `template.jsonc` MUST be valid JSON Schema Draft
  2020-12 and MUST declare that dialect with its own `$schema` property. This
  identifies the schema language, not a template release.
- **Resource content**: local facets are selected by containing-file-relative
  locators and bundled facets by the temporary `atlante/*` namespace. A
  canonical source origin and the selected facet identity MUST be retained for
  deterministic diagnostics and provenance. Package versions MUST NOT become
  serialized resource locators.
- **Artifact format**: the `format` and numeric `version` in
  `.atlante/artifacts/manifest.json` identify the host-neutral build-output
  contract. Artifact format versions are independent of document schema
  versions and package releases; an adapter MUST reject unsupported artifact
  formats or versions rather than guessing.

For an immutable or versioned resource distribution contract, template
implementation changes MUST NOT silently change the behavior selected by an
existing reproducible configuration; that contract MUST require its defined
version or digest mechanism when a template schema or rendered output changes.
Version 0.1 defines no version or digest requirement for local mutable
resources. A local resource is reproducible when the selected source bytes,
inputs, and implementation are unchanged, and a local edit takes effect on the
next build without undeclared serialized metadata. Such a change MUST NOT
require a new document schema URI unless the document contract itself changes.

Local resources MUST NOT acquire global IDs. Bundled resources MUST use the
temporary `atlante/<resource>` locator convention. The containing directory and
facet identity, rather than a registry-assigned name, determine source identity.

An implementation MUST reject a document whose `$schema` URI it does not
support. Version 0.1 does not define migrations.

Future versions MAY add:

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
4. resolve global values and per-agent overrides into agent descriptions and
   prompt definitions;
5. render a deterministic prompt from structured agent values using the selected
   template;
6. create a missing OpenCode agent with host defaults;
7. replace an existing agent prompt and description while preserving host-owned
   fields;
8. report a warning when a non-empty host prompt is replaced;
9. scaffold a project from the bundled `starter` preset via `atlante init`,
   automatically build its artifact tree, and rebuild it via `atlante build`;
10. validate a skill with required description, default `atlante/skill`, and
     template-owned input;
11. interpolate skill descriptions and input with global and local values;
12. resolve skill template composition and reject missing references, cycles,
    invalid input, missing values, and other template failures;
13. apply preset skill inheritance, local precedence, and `null` tombstones;
14. publish the versioned `atlante-artifacts` manifest with verified payload
      paths and SHA-256 digests, and reject malformed or mismatched artifacts
      before host materialization;
15. expose `atlante_skill` with the `{ "name": "<skillId>" }` lookup returning
    rendered Markdown content only and make it unavailable when preparation
    fails; and
16. materialize atomically and leave the host unchanged on failure.
