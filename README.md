# opencode-atlas

A multi-agent plugin for [OpenCode](https://opencode.ai). One config entry, complete agent topology and universal skills.

## Why

A single agent trying to explore, plan, build, and review in one shot loses focus. Atlas orchestrates and splits the work into specialists — each with a clear role, read-only or write access, and a focused context window. The orchestrator routes, specialists execute.

## Flow

```
                        ┌─────────────┐
                        │     User     │
                        └──────┬──────┘
                               │
                        ┌──────▼──────┐
                        │    atlas     │  orchestrator
                        │  (classify)  │
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
       │ brainstorm   │ │   plan      │ │  explore    │
       │ (ideate)     │ │ (design)    │ │ (recon)     │
       └─────────────┘ └──────┬──────┘ └──────┬──────┘
                              │                │
                              │         ┌──────▼──────┐
                              │         │    build     │
                              │         │ (implement)  │
                              │         └──────┬──────┘
                              │                │
                              │         ┌──────▼──────┐
                              │         │   review     │
                              │         │ (validate)   │
                              │         └──────┬──────┘
                              │                │
                        ┌─────┴────────────────┴─────┐
                        │        Back to user         │
                        └────────────────────────────┘
```

The common pipeline for non-trivial tasks is **explore → build → review**. The orchestrator may chain agents or handle trivial requests directly.

## Quick start

Add to your `opencode.json`:

```json
{
  "plugin": [["opencode-atlas", { "model": "anthropic/claude-sonnet-4-6" }]]
}
```

The `model` option is applied to all agents that don't define their own.

The plugin also makes its bundled skills available automatically.

## Agents

| Agent | Role |
|---|---|
| `atlas` | Orchestrator — classifies tasks, delegates |
| `atlas-brainstorm` | Ideation, alternatives, tradeoffs |
| `atlas-explore` | Read-only codebase reconnaissance |
| `atlas-build` | Implementation, edits, tests |
| `atlas-plan` | Architecture, multi-step design |
| `atlas-review` | Code review, risk, verification |

## Skills

| Skill | Purpose |
|---|---|
| `selecting-models` | Compare models, providers, pricing, and usage constraints |
| `writing-agents` | Design agents, subagents, permissions, and orchestration patterns |
| `writing-instructions` | Create scoped, precise, and safe agent instruction files |
| `writing-skills` | Create, test, and review reusable OpenCode skills |

Bundled skills are discovered through the plugin's config hook. Restart OpenCode after installing or updating the plugin.

## Custom agents

Drop `.md` files into `~/.config/opencode/atlas/agents/`:

```markdown
---
description: One sentence describing the agent.
mode: subagent
---

(your prompt here)
```

User files override bundled defaults if names collide. Restart required.

## License

MIT
