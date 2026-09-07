# Atlante Specification

**Status:** Draft
**Version:** 0.1

This document defines the version 0.1 contract for Atlante configuration,
static content, deterministic rendering, and host-native materialization.

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
- deterministic resolution, validation, and rendering of an in-memory prepared
  project;
- build-time materialization of the prepared project into host-native files
  through injected host materializers;
- an OpenCode materializer profile for the first supported host; and
- an optional eval contract that validates an `eval` configuration section and
  versioned scenario documents, delegates scenario execution to the declared
  host runner in a disposable sandbox, and grades deterministic zero-LLM
  checks (section 12).

Version 0.1 MUST NOT define or imply:

- model selection, effort, permissions, tools, modes, or other host settings;
- JavaScript imports, executable pack hooks, or arbitrary project-code execution;
- package installation, registry lookup, URL loading, or remote content loading;
- LLM inference, or direct agent or skill execution, performed by Atlante
  itself rather than delegated to the declared host;
- runtime workflow state, checkpoints, locks, or scheduling; or
- preset export, sharing, or a remote registry.

### Examples

An in-scope project contains `atlante.jsonc`, selects a static preset, validates
agent inputs, and materializes OpenCode-native agent and skill files through a
build.

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
2. reject invalid source structure before materializing any host output;
3. reject invalid references, values, schemas, and template input;
4. produce deterministic results for the same source and selected content;
5. preserve the canonical document semantics in generated native files; and
6. fail closed when any required validation or materialization step fails.

The serialized configuration format is JSONC. Strict JSON is a compatible
subset for `atlante.json`. Template input schemas MUST use JSON Schema Draft
2020-12. An implementation MAY use another validation library internally, but
that library's API MUST NOT become part of the configuration contract.

### Examples

The following is a conformance failure: a builder materializes one agent after
another agent has failed template validation.

The following is conforming behavior: the builder materializes no host files
and reports the validation failure.

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
  data model. It is distinct from generated output.
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
- **Prepared project** is the complete in-memory set of rendered agent and
  skill descriptors a validated build produces.
- **Host materialization** is the publication of a prepared project as
  host-native files.
- **Native output set** is the deterministic set of host-native files, and
  their bytes, that one prepared project materializes.
- **Ownership manifest** is the Atlante-owned record of generated native
  files, their IDs, paths, and SHA-256 digests. It is bookkeeping state and
  never stores payload content.
- **Materializer** is the host-specific component that materializes a
  prepared project.
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

The terms `Star`, `Constellation`, `Family`, and `celestial sphere` are
explanatory brand vocabulary only. A Star is a named input, instruction,
constraint, value, or policy. A Constellation is one configured agent. A Family
is one complete harness containing related constellations, skills, workflows,
values, and supporting configuration. The celestial sphere is the broader
ecosystem of independently authored harness families. Almanac remains a
possible future registry and is not shipped. These metaphors MUST NOT become
schema fields, package names, implementation types, or other code identifiers.
`PackItem` remains a retired early discussion term.

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
`agents`, `skills`, and `eval`. The `eval` section configures the optional
eval command and is validated against its own schema (section 12). Unknown
top-level fields MUST be rejected. `extends`
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
4. **Build** renders only validated input into a prepared project and
   materializes the complete native output set.

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

## 9. Build and Materialization

### Goal

Render a validated document into a deterministic prepared project and
materialize it as host-native files.

### Contract

Building MUST accept only a document that passed resolution and validation. It
MUST render deterministic Markdown into an in-memory prepared project, MUST
NOT execute agents, commands, or arbitrary project code, and MUST materialize
no partial result.

The document MAY declare a `hosts` field. Version 0.1 admits only `"opencode"`
as a host target; a `hosts` array MUST be non-empty and MUST NOT contain
duplicates, and the canonical document defaults to `["opencode"]` when the
field is absent. For each declared host, the build MUST select a registered
host materializer or fail with an `unsupported-host` diagnostic. The
materializer receives the prepared project as data and MUST NOT load source
configuration, resolve resources, or import the builder.

