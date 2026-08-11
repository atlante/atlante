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
- **Composable** — build prompts from bundled or local template facets instead of monolithic
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
npx @atlante/cli build
```

For a global `atlante` command, install the package with
`npm install --global @atlante/cli`.

`init` writes `atlante.jsonc`, builds `.atlante/artifacts/`, and registers
`@atlante/opencode-plugin` in `opencode.jsonc`, preserving anything already
there. Without that registration nothing activates: verified artifacts are
injected by the plugin when OpenCode starts. Run `atlante build` after changing
the source configuration.

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
      "$template": "atlante/agent",
      "description": "Implements requested changes in the project.",
      "identity": "You are a senior implementer on {{values.project}}.",
      "mission": "Write clean, tested, production-ready code.",
      "responsibilities": [
        "Implement features following the spec",
        "Write unit and integration tests",
      ],
      "constraints": ["{{values.apiRule}}"],
    },

    "reviewer": {
      "$template": "atlante/agent",
      "description": "Reviews changes for defects and design issues.",
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
fields. Inside an agent or skill binding, `description`, `$template`,
`$instance`, and `values` are binding metadata. All other binding keys are input
owned by the selected template facet's input schema. A bare resource locator is
`$instance` shorthand; the legacy binding-level `template` selector is not
supported.

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
defines. The builder substitutes references into the prompt definition before
the template renders.

Substitution never evaluates. Only valid `{{values.key}}` references are
replaced; unsupported values-like references are diagnosed, while any other
brace syntax in your prompt text — `{{#each}}`, `{{#if}}`, an unbalanced `{{` —
is preserved exactly as written. Writing prompts that *talk about* template
syntax is normal, and doing so must not corrupt them.

## How it works

1. You write an `atlante.jsonc` (or `atlante.json`) with agent and optional
   skill bindings and values.
2. Resources define how prompts render. A template facet is a Markdown file
   paired with a `template.jsonc` Draft 2020-12 input schema; an instance facet
   supplies configured input for a template facet.
3. The builder merges values, substitutes references, renders templates, and
   publishes host-independent agent and skill artifacts.
4. An adapter verifies the artifacts and delivers the rendered prompts to the
   host.

```
atlante.jsonc  →  build  →  verified artifacts  →  adapter  →  host agent/tool
                   (resources + values)
```

For OpenCode, step 4 happens **once in memory during initialization**: the
plugin's `config` hook verifies the published artifacts, stages the rendered
prompts in the host's agent configuration, and makes verified skills available
through `atlante_skill`. Only the agent `prompt` and `description` fields are
written; model, permissions, tools and mode stay owned by the host. The plugin
does not load or render source configuration.

Artifacts are published under `.atlante/artifacts/` using the independent
`atlante-artifacts` format version 1. The manifest records relative payload
paths and SHA-256 digests, and adapters reject malformed trees or any digest
mismatch before materialization. The artifact format version is separate from
the document `$schema` version. Rendered values may contain sensitive data, so
keep `.atlante/` local and do not publish artifacts.

## Presets

A preset is a pre-filled `atlante.jsonc` to start from. A preset is a
*document*; a template is a *renderer*. Presets are raw documents: the
consuming validator expands and validates them through the same path used for
user-authored overlays, so a broken preset is rejected when consumed.

- **`starter`** — the bundled `architect` agent plus `brainstorming` and
  `workflow` skills, the default for `init`

Presets use `{{sys.cwd.basename}}` for their `project` value so you get a
sensible default without writing a `values` block. Add your own
`"values": { "project": "my-app" }` when you want to override it.

Run `atlante init` to scaffold from the `starter` preset. `init` writes the
containing project configuration, registers the OpenCode plugin while
preserving existing host settings, builds the initial artifact tree, and rolls
back source/config changes if initialization or the build fails.

## Packages

Two packages are published to npm:

| Package | Responsibility |
| --- | --- |
| `@atlante/cli` | `init`, `validate`, `build` |
| `@atlante/opencode-plugin` | In-memory agent injection and `atlante_skill` through OpenCode's `config` hook |

The other four packages are private internal workspaces. They are not published
to npm:

| Package | Responsibility |
| --- | --- |
| `@atlante/schema` | Document structure and the generated, versioned JSON Schema |
| `@atlante/resources` | Local/bundled resource packs, facets, resolution, composition, rendering, and bundled source content |
| `@atlante/validator` | Discovery, parsing, and two-level validation |
| `@atlante/builder` | Project preparation, value merging, rendering, and artifact publication |

## Current scope (v0.1)

**Includes:**

- Minimal document structure with composable, namespaced templates
- Global values with per-agent overrides
- Project-global Markdown skills resolved through the `atlante_skill` adapter tool
- Two-level validation: document structure, then template input schemas
- Deterministic prompt resolution
- OpenCode adapter for in-memory prompt and skill materialization
- Bundled `starter` preset via `atlante init`
- Local resource authoring with local template and instance facets

**Does not include:**

- Model selection, effort, permissions, or host-agent configuration
- Skill execution, runtime skill state, and remote skill loading
- LLM inference or direct agent execution
- Package/plugin resource resolution and remote resource registries

## Development

```bash
bun install
bun run lint:check  # biome check .
bun run type:check   # tsc --build packages/*/tsconfig.json
bun test
```

### Local `atlante` command

Run the CLI directly from source with `bun run cli <command>` (no build
needed). To use the bare `atlante <command>` instead, link the CLI package
globally (per machine; re-run after a fresh clone):

```bash
bun run build   # required: the linked command runs the built artifact
bun link --cwd packages/cli
```

The linked `atlante` runs `packages/cli/dist/bin/atlante.js`, which is
gitignored build output. A fresh checkout has neither `packages/cli/dist/`
nor the generated `packages/cli/bundled/` resource pack copied at build time;
`bun run build` produces both, so re-run it after any CLI source changes.

## Status

v0.1, prompt-first profile. See [`SPECIFICATION.md`](SPECIFICATION.md) for the
normative contract.
