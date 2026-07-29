# Atlante

Structured, versionable configuration for AI coding agents.

Atlante lets you define agent prompts and Markdown skills as a
validated document. Instead of writing prompts by hand in each tool's format,
you declare them once and let Atlante handle rendering, validation, and
materialization to your host of choice (currently OpenCode).

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

Skills are structured template input rendered as Markdown, not agents. A
resolved skill is available to every host agent through the OpenCode plugin's
`atlante_skill` tool. A lookup uses exactly one object,
`{ "name": "<skillId>" }`, and returns only the skill's rendered Markdown
content. Atlante does not execute skill content.

The root document has `$schema`, `values`, `agents`, and optional `skills`
fields. Inside an agent binding, `template` and `values` are binding metadata;
inside a skill binding, `description`, `template`, and `values` are reserved
metadata. All other binding keys are input owned by the selected template's
input schema.

### How values reach a prompt or skill

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

1. You write an `atlante.jsonc` (or `atlante.json`) with agent and optional
   skill bindings and values.
2. Templates define how prompts render. Each is a Markdown file paired with a
   `template.json` Draft 2020-12 input schema.
3. The resolver merges values, substitutes references, renders templates, and
   produces host-independent agent and skill artifact descriptors.
4. An adapter delivers the rendered prompts to the host.

```
atlante.jsonc  →  resolve  →  rendered Markdown  →  adapter  →  host agent/tool
                  (templates + values)
```

For OpenCode, step 4 happens **once in memory during initialization**: the
plugin's `config` hook stages the rendered prompts in the host's agent
configuration and makes resolved skills available through `atlante_skill`. No
agent or skill files are generated, and skill content is not put in a cache or
registered as a native OpenCode skill. Nothing on disk can drift away from your
Atlante configuration — it genuinely is the single source of truth for prompt
and skill content. Only the agent `prompt` field is written; model,
permissions, tools and mode stay owned by the host.

Because nothing is materialized to disk, `atlante resolve` is how you inspect
what your configuration actually produces.

## Templates

Bundled templates live in the `atlante/` namespace:

- **`atlante/agent`** — the root prompt renderer: identity, mission,
  responsibilities, constraints, and ordered, reusable sections
- **`atlante/workflow`** — a sequential multi-phase workflow with inline
  instructions and final validation, optional phase-level `subagent` delegation,
  and phase-level aggregate output, composed into agent or skill sections
- **`atlante/skill`** — structured skill input rendered as Markdown with
  ordered, reusable sections

Agent and skill section arrays preserve source order. Agent sections may combine
responsibilities, constraints, Markdown, instructions, and gotchas. Skill
sections may combine Markdown, constraints, instructions, gotchas, and workflows.

## Presets

A preset is a pre-filled `atlante.jsonc` to start from. A preset is a
*document*; a template is a *renderer*. Presets are raw documents: the
consuming validator expands and validates them through the same path used for
user-authored overlays, so a broken preset is rejected when consumed.

- **`starter`** — `architect` and `implement` agents, the default for `init`;
  presets may also provide global skills

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
| `@atlante/resolver` | Value merging, substitution, and agent/skill artifact descriptors |
| `@atlante/presets` | Bundled preset documents and registry loading |
| `@atlante/opencode-plugin` | In-memory agent injection and `atlante_skill` through OpenCode's `config` hook |
| `@atlante/cli` | `init`, `validate`, `resolve` |

`@atlante/templates` and `@atlante/presets` are the two content packages and
depend on nothing else in Atlante. That is what will let third parties publish
templates and presets without pulling in the core.

## Current scope (v0.1)

**Includes:**

- Minimal document structure with composable, namespaced templates
- Global values with per-agent overrides
- Project-global Markdown skills resolved through the `atlante_skill` adapter tool
- Two-level validation: document structure, then template input schemas
- Deterministic prompt resolution
- OpenCode adapter for in-memory prompt and skill materialization
- Bundled `starter` preset via `atlante init`

**Does not include:**

- Model selection, effort, permissions, or host-agent configuration
- User-defined templates or third-party template authoring
- Skill execution, runtime skill state, and remote skill loading
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