Materialization MUST be deterministic and planned completely before any
filesystem mutation. For the OpenCode host it MUST publish exactly:

```text
.opencode/agents/<id>.md
.opencode/skills/<id>/SKILL.md
.atlante/opencode-native.json
```

Agent IDs and skill IDs MUST be lowercase kebab-case ASCII of at most 64
characters. Materialization MUST NOT rename an ID; an ID that violates this
grammar MUST fail the build.

Each agent file MUST contain a YAML frontmatter description followed by the
rendered prompt. Each skill file MUST contain YAML frontmatter name and
description followed by the rendered skill content.

The ownership manifest MUST be UTF-8 JSON containing only `format`, `version`,
and `files`:

```json
{
  "format": "atlante-opencode-native",
  "version": 1,
  "files": [
    {
      "kind": "agent",
      "id": "reviewer",
      "path": ".opencode/agents/reviewer.md",
      "sha256": "<64 lowercase hex characters>"
    }
  ]
}
```

Each entry MUST have kind `agent` or `skill`, a native ID, the exact native
path derived from that kind and ID, and a lowercase SHA-256 digest of the
exact UTF-8 bytes of the file it describes. IDs and paths MUST be unique
within the manifest. The manifest is bookkeeping state: it MUST NOT contain
prompt or skill payload content, and materialization MUST write it last.

Publication MUST satisfy these invariants:

- An existing file at a target path that the ownership manifest does not
  account for MUST NOT be overwritten; the build fails closed with a repair
  action.
- An owned target whose current bytes no longer match its recorded digest
  MUST NOT be replaced or removed; drift is reported with an intentional
  repair path.
- A previously generated file the prepared project no longer produces MUST be
  removed only when its bytes still match the manifest digest.
- Writes MUST be staged and published file by file, each by an atomic rename,
  with the manifest written last. A failed publication MUST roll back to the
  previous valid generated set. Whole-tree atomicity across host directories
  is not assumed.
- Repeating materialization for an unchanged prepared project SHOULD write
  nothing.

### Examples

A build of a document with one agent and one skill materializes two native
files, removes generated files the document no longer declares, and rewrites
the ownership manifest only when its bytes would change. A document with empty
`agents` and `skills` maps materializes only the manifest and is valid.

### Edge cases

Materialization MUST reject a symlinked project root, symlinked parent
directories, and symlinked targets. Rendered values MAY be sensitive and
SHOULD remain local; the ignore-by-default policy of `atlante init` keeps
generated native files and the manifest out of version control.

### Rationale

An in-memory prepared project and host-native materialization separate source
configuration from host state without a duplicate payload tree, and
manifest-gated updates make every change to generated files intentional and
verifiable.

## 10. Compatibility and Evolution

### Goal

Keep independent contracts versioned independently and prevent silent upgrades.

### Contract

The document `$schema` URI identifies the versioned configuration contract and
released schema URIs MUST be immutable. Template input schemas MUST declare JSON
Schema Draft 2020-12. Ownership-manifest `format` and numeric `version` identify
the materialization contract independently of the document schema.

The specification version identifies the contract revision. Released document
and eval-scenario schema URIs MUST carry that version as their version segment,
and an implementation MUST accept or reject whole specification versions rather
than blending them. Package versions of an implementation are release metadata
for the tool itself: they MUST NOT imply a specification version. A package
MUST increment its major version when it removes support for a specification
version it previously supported; adding support for a new specification version
MAY ship in any release.

A materializer MUST reject unsupported ownership manifest formats and versions,
and the CLI MUST reject unsupported document schema URIs, rather than guessing.
Package versions are installation metadata and MUST NOT become part of authored
resource locators.

Local resource edits MAY take effect on the next build without changing the
document schema URI. A versioned or immutable resource distribution MUST define
its own version or digest mechanism.

