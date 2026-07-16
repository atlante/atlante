---
name: writing-agents
description: Use when deciding agent vs skill vs subagent vs MCP, designing agent prompts and output contracts, choosing model tier per role, scoping agent permissions, or structuring multi-agent pipelines and orchestration patterns. NOT for config syntax, file paths, or plugin setup — use customize-opencode for that.
---

# Writing Agents

Design reasoning for agent architecture — "which construct?" and "how to structure it?" Not syntax.

**REQUIRED:** `customize-opencode` — config schema, frontmatter, paths, permission syntax.
**REQUIRED:** `writing-skills` — TDD methodology, SDO, anti-rationalization.
**REQUIRED:** `selecting-models` — pricing, benchmarks, provider comparison.

## When to Use / Not

**Use:** designing agents/subagents/pipelines, choosing construct type, model tier per role, permission design.
**Not:** writing skills (`writing-skills`), config syntax (`customize-opencode`), model pricing (`selecting-models`), one-off prompts (use a command).

## Decision Framework

| Problem shape | Construct | Why |
|---|---|---|
| Reusable guidance, any agent | **Skill** | No persona, loads on demand |
| Persistent persona + permissions | **Agent** | Owns identity, tools, model |
| Worker invoked by another agent | **Subagent** | Hidden, via Task tool |
| External capability as tools | **MCP server** | Tools any agent can call |
| Custom lifecycle logic | **Plugin** | Hooks into opencode events |
| User-invoked fixed-prompt shortcut | **Command** | Not a persona |

**Skills shape behavior inside any agent. Agents ARE the actor.**

## Architectural Patterns

| Pattern | When |
|---|---|
| Orchestrator + workers | Independent parallelizable subtasks |
| Pipeline (sequential) | Stages with different expertise |
| Fan-out / fan-in | Explore broadly, then synthesize |
| Specialist routing | Task type determines the expert |
| Read-only scout | Research before implementation |
| Review loop | Quality gate: produce → review → iterate |

## Scoping

- **One responsibility per agent.** Scout explores, builder writes, reviewer reviews.
- **God-agents skip steps under pressure.** Split when prompt >2000 tokens, >1 workflow, or permission conflict.
- **Merge when** two agents always run back-to-back, no branching.
- **Hidden subagents** (`hidden: true`) for internal pipeline stages.

## Model Selection Per Role

**REQUIRED:** `selecting-models` for current data.

| Role | Tier |
|---|---|
| Orchestrator | Frontier (long context, planning) |
| Specialist (build/fix) | Mid-tier (focused coding) |
| Scout (read-only) | Budget (fast, cheap) |
| Reviewer | Mid-to-frontier (judgment) |

**Cheapest tier that fits. Escalate with evidence.**

## Prompt Design

- **Imperative, not descriptive.** "You review PRs for X" — not "This explains review."
- **Persona scoping.** Define what the agent IS and is NOT.
- **Output contract.** State exact output shape.
- **Context budgeting.** Name specific tools. Don't list everything.

## Permission Design

| Role | Permissions |
|---|---|
| Scout | `edit: deny`, `bash: deny` |
| Builder | `edit: ask/allow`, `bash: ask` |
| Orchestrator | `task: allow` |
| Reviewer | `edit: deny`, `bash: ask` |

**Least privilege. `allow` only for the agent's core function.**

## Testing Agents

1. **Baseline.** Run scenario without the agent — observe default failures.
2. **Isolation.** Scoped task — stays in scope? correct output shape?
3. **Edge cases.** Ambiguous/empty input, out-of-scope tasks (refuse or hallucinate?).
4. **Composition.** Verify handoff format between orchestrator and workers.

## Composability

- Subagents via Task tool (`subagent_type`).
- Skills load inside any agent (`**REQUIRED:** skill-name`).
- MCP tools extend any agent with permission.
- @ mentions bring references into context.

## Common Mistakes

- **God-agent** — does everything, nothing well. Split by responsibility.
- **Wrong construct** — subagent where a skill suffices (lighter, no persona).
- **Oversized model** — frontier on a read-only scout wastes cost.
- **Over-permissioned** — scout with `edit: allow` edits things it shouldn't.
- **Missing output contract** — prose when orchestrator expected structured data.
- **Skipping baseline** — building without watching the default fail.
- **Unhidden internals** — pipeline stages visible to user. Use `hidden: true`.
