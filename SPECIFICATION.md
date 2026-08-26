# Atlante Specification

**Status:** Draft
**Version:** 0.1

This document defines the version 0.1 contract for Atlante configuration,
static content, deterministic artifacts, and host materialization.

Each section follows the same review shape:

1. **Goal** explains the purpose of the section.
2. **Contract** contains normative requirements.
3. **Examples** show representative valid data or behavior.
4. **Edge cases** defines boundary behavior.
5. **Rationale** explains the design decision.

The terms **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** are to
be interpreted as described by RFC 2119 and RFC 8174 when, and only when, they
appear in uppercase.

## 1. Scope

### Goal

Define the smallest provider-neutral contract for a structured coding-agent
harness.

### Contract

Version 0.1 defines:

- a JSONC configuration document for agents, skills, values, and presets;
- local and installed static packs containing presets and resources;
- template and instance semantics for prompt and skill content;
- deterministic resolution, validation, rendering, and artifact publication;
- an adapter boundary for materializing verified artifacts into a host; and
- an OpenCode profile for the first supported host adapter.

Version 0.1 MUST NOT define or imply:

- model selection, effort, permissions, tools, modes, or other host settings;
- JavaScript imports, executable pack hooks, or arbitrary project-code execution;
- package installation, registry lookup, URL loading, or remote content loading;
- LLM inference, direct agent execution, or skill execution;
- runtime workflow state, checkpoints, locks, or scheduling; or
- preset export, sharing, or a remote registry.

### Examples

An in-scope project contains `atlante.jsonc`, selects a static preset, validates
agent inputs, builds artifacts, and lets the OpenCode adapter load those
artifacts.

An out-of-scope project asks Atlante to choose a model or execute a skill. Those
operations belong to the host or the prompted model.

### Edge cases

Future capabilities MAY extend this design, but a version 0.1 document MUST NOT
depend on them or imply that they are available.

### Rationale

Keeping configuration, content, validation, and materialization separate makes
the source reproducible without turning Atlante into an execution runtime.

## 2. Conformance

### Goal

Make conformance testable through explicit requirements and stable boundaries.

### Contract

A conforming implementation MUST:

1. accept only documents that satisfy this specification;
2. reject invalid source structure before publishing artifacts;
3. reject invalid references, values, schemas, and template input;
4. produce deterministic results for the same source and selected content;
5. preserve the canonical document semantics in generated artifacts; and
6. fail closed when any required validation or publication step fails.

The serialized configuration format is JSONC. Strict JSON is a compatible
subset for `atlante.json`. Template input schemas MUST use JSON Schema Draft
2020-12. An implementation MAY use another validation library internally, but
that library's API MUST NOT become part of the configuration contract.

### Examples

The following is a conformance failure: a builder publishes one agent artifact
after another agent has failed template validation.

The following is conforming behavior: the builder publishes no new artifact
tree and reports the validation failure.

### Edge cases

An implementation MAY expose additional diagnostics or internal stages, but it
MUST preserve the ordering and fail-closed behavior defined here.

### Rationale

RFC-style requirements give reviewers and implementers one vocabulary for
distinguishing required behavior from guidance and examples.

## 3. Terminology

### Goal

Use one stable vocabulary for source documents, static content, and output.

### Contract

- **Configuration** is the primary public term for the authored system.
- **Document** is the authored or resolved `atlante.jsonc` or `atlante.json`
  data model. It is distinct from generated artifacts.
- **Pack** is a static content distribution.
- **Pack root** is the trusted filesystem boundary represented by a `ResourcePack`.
- **Resource** is an addressable directory inside a pack.
- **Template facet** is the `template.jsonc` and `template.md` pair in one
  resource directory.
- **Instance facet** is the `instance.jsonc` input in one resource directory.
- **Template** is the effective renderer and input contract supplied by a
  template facet.
- **Preset** is a root configuration document distributed as a starting point or
  inheritance layer.
- **Default preset** is the preset selected by `atlante init` when no preset is
  specified. It is distinct from first-party ownership.