Future versions MAY add runtime tools, state, remote registries, preset sharing,
or skill execution, but those features MUST preserve the separation between
Atlante-owned prompt content and host-owned execution settings.

### Examples

A materializer that receives `format: "other-native-format"` MUST reject it. A
local change to `template.md` does not require changing `atlante.jsonc`'s
`$schema`.

### Edge cases

A document with an unsupported schema URI MUST fail even if its fields resemble a
known version. An ownership manifest version MUST NOT be inferred from its file
name.

### Rationale

Independent version domains let documents, templates, packs, and native outputs
evolve without making one release boundary govern every other contract. The
specification version is one of those domains, not the master clock for package
releases; the only coupling is the major version a tool owes when it drops a
contract version.

## 11. OpenCode Materializer Profile

### Goal

Define the first host materializer without making host behavior part of the
document.

### Contract

Version 0.1 admits `"opencode"` as the only host target, and `["opencode"]` is
the canonical default of the document's `hosts` field. The OpenCode
materializer MUST be selected only through that field and MUST receive the
prepared project as data. It MUST NOT load source configuration, resolve
resources or packs, or depend on the builder.

The materializer MUST publish the native output set defined in section 9:

- `.opencode/agents/<id>.md` for each agent binding, keyed by the binding's
  host-agent ID;
- `.opencode/skills/<id>/SKILL.md` for each skill binding, keyed by the
  binding's `skillId`; and
- `.atlante/opencode-native.json`, the ownership manifest with format
  `atlante-opencode-native`, version `1`, and one `files` entry of `kind`,
  `id`, `path`, and `sha256` per generated file.

Native IDs MUST follow the grammar of section 9 and are never renamed. Host
configuration remains host-owned: model, effort, permission, tool, and mode
settings live in the host configuration and are never written by the
materializer. The host composes its own configuration with the native files
when it starts. OpenCode reads native agents and skills at startup, so a
restart is required to pick up new or changed native files.

Materialization MUST fail closed with a stable diagnostic for collisions,
drift, stale-output digest mismatches, invalid IDs, unsafe paths, and
filesystem failures. Diagnostics carry the `materialization-` prefix over the
failure code (`invalid-input`, `invalid-id`, `invalid-manifest`,
`unsafe-path`, `collision`, `drift`, `filesystem`, `publication-failed`) and
one deterministic recovery action.

`atlante init` MUST NOT register a runtime integration for the materializer.
Init MUST also enforce the ignore-by-default git policy: `.gitignore` MUST
gain `.opencode/agents/`, `.opencode/skills/`, and `.atlante/` when missing,
and existing `.gitignore` content MUST NOT be reordered.

### Examples

The CLI is the composition root: it passes the OpenCode materializer to the
builder, and a build of a document without a `hosts` field materializes the
OpenCode native output set.

### Edge cases

If host selection or materialization fails, the build MUST leave the previous
valid generated set untouched. The ownership manifest is bookkeeping state, not
a trust boundary.

### Rationale

A build-time materializer keeps host integration narrow: no runtime plugin, no
persisted payload tree, and no source loading past the builder boundary, while
hash-gated updates keep every change to generated files intentional.

## 12. Eval

### Goal

Make harness behavior testable through declarative scenarios, deterministic
checks, and host-delegated execution, without making Atlante an inference
runtime.

### Contract

The document MAY declare an `eval` section. It MUST match the eval schema: a
`host` field admitting only `"opencode"` in version 0.1, a `scenarios` glob
relative to the project root, an optional `model` passed through to the host
run, and an optional `budget` of `trials`, `timeoutMs`, `maxSessions`, and
`maxTokens`. Absent budget fields MUST inherit the defaults of 3 trials,
600000 ms per run, 15 sessions, and 400000 tokens, with at most 50 trials per
run, and a run MUST stop when its budget is exhausted. A trial whose host
emits no usage events MUST be reported as budget-unmonitored: token spend
cannot be enforced and only the trial timeout bounds it.

