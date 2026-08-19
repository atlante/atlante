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
- **Composable** — build prompts from installed pack or local template facets instead of monolithic
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
      "$template": "@atlante/pack/agent",
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
      "$template": "@atlante/pack/agent",
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

### OpenCode model overrides

OpenCode merges its normal configuration first. User-global configuration has
lower precedence than repository `.opencode` configuration, and the local
OpenCode plugin then applies the ignored `.opencode/models.json`, giving that
file the final say on the three supported model fields at startup. This
documents the normal configuration order only; it does not promise that a
repository plugin can override administrator-managed policy.

The file is strict JSON, not JSONC. It accepts only the `architect`, `general`,
and `explore` keys, with `provider/model` string values:

```json
{
  "architect": "opencode/deepseek-v4-flash-free",
  "general": "opencode/deepseek-v4-flash-free",
  "explore": "opencode/deepseek-v4-flash-free"
}
```

If the ignored file is missing, the plugin creates it with
`opencode/deepseek-v4-flash-free` for all three roles. A partial file overrides
only the roles it lists; omitted roles preserve their model from the merged
OpenCode configuration. Malformed JSON, unknown keys, or malformed
`provider/model` syntax fail plugin loading before any partial model mutation.
Only model fields change: shared role settings, permissions, tools, reasoning
settings, prompts, and descriptions remain intact. Validation does not check
live provider or catalog availability. Restart OpenCode after changing this
file or the plugin.

## Packs And Presets

A pack is an installed npm, workspace, or `file:` package containing static
Atlante content. Its `package.json` declares `"atlante": { "format": 1 }` and
the package directory is the immutable content root. Packs contain optional
default or named presets, template facets, and instance facets. They have no
JavaScript entry point, registration hook, or executable API. Atlante reads
only a referenced facet and its transitive dependencies, never scans installed
packages or installs dependencies.

Package locators use a valid scoped or unscoped package name with an optional
contained POSIX subpath, for example `@acme/review-pack` or
`@acme/review-pack/strict`. `extends` selects a preset, `$template` selects a
template facet, and `$instance` or a bare locator selects an instance facet.
Project-authored package references require a declared dependency. Pack-authored
references require a declared runtime dependency in the authoring pack.

A preset is a pre-filled `atlante.jsonc` to start from. A preset is a
*document*; a template is a *renderer*. Presets are raw documents: the
consuming validator expands and validates them through the same path used for
user-authored overlays, so a broken referenced preset is rejected before build.

- **`@atlante/pack`** — the first-party default preset with the `architect` agent
  plus `brainstorming` and `workflow` skills

Presets use `{{sys.cwd.basename}}` for their `project` value so you get a
sensible default without writing a `values` block. Add your own
`"values": { "project": "my-app" }` when you want to override it.

Run `atlante init` to scaffold from the `@atlante/pack` preset. `init` writes
`"extends": "@atlante/pack"`, registers the OpenCode plugin while preserving
existing host settings, builds the initial artifact tree, and rolls back
source/config changes if initialization or the build fails. Install a third-party
pack first, then select its default or named preset without mutating the project:

```bash
npm install --save-dev @acme/review-pack
atlante init --preset @acme/review-pack
atlante init --preset @acme/review-pack/strict
```

For multiple preset layers, author an ordered `extends` array. Each selected
preset resolves its own inheritance first; layers merge left-to-right and the
local document wins. Arrays replace, objects merge recursively, and `null`
removes inherited values.

## Packages

Three packages are published to npm in dependency order: `@atlante/pack`, then
`@atlante/cli`, then `@atlante/opencode-plugin`.

| Package | Responsibility |
| --- | --- |
| `@atlante/pack` | First-party static presets, templates, and instances; `atlante.format: 1` |
| `@atlante/cli` | `init`, `validate`, `build`; resolves the installed first-party pack from the CLI installation |
| `@atlante/opencode-plugin` | In-memory agent injection and `atlante_skill` through OpenCode's `config` hook |

The remaining four packages are private internal workspaces. They are not
published to npm:

| Package | Responsibility |
| --- | --- |
| `@atlante/schema` | Document structure and the generated, versioned JSON Schema |
| `@atlante/resources` | Local/package resource packs, facets, resolution, composition, rendering, and lazy static loading |
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
- First-party static `@atlante/pack` preset via `atlante init`
- Local resource authoring with local template and instance facets
- Installed static npm/workspace/`file:` packs with package-to-pack runtime dependencies

**Does not include:**

- Model selection, effort, permissions, or host-agent configuration
- Skill execution, runtime skill state, and remote skill loading
- LLM inference or direct agent execution
- Executable pack code, package installation, node-module scanning, and remote resource registries

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
gitignored build output. The CLI does not copy a resource tree into its package;
the runtime `@atlante/pack` dependency supplies the first-party static content.
Run `bun run build` after CLI source changes.

## Watch And OpenCode Boundary

Build watch follows the selected pack manifest, facet files, transitive
dependencies, and trusted lexical symlink paths. It retries safe missing package
parents when they become available and ignores unrelated malformed siblings.
Run `atlante build` after source changes when watch mode is not active.

The OpenCode plugin never reads source configuration or pack files. It consumes
only the verified `.atlante/artifacts/` tree. The artifact format marker remains
`"format": "atlante-artifacts"` with numeric `"version": 1`, and every payload
is protected by its manifest SHA-256 hash. The artifact boundary is unchanged by
pack loading.

## Migration From The Temporary Namespace

This is an alpha breaking migration. Replace the old built-in locators as follows:

| Before | After |
| --- | --- |
| `atlante/starter` | `@atlante/pack` |
| `atlante/<resource>` | `@atlante/pack/<resource>` |

Do not add `@atlante/resources` as a project dependency. Install third-party
packs with the package manager and declare them in `dependencies`,
`devDependencies`, or `optionalDependencies`; Atlante never edits
`package.json` or installs packages.

## Status

v0.1, prompt-first profile. See [`SPECIFICATION.md`](SPECIFICATION.md) for the
normative contract.