- **First-party pack** describes Atlante ownership of static content. It is not
  synonymous with the default preset.
- **Artifact** is generated output under `.atlante/artifacts/`.
- **Adapter** is the host-specific component that consumes verified artifacts.
- **Host agent** is an agent identified and configured by the host.
- **Agent binding** associates a host-agent ID with a description and prompt
  definition.
- **Skill binding** associates a `skillId` with a description and skill input.
- **Value** is a string input substituted into authored descriptions or prompt
  definitions before rendering.
- **Template slot** is a `{ "template": "..." }` marker in a template input
  schema that composes another template.
- **Resource locator** is a containing-file-relative path or package locator.

Public documentation SHOULD use `template` and `instance` when the content type
is known. `Template facet` and `instance facet` remain technical terms for the
two typed aspects of one resource.

### Examples

The following vocabulary is consistent:

```text
pack
├── preset
└── resource
    ├── template facet
    └── instance facet
```

The first-party pack can contain the default preset, but ownership and default
selection remain separate properties.

### Edge cases

The terms `family`, `constellation`, `star`, and `PackItem` are metaphor or
discussion terms only. `star` and `constellation` originate in the Atlante
brand vocabulary; `family` and `PackItem` are early discussion terms recorded
as retired by [DESIGN.md](brand/DESIGN.md). They MUST NOT become schema fields,
package names, or implementation types.

### Rationale

The vocabulary separates the JSON Schema document/data model from static
content and generated output, preventing package and metaphor names from
becoming accidental protocol types.

## 4. Configuration Document

### Goal

Define the authored source document and its canonical resolved form.

### Contract

The canonical project configuration MUST be stored as exactly one of:

```text
atlante.jsonc
atlante.json
```

`atlante.jsonc` MAY contain comments and `atlante.json` MUST contain strict JSON.
Both files MUST validate against the same document schema and resolve to the
same canonical model. If both files exist and no explicit path was supplied,
the CLI MUST report an ambiguity rather than choose silently.

The document MUST contain `$schema` and MAY contain `extends`, `values`,
`agents`, and `skills`. Unknown top-level fields MUST be rejected. `extends`
MUST be one non-empty string or a non-empty ordered array of non-empty strings.
Missing `agents` and `skills` maps MUST normalize to empty collections.

Each agent and skill binding MUST have a non-empty `description` after
resolution. `$template`, `$instance`, `description`, and `values` are reserved
binding metadata. All other binding fields MUST be validated as input for the
effective template.

### Examples

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack", // first-party Atlante pack
  "values": {
    "project": "Atlante",
    "language": "TypeScript"
  },
  "agents": {
    "reviewer": {
      "$instance": "./resources/reviewer", // path relative to this document; a local project resource, not part of @atlante/pack
      "description": "Reviews changes for {{values.project}}.",
      "mission": "Check the implementation against repository conventions."
    }
  },
  "skills": {
    "testing": {
      "description": "Testing guidance for {{values.project}}.",
      "$template": "@atlante/pack/skill"
    }
  }
}
```

### Edge cases

Raw document validation MUST check shape without requiring referenced packs,
resources, or template schemas. Those checks belong to resolution and resolved
validation. A raw overlay MAY omit `agents` or `skills` when inherited content
will provide them.

### Rationale

Separating raw overlay input from the canonical resolved document allows preset
inheritance while keeping the published document strict and predictable.

## 5. Packs and Resolution

### Goal

Define trusted static content, source selection, and deterministic composition.

### Contract

A pack MUST have one trusted pack root. All resources, presets, and referenced
files MUST remain within that root. A package pack MUST contain a readable
`package.json` with numeric `atlante.format` equal to `1`:

```json
{
  "name": "@acme/review-pack",
  "version": "1.2.0",
  "atlante": { "format": 1 }
}
```

A resource is a directory beneath the root. It MAY contain either or both of:

```text
resource-directory/
  template.jsonc
  template.md
  instance.jsonc