Eval scenarios are versioned documents in their own namespace, identified by
the eval-scenario schema URI
(`https://atlante.sh/schema/v0.1/eval-scenario.json`). A scenario MUST declare
version `0.1`, a slug `name` unique across the suite, one `task` consisting of
a sandbox-relative `fixture`, an optional `setup` argv, an optional driving
`agent`, and a `prompt`, an optional scenario `budget.timeoutMs` override, and
at least one `check`.

Checks MUST be deterministic and zero-LLM, graded against sandbox state:

- `command` runs argv directly in the sandbox root, never through a shell, and
  asserts the exit code and, optionally, an output pattern;
- `file-exists`, `file-absent`, and `file-unchanged` assert sandbox file state;
- `file-contains` matches literal text by default, with regular expressions
  opt-in and compiled at validation time; and
- `diff-allowlist` restricts the paths the session may modify.

Fixture, check, and allowlist paths MUST resolve inside the sandbox: absolute
paths, path traversal, and `.git` or `node_modules` segments MUST be rejected.

Eval MUST NOT build. It runs against the verified native outputs of a prior
build, and every validation failure — including an invalid check pattern —
MUST fail before any host run or model call. Atlante MUST NOT perform LLM
inference or execute agents itself; scenario execution is delegated to the
declared host runner in a disposable sandbox, and run reports are local
artifacts under the project's `.atlante/eval` directory.

### Examples

```jsonc
{
  "eval": {
    "host": "opencode",
    "scenarios": "eval/scenarios/*.eval.jsonc",
    "budget": {
      "trials": 3,
      "timeoutMs": 600000,
      "maxSessions": 15,
      "maxTokens": 400000
    }
  }
}
```

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/eval-scenario.json",
  "version": "0.1",
  "name": "adds-health-endpoint",
  "task": {
    "fixture": "eval/fixtures/empty-app",
    "prompt": "Add a GET /health endpoint that returns { \"status\": \"ok\" }."
  },
  "checks": [
    { "type": "command", "run": ["bun", "test", "health"] },
    {
      "type": "file-contains",
      "path": "src/routes.ts",
      "pattern": "\"status\": \"ok\""
    },
    {
      "type": "diff-allowlist",
      "allow": ["src/routes.ts", "src/health.test.ts"]
    }
  ]
}
```

### Edge cases

Duplicate scenario names MUST fail at discovery. An unsupported eval host MUST
fail with a stable diagnostic instead of being ignored. A scenario-level
timeout override replaces the configured budget timeout for that scenario.
Check regular expressions MUST compile before any model call.

### Rationale

Declarative scenarios and deterministic checks turn the harness into testable
output while execution stays host-owned behind a narrow runner seam: Atlante
validates and grades, the declared host runs.

## 13. Acceptance Criteria

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
6. materialize a prepared project as deterministic host-native files and an
   ownership manifest;
7. preserve host-owned settings while materializing OpenCode agents and skills;
8. fail closed on collisions, drift, stale-output digest mismatches, invalid
   IDs, and unsafe paths;
9. scaffold from the first-party `@atlante/pack` default preset through
   `atlante init`, enforce the ignore-by-default git policy, and rebuild
   through `atlante build`;
10. remove stale generated outputs and preserve host-owned files;
11. preserve the previous valid generated set whenever validation or
    materialization fails;
12. validate `eval` configuration and scenario documents, including check
    patterns, before any host run; and
13. run eval scenarios in a host-delegated sandbox under budget enforcement
    and grade deterministic zero-LLM checks into a local run report.

### Examples

The conformance checklist is satisfied when a minimal configuration can move from
source to a validated prepared project and then to host-native files, an
up-to-date ownership manifest, and a host that discovers them.

### Edge cases

Implementations MAY provide additional commands and diagnostics, but those
extensions MUST NOT weaken any requirement or make excluded runtime capabilities
appear part of version 0.1.

### Rationale

The checklist turns the preceding contract into reviewable acceptance criteria
without prescribing internal package structure or implementation technique.
