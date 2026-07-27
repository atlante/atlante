# Atlante

Structured, versionable configuration for AI coding agents.

Atlante lets you define agent prompts as a validated document that renders to
Markdown system prompts. Instead of writing prompts by hand in each tool's
format, you declare your agents once and let Atlante handle rendering,
validation, and materialization to your host of choice (currently OpenCode).

Atlante is to AI coding harnesses what Terraform is to infrastructure — not the
host tool, not the agent itself, but the declarative layer in between.

## Why

- **Reusable** — share agent configurations across projects via presets
- **Composable** — build prompts from namespaced templates instead of monolithic
  strings
- **Customizable** — override values per-agent or per-project without touching
  templates
- **Portable** — the same document works across hosts via adapters
- **Validated** — catch misconfigurations upfront, not at runtime
- **Versionable** — configuration lives in git, has a schema, changes are
  trackable

## Quick start

The CLI is published as [`@atlante/cli`](https://www.npmjs.com/package/@atlante/cli)
and requires Node.js 22 or later. Run it directly with `npx`:

```bash
npx @atlante/cli init
npx @atlante/cli validate
npx @atlante/cli resolve
```

For a global `atlante` command, install the package with
`npm install --global @atlante/cli`.

`init` writes `atlante.jsonc` and registers `@atlante/opencode-plugin` in
`opencode.jsonc`, preserving anything already there. Without that registration
nothing activates — prompts are injected by the plugin when OpenCode starts.

## Example

An `atlante.jsonc` with two agents:

```jsonc
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",

  "values": {
    "project": "my-app",
    "apiRule": "All public APIs must have JSDoc.",
  },

  "agents": {
    "implementer": {
      "template": "atlante/agent",
      "identity": "You are a senior implementer on {{values.project}}.",
      "mission": "Write clean, tested, production-ready code.",
      "responsibilities": [
        "Implement features following the spec",
        "Write unit and integration tests",
      ],
      "constraints": ["{{values.apiRule}}"],
    },

    "reviewer": {
      "template": "atlante/agent",
      "identity": "You are a thorough code reviewer on {{values.project}}.",
      "mission": "Ensure code quality and adherence to standards.",
      "responsibilities": [
        "Review implementations for bugs and design issues",
        "Check adherence to project constraints",
      ],
      "constraints": ["{{values.apiRule}}"],
    },
  },
}
```

The implementer's system prompt renders to:

```markdown
# Identity

You are a senior implementer on my-app.

# Mission

Write clean, tested, production-ready code.

# Responsibilities

- Implement features following the spec
- Write unit and integration tests

# Constraints

- All public APIs must have JSDoc.
```

The reviewer gets the same structure with its own identity, mission, and
responsibilities. Change `values.apiRule` once — both agents pick it up.

The root document has exactly three fields: `$schema`, `values`, and `agents`.
Inside an agent binding, `template` and `values` are the only binding
metadata; every other key is prompt input, owned by the selected template's
input schema.

### How values reach a prompt

Values flow through two layers:

1. **System values** (`{{sys.cwd.basename}}`): preset defaults that resolve at
   runtime (here, to the project directory name). System values are resolved
   before user overrides are merged, so a user-provided value always wins.
2. **Document values** (`{{values.project}}`): written by you in
   `atlante.jsonc`, or inherited from a preset via `extends`. These are
   substituted into the prompt definition before template rendering.

Templates never receive the values dictionary: a template's entire input
contract is its JSON Schema, so it cannot depend on keys that no schema
defines. The resolver substitutes references into the prompt definition before
the template renders.

Substitution never evaluates. Only valid `{{values.key}}` references are
replaced; unsupported values-like references are diagnosed, while any other
brace syntax in your prompt text — `{{#each}}`, `{{#if}}`, an unbalanced `{{` —
is preserved exactly as written. Writing prompts that *talk about* template
syntax is normal, and doing so must not corrupt them.

## How it works

1. You write an `atlante.jsonc` (or `atlante.json`) with agent bindings and
   values.
2. Templates define how prompts render. Each is a Markdown file paired with a
   `template.json` Draft 2020-12 input schema.
3. The resolver merges values, substitutes references, renders templates, and
   produces host-independent prompt descriptors.
4. An adapter delivers the rendered prompts to the host.

```
atlante.jsonc  →  resolve  →  rendered Markdown  →  adapter  →  host agent
                 (templates + values)
```

For OpenCode, step 4 happens **in memory at startup**: the plugin's `config`
hook writes each rendered prompt into the host's agent configuration. No agent
files are generated, so nothing on disk can drift away from your Atlante
configuration — it genuinely is the single source of truth for prompts, rather
than merely their origin. Only the `prompt` field is written; model,
permissions, tools and mode stay owned by the host.

Because nothing is materialized to disk, `atlante resolve` is how you inspect
what your configuration actually produces.

## Templates

Bundled templates live in the `atlante/` namespace:

- **`atlante/agent`** — the root prompt renderer: identity, mission,
  responsibilities, constraints, and an optional `workflow` slot
- **`atlante/workflow`** — an ordered procedure, composed into `atlante/agent`

A slot is declared in a template's input schema as
`{ "template": "namespace/name" }` and invoked from Markdown with its input
property as `{{> slot/property}}`; quote the partial name when the property
contains spaces or other Handlebars delimiters. The property-specific partial
name means two slots can safely use the same child template while receiving
different input. Composition is validated ahead of rendering: missing templates
and cycles are rejected rather than discovered at runtime.

## Presets

A preset is a pre-filled `atlante.jsonc` to start from. A preset is a
*document*; a template is a *renderer*. Presets are validated by exactly the
same validators as user-authored configurations, so a broken preset cannot ship.

- **`starter`** — `architect` and `implement` agents, the default for `init`

Presets use `{{sys.cwd.basename}}` for their `project` value so you get a
sensible default without writing a `values` block. Add your own
`"values": { "project": "my-app" }` when you want to override it.

Run `atlante init` to scaffold from the `starter` preset.

## Packages

| Package | Responsibility |
| --- | --- |
| `@atlante/schema` | Document structure and the generated, versioned JSON Schema |
| `@atlante/templates` | Template schemas, loading, composition, rendering |
| `@atlante/validator` | Discovery, parsing, and two-level validation |
| `@atlante/resolver` | Value merging, substitution, and artifact descriptors |
| `@atlante/presets` | Bundled preset documents and registry loading |
| `@atlante/opencode-plugin` | Runtime prompt injection through OpenCode's `config` hook |
| `@atlante/cli` | `init`, `validate`, `resolve` |

`@atlante/templates` and `@atlante/presets` are the two content packages and
depend on nothing else in Atlante. That is what will let third parties publish
templates and presets without pulling in the core.

## Current scope (v0.1)

**Includes:**

- Minimal document structure with composable, namespaced templates
- Global values with per-agent overrides
- Two-level validation: document structure, then template input schemas
- Deterministic prompt resolution
- OpenCode adapter for prompt materialization
- Bundled `starter` preset via `atlante init`

**Does not include:**

- Model selection, effort, permissions, or host-agent configuration
- User-defined templates or third-party template authoring
- Rules or skills
- LLM inference or direct agent execution
- Preset export, sharing, or remote registry

## Development

```bash
bun install
bun run lint:check  # biome check .
bun run type:check   # tsc --build packages/*/tsconfig.json
bun test
```

## Status

v0.1, prompt-first profile. See [`SPECIFICATION.md`](SPECIFICATION.md) for the
normative contract.