```

The template facet is valid only when both template files are present. An
instance facet contains configured input and MUST resolve to exactly one
effective template.

Locators MUST be either containing-file-relative paths beginning with `./` or
`../`, or valid package locators of the form `<package-name>` or
`<package-name>/<subpath>`. Locators MUST NOT be absolute paths, URLs, NUL-
containing strings, backslash-separated paths, direct facet filenames, or paths
that escape the selected pack root after normalization and realpath checks.

Resolution MUST load only selected metadata, selected resources, and transitive
dependencies. It MUST NOT install packages, enumerate unrelated package
directories, load JavaScript, or consult a registry.

Source selection MUST support `$template`, `$instance`, and a bare resource
locator as `$instance` shorthand. `$template` and `$instance` MUST NOT occur
together. An instance without a selector MAY use its sibling template facet.

Preset inheritance and source overlays MUST resolve deterministically. A string
`extends` value is normalized to one ordered entry. Layers resolve their own
inheritance first and then merge left to right, followed by the local document.
Objects merge recursively, arrays replace, scalars replace, `null` removes an
inherited field, and local values always win.

### Examples

```jsonc
{
  "extends": ["@acme/base-pack", "@acme/review-pack/strict"],
  "agents": {
    "reviewer": "./resources/reviewer"
  }
}
```

The second preset sees the resolved first preset, and the local binding wins
over both inherited bindings.

### Edge cases

Symlinks MAY be used when their canonical target remains inside the selected
root. External symlinks MUST be rejected. Missing, ambiguous, malformed, or
escaping targets MUST fail resolution. Reusing one preset in multiple `extends`
positions is valid and MUST NOT produce a duplicate-contribution error.

### Rationale

Pack roots and lazy selection provide local reproducibility without scanning or
executing arbitrary installed content.

## 6. Prompt and Skill Templates

### Goal

Keep prompt and skill semantics in reusable templates rather than in the document
schema.

### Contract

A template facet MUST contain a Draft 2020-12 input schema and a Markdown
renderer. The document schema MUST NOT prescribe template-owned prompt fields,
sections, ordering, or content.

Templates MAY declare composition slots with `{ "template": "..." }`. Every
declared slot MUST resolve to an available template, including slots in schema
branches not selected by a particular input. Circular composition MUST be
rejected. Composed child Markdown MUST be preserved as opaque output and MUST
NOT be interpreted as parent template source.

Global and binding-local values MUST be strings. Local values override global
values by key for that binding. `{{values.key}}` references in descriptions and
prompt definitions MUST be replaced before rendering. Missing references MUST be
diagnosed. The values dictionary MUST NOT be passed to a template as an
undeclared input object.

A skill's `description` is lookup metadata. Skill content MUST be rendered as
Markdown and MUST NOT be executed by Atlante.

### Examples

```json
{
  "type": "object",
  "properties": {
    "mission": { "type": "string" },
    "steps": {
      "type": "array",
      "items": { "type": "string" }
    }
  },
  "required": ["mission"]
}
```

A binding can supply `mission` and `steps`; the template owns how those values
become Markdown prompt content.

### Edge cases

Only present slot values contribute output. Array order MUST be preserved.
Unsupported values, invalid schemas, missing slots, cycles, and missing value
references MUST fail before rendering.

### Rationale

Template-owned input keeps the document schema stable while allowing packs to
add structured prompt and skill composition.

## 7. Bindings

### Goal

Define how configured agents and skills map to host-facing identities.

### Contract

An agent binding associates one host-agent ID with one resolved description and
one prompt definition. The map key MUST remain the host-agent ID. Atlante MUST
NOT introduce a second logical ID for that binding.

An agent binding MAY select a template, select or derive an instance, or use the
configured default template. Binding metadata MUST NOT be passed as template
input. The effective template schema is authoritative for all remaining fields.

A skill binding MUST be keyed by a non-empty `skillId`, MUST contain a
non-empty description, and MUST resolve its content through a template. Skills
are not associated with host-agent IDs.

An effective template MAY include workflow or delegation instructions. Such a
role is template-defined; version 0.1 MUST NOT reserve a host-agent ID or add a
dedicated orchestrator field.

### Examples

```jsonc
{
  "agents": {
    "architect": "@atlante/pack/architect",
    "reviewer": {
      "description": "Reviews the project.",
      "$template": "@atlante/pack/agent",
      "mission": "Find defects before merge."
    }
  },
  "skills": {
    "testing": {
      "description": "Testing guidance.",
      "$template": "@atlante/pack/skill"
    }
  }
}
```

### Edge cases

An absent source uses the applicable configured default. A missing description,
empty ID, conflicting selectors, or input that fails the effective template
schema MUST fail validation.

### Rationale

Host IDs remain stable while packs control prompt structure and reusable skill
content.

## 8. Validation

### Goal

Make invalid source, resolved content, and template input fail before build.

### Contract

Every entry point accepting source configuration MUST apply these stages in order:

1. **Raw structural validation** parses JSON or JSONC and checks document shape,
   schema URI, container types, `extends` shape, and selector shape.
2. **Resource resolution** resolves selected presets, resources, instances,
   templates, package metadata, and transitive references.
3. **Resolved validation** checks the canonical document, values, selectors,
   composition, effective-template compatibility, and template-owned input.
4. **Build** renders only validated input and publishes the complete artifact tree.

Raw validation MUST NOT require a package or template schema. Resolution and
resolved validation MUST reject invalid locator grammar, missing targets,
malformed schemas, cycles, incompatible templates, missing values, unsupported
fields, and invalid input.

Diagnostics MUST identify a stable code, source, JSON Pointer when applicable,
one-based location when available, and a deterministic reference chain when a
reference graph caused the failure. Normal diagnostics MUST NOT serialize
machine-specific absolute paths.

The resource system MUST fail closed: any required failure MUST produce no usable
canonical document and no partial build output.

### Examples

```text
error [missing-target]: resource target does not exist
at: resources/reviewer
expected: a directory containing a valid instance or template
next: create the target or update the locator
```

### Edge cases

An unrelated malformed resource sibling MUST NOT invalidate a valid selected
resource. Diagnostics MUST sort deterministically by source, JSON Pointer,
location, and code.

### Rationale

Two validation stages preserve useful raw-overlay behavior without allowing
unresolved or invalid content to reach rendering.

## 9. Build and Artifacts

### Goal

Produce deterministic, host-independent output that adapters can verify locally.

### Contract

Building MUST accept only a document that passed resolution and validation. It
MUST render deterministic Markdown, MUST NOT execute agents, commands, or
arbitrary project code, and MUST publish no partial result.

The artifact tree MUST be published under `.atlante/artifacts/`. Its manifest
MUST be UTF-8 JSON containing only `format`, `version`, `agents`, and `skills`:

```json
{
  "format": "atlante-artifacts",
  "version": 1,
  "agents": [
    {
      "id": "reviewer",
      "description": "Built description",
      "path": "agents/reviewer-<id-sha256>-<content-sha256>.md",
      "sha256": "<64 lowercase hex characters>"
    }
  ],
  "skills": []
}
```

Each entry MUST have a non-empty ID, description, relative POSIX path, and
lowercase SHA-256 digest of the exact UTF-8 payload. Payload filenames MUST
contain an ASCII slug, the ID digest, and the content digest. Slug generation
MUST fold only ASCII uppercase letters, replace non-ASCII-alphanumeric runs with
hyphens, trim hyphens, and use `artifact` when empty. IDs, paths, entries, and
payloads MUST be unique.

Publication MUST prepare a complete private tree and replace the live tree by
atomic directory rename. A reader MUST observe a complete previous tree, a
complete new tree, or no usable tree, never a partial tree.

### Examples

For a valid agent binding, the builder emits one agent entry and one Markdown
payload. An empty `skills` map produces an empty `skills` array and is valid.

### Edge cases

Adapters MUST reject unknown manifest fields, unsafe paths, symlinks,
non-regular files, invalid UTF-8, missing payloads, duplicate entries, and
digest mismatches. Rendered values MAY be sensitive and SHOULD remain local.

### Rationale

Digest-addressed, host-neutral artifacts separate source configuration from host
state and make publication verifiable without executing source content.

## 10. Compatibility and Evolution

### Goal

Keep independent contracts versioned independently and prevent silent upgrades.

### Contract

The document `$schema` URI identifies the versioned configuration contract and
released schema URIs MUST be immutable. Template input schemas MUST declare JSON
Schema Draft 2020-12. Artifact `format` and numeric `version` identify the
artifact contract independently of the document schema.

An adapter MUST reject unsupported artifact formats, artifact versions, and
document schema URIs rather than guessing. Package versions are installation
metadata and MUST NOT become part of authored resource locators.

Local resource edits MAY take effect on the next build without changing the
document schema URI. A versioned or immutable resource distribution MUST define
its own version or digest mechanism.

Version 0.1 defines no migration format. Future versions MAY add runtime tools,
state, remote registries, preset sharing, or skill execution, but those features
MUST preserve the separation between Atlante-owned prompt content and host-owned
execution settings.

### Examples

An adapter that receives `format: "other-artifacts"` MUST reject it. A local
change to `template.md` does not require changing `atlante.jsonc`'s `$schema`.

### Edge cases

A document with an unsupported schema URI MUST fail even if its fields resemble a
known version. An artifact version MUST NOT be inferred from its directory name.

### Rationale

Independent version domains let documents, templates, packs, and artifacts evolve
without making one release boundary govern every other contract.

## 11. OpenCode Adapter Profile

### Goal

Define the first host adapter without making host behavior part of the document.

### Contract

The OpenCode adapter MUST consume only a complete verified artifact tree. It MUST:

- locate or create host agents by their configured IDs;
- write the rendered prompt and resolved description as Atlante-owned fields;
- preserve host-owned model, effort, permission, tool, and mode settings;
- report warnings when replacing a non-empty host prompt;
- avoid loading source configuration or source resources; and
- leave host configuration unchanged when verification or materialization fails.

Materialization MUST be atomic. Repeating materialization for the same valid
artifacts SHOULD produce the same host state and MUST NOT duplicate agents.

After verification and materialization, the adapter MAY expose an `atlante_skill`
tool. Its input MUST be exactly `{ "name": "<skillId>" }`, and a successful
lookup MUST return only the resolved Markdown content. Unknown names, malformed
input, unavailable artifacts, and failed lifecycle states MUST return explicit
errors without partial content.

### Examples

The host registers the OpenCode adapter through its supported integration
mechanism.

### Edge cases

If artifact discovery, verification, or injection fails, the adapter MUST remain
unavailable and MUST NOT mutate host configuration. Skill content is data and
MUST NOT be executed.

### Rationale

An artifact-only adapter keeps host integration narrow, preserves host ownership,
and prevents source loading or execution from crossing the boundary.

## 12. Acceptance Criteria

### Goal

Provide a compact conformance checklist for version 0.1 implementations.

### Contract

A conforming implementation MUST be able to:

1. validate minimal `atlante.jsonc` and `atlante.json` documents;
2. reject unsupported schemas, missing targets, invalid locators, and invalid
   template or instance references;
3. validate template input schemas and composition graphs;
4. resolve global values, local overrides, presets, and deterministic merges;
5. render deterministic agent prompts and Markdown skills;
6. build and atomically publish verified artifact manifests and payloads;
7. preserve host-owned settings while materializing an OpenCode agent;
8. report a warning when replacing a non-empty host prompt;
9. scaffold from the first-party `@atlante/pack` default preset through
   `atlante init` and rebuild through `atlante build`;
10. expose `atlante_skill` with the exact name lookup contract; and
11. leave the host unchanged whenever validation, verification, or materialization
    fails.

### Examples

The conformance checklist is satisfied when a minimal configuration can move from
source to validated artifacts and then to an unchanged-or-atomically-updated host.

### Edge cases

Implementations MAY provide additional commands and diagnostics, but those
extensions MUST NOT weaken any requirement or make excluded runtime capabilities
appear part of version 0.1.

### Rationale

The checklist turns the preceding contract into reviewable acceptance criteria
without prescribing internal package structure or implementation technique.
