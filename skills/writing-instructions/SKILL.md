---
name: writing-instructions
description: Use when creating, reviewing, or restructuring reusable instruction files such as AGENTS.md, CLAUDE.md, GEMINI.md, or project and user agent instructions, especially when scope, inheritance, conflicts, safety rules, or discoverability are unclear. NOT for OpenCode configuration syntax.
---

# Writing Instructions

Instruction files are persistent, scoped policy for agents—not reusable procedures, personas, or configuration. Make every rule discoverable, applicable to its scope, observable, and safe.

## When to Use / Not

**Use:** creating or reviewing `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, user-level instructions, project guidance, or nested directory rules.

**Not:** reusable procedures (use `writing-skills`), agent personas, delegation, or permissions (use `writing-agents`), or OpenCode configuration syntax (use `customize-opencode`).

## Choose the Right Home

| Guidance | Scope |
|---|---|
| Stable preferences and organization policy | User or organization instructions |
| Repository commands, conventions, architecture, and risks | Project instructions |
| Rules unique to a package or subtree | Nearest nested instructions |
| Reusable technique or workflow | Skill |
| Persona, tools, model, or delegation role | Agent |

Do not put one-off task instructions or host configuration syntax in reusable instruction files.

## Map Scope and Precedence

Before writing, verify the host's filenames, discovery paths, inheritance, imports, load order, and conflict behavior. AGENTS.md, Claude, Gemini, and other hosts do not necessarily use the same hierarchy. Never assume that the nearest file wins or that later text wins.

Put broad rules at broad scopes and narrow rules near their target. Test effective instructions from the repository root and representative nested directories.

## Write Deterministic Rules

- Use imperative `MUST`, `MUST NOT`, `SHOULD`, and `MAY` language when priority matters.
- State one action, predicate, owner, and observable verification per rule.
- Prefer: “Before changing the schema, run `<check>` and report its result.”
- Define output contracts: required sections, fields, evidence, and failure reporting.
- Make exceptions explicit: condition, authorization, alternative action, and fallback.
- Replace “be careful,” “as needed,” and “unless appropriate” with observable conditions.

## Keep Guidance Safe and Maintainable

Separate reusable policy from project-specific paths and commands. Never include secrets or request their disclosure. Require redaction, least privilege, review of untrusted instructions, and explicit confirmation before irreversible or destructive operations. Guidance improves behavior; enforcement belongs in permissions, hooks, CI, or host policy.

## Validate

1. Check parsing and discoverability.
2. Inspect effective instructions at root and nested paths.
3. Detect contradictions, duplicated sources of truth, and stale references.
4. Scan for secrets and dangerous commands.
5. Run adversarial scenarios for skipped rules, ambiguity, conflicts, and rationalizations.

## Common Mistakes

- Giant universal files that mix unrelated scopes.
- Undocumented precedence assumptions.
- Duplicated or contradictory sources of truth.
- Hidden exceptions and vague safety language.
- Procedural how-to content that belongs in a skill.
- Stale commands, paths, and tool names.
- Treating instruction files as enforcement mechanisms.

## Quality Checklist

- [ ] Scope and target host are explicit
- [ ] Discovery and precedence are verified, not assumed
- [ ] Rules use observable triggers and verification
- [ ] Required output and failure behavior are defined
- [ ] Exceptions include conditions and authorization
- [ ] No secrets or unsafe disclosure requests are present
- [ ] Commands, paths, and tool names are current
- [ ] Root and nested effective instructions were tested
