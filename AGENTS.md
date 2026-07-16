# AGENTS.md — opencode-atlas

## What this is

A minimal OpenCode plugin that installs a multi-agent workflow. One npm package, one config entry, complete agent topology.

```json
{ "plugin": [["opencode-atlas", { "model": "provider/model-id" }]] }
```

## Architecture

```
opencode-atlas/
├── package.json
├── plugin.ts              ← config hook: discovers + registers agents
├── agents/                ← bundled agent definitions (.md)
│   ├── atlas.md           ← orchestrator (primary mode)
│   ├── atlas-brainstorm.md
│   ├── atlas-explore.md
│   ├── atlas-build.md
│   ├── atlas-plan.md
│   └── atlas-review.md
└── AGENTS.md              ← this file
```

### Agent topology

| Agent | Mode | Role |
|---|---|---|
| `atlas` | primary | Orchestrator — classifies tasks, delegates to agents |
| `atlas-brainstorm` | subagent | Ideation, alternatives, tradeoffs |
| `atlas-explore` | subagent | Read-only codebase reconnaissance |
| `atlas-build` | subagent | Implementation, edits, tests |
| `atlas-plan` | subagent | Architecture, multi-step design |
| `atlas-review` | subagent | Code review, risk, verification |

### Naming convention

All agents are prefixed with `atlas-` to avoid collisions with OpenCode built-ins (`build`, `plan`, `explore`). The orchestrator is just `atlas`.

### Extensibility

Users add custom agents by dropping `.md` files into:

```
~/.config/opencode/atlas/agents/
```

The plugin scans both bundled and user directories at startup. User files override bundled defaults if names collide. Restart required after adding/removing files.

### Agent `.md` format

Standard OpenCode agent frontmatter:

```markdown
---
description: One sentence describing the agent's role.
mode: subagent
model: provider/model-id    ← optional, inherits plugin default
permission:                  ← optional
  edit: deny
  bash: deny
---

(prompt body — the agent's instructions)
```

## How plugin.ts works

1. On startup, OpenCode calls the `config` hook with the merged config
2. Plugin reads bundled agents from `agents/` (relative to package)
3. Plugin reads user agents from `~/.config/opencode/atlas/agents/`
4. Merges: existing config > user files > bundled defaults
5. Injects the agent roster into the orchestrator's prompt
6. If a `model` option was passed, applies it to agents that don't have their own model set

### Key dependencies

- `gray-matter` — parses YAML frontmatter from `.md` files
- `@opencode-ai/plugin` — OpenCode plugin type definitions (devDependency)
- Standard Node.js APIs: `node:fs/promises`, `node:path`, `node:os`, `node:url`

### Important caveats

- `{file:...}` substitution does NOT work in config hooks. Prompt content must be read from files and assigned as raw strings.
- `reasoningEffort` goes under `agent.options`, not top-level (config-file normalization handles it for file-defined agents, but hook-inserted agents don't go through that normalization).
- `permission: "allow"` needs to be `{ "*": "allow" }` for hook-inserted agents.
- OpenCode's `task` tool resolves `subagent_type` against registered agent names. The orchestrator uses this to delegate.
- No hot reload — config is loaded once at startup. Restart required after changes.

## Design decisions

1. **Role-based, not domain-based** — agents are brainstorm/explore/build/plan/review (universal roles), not frontend/backend (domains). Domain tuning happens via user overrides.

2. **Orchestrator delegates mainly** — handles trivial one-liners directly, delegates everything else. Can chain agents (explore → build → review).

3. **Optional gates** — not enforced by default. The orchestrator decides whether to chain review after build based on task complexity. Users can add approval workflows by customizing the orchestrator prompt.

4. **Minimal by design** — no context system, no approval framework, no team features. Just agent topology. Users layer complexity on top.

## TODO

- [ ] Test plugin with `gray-matter` dependency — confirm Bun handles it or find alternative
- [ ] Test actual plugin loading with OpenCode
- [ ] Decide: should orchestrator be set as `default_agent` via plugin, or user opts in?
- [ ] Consider: should agents have permission defaults (e.g., explore = read-only)?
- [ ] Consider: should the plugin register an `atlas_status` tool listing available agents?
- [ ] Consider: orchestrator prompt templating — inject agent names dynamically vs. rely on OpenCode's task tool descriptions
- [ ] Add `@opencode-ai/plugin` as devDependency with correct version
- [ ] Decide on publish strategy (npm, local file path, or both)
