# AGENTS.md — opencode-atlas

## What this is

A minimal OpenCode plugin that installs a multi-agent workflow. One npm package, one config entry, complete agent topology and universal skills.

```json
{ "plugin": [["opencode-atlas", { "model": "provider/model-id" }]] }
```

## Architecture

```
opencode-atlas/
├── package.json
├── plugin.ts              ← config hook: discovers + registers agents and skills
├── agents/                ← bundled agent definitions (.md)
│   ├── atlas.md           ← orchestrator (primary mode)
│   ├── atlas-brainstorm.md
│   ├── atlas-explore.md
│   ├── atlas-build.md
│   ├── atlas-plan.md
│   └── atlas-review.md
├── skills/                ← bundled universal skills
│   ├── selecting-models/
│   ├── writing-agents/
│   ├── writing-instructions/
│   └── writing-skills/
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
6. Adds the bundled `skills/` directory to `config.skills.paths`
7. If a `model` option was passed, applies it to agents that don't have their own model set

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
- Bundled skills are discovered from the package directory through `config.skills.paths`; they are not copied into the user's global skill directory.

## Design decisions

1. **Role-based, not domain-based** — agents are brainstorm/explore/build/plan/review (universal roles), not frontend/backend (domains). Domain tuning happens via user overrides.

2. **Orchestrator delegates mainly** — handles trivial one-liners directly, delegates everything else. Can chain agents (explore → build → review).

3. **Configurable workflows** — the default flow remains heuristic, but users should be able to override bundled agent settings such as model, reasoning effort, and permissions; define new agents; and describe phases, expected outputs, transitions, and gates. Gates may be automatic, review-based, or approval-based.

4. **Advisory before deterministic** — workflow configuration initially guides the orchestrator through prompts. It must not imply deterministic phase ordering or gate enforcement until the runtime supports it explicitly.

5. **Agents and skills, not rules or memory** — Atlas provides reusable agents and skills, including guidance for writing instructions. Project rules remain subjective and user-owned; persistent memory is out of scope.

6. **Common contract, distinct metadata** — agents and skills share a conceptual structure: purpose, scope, instructions, and output or verification expectations. They retain construct-specific metadata: agents own mode, model, and permissions; skills own discovery triggers and reusable procedures.

7. **Explicit prompt composition** — bundled prompts may be extended through an explicit, ordered, inspectable extension or overlay mechanism. Full replacement remains possible; arbitrary `prompt` fields are not implicitly concatenated.

8. **Self-aware orchestrator** — Atlas knows the plugin's topology, registration and startup behavior, available skills, and active user configuration. It uses dynamically supplied workflow guidance, delegates with structured phase prompts and handoffs, and helps developers design or revise their agent and workflow configuration when asked.

9. **Minimal by design** — no context system, memory layer, approval framework, or team features by default. Users layer additional complexity on top.

## TODO

- [ ] Test plugin with `gray-matter` dependency — confirm Bun handles it or find alternative
- [ ] Test actual plugin loading with OpenCode
- [ ] Test bundled skill discovery with OpenCode
- [ ] Decide: should orchestrator be set as `default_agent` via plugin, or user opts in?
- [ ] Consider: should agents have permission defaults (e.g., explore = read-only)?
- [ ] Consider: should the plugin register an `atlas_status` tool listing available agents?
- [ ] Consider: orchestrator prompt templating — inject agent names dynamically vs. rely on OpenCode's task tool descriptions
- [ ] Design plugin options for agent overrides, custom agents, workflow phases and gates, and explicit prompt extensions
- [ ] Decide on publish strategy (npm, local file path, or both)
