---
name: writing-skills
description: Use when writing SKILL.md content, designing skill descriptions for agent discovery, applying TDD to skills, bulletproofing skills against rationalization, or reviewing skills for spec compliance. NOT for OpenCode configuration syntax, plugin setup, or file paths — use customize-opencode for that.
---

# Writing Skills

Writing skills IS Test-Driven Development applied to process documentation.

You write test cases (pressure scenarios), watch them fail (baseline behavior), write the skill (documentation), watch tests pass (agents comply), and refactor (close loopholes).

**Core principle:** If you didn't watch an agent fail without the skill, you don't know if the skill teaches the right thing.

## When to Use

- Creating a new skill from scratch
- Editing or refactoring an existing skill
- Verifying a skill works before deployment
- Reviewing a skill for spec compliance

**Don't use for:**
- Project-specific conventions (use AGENTS.md or instructions instead)
- One-off solutions that won't be reused
- Standard practices already well-documented elsewhere

## What is a Skill?

A **skill** is a reference guide for proven techniques, patterns, or tools. Skills help future agents find and apply effective approaches.

**Skills are:** Reusable techniques, patterns, tools, reference guides
**Skills are NOT:** Narratives about how you solved a problem once

## Skill Types

| Type | What it is | Example |
|---|---|---|
| **Technique** | Concrete method with steps | condition-based-waiting, root-cause-tracing |
| **Pattern** | Way of thinking about problems | flatten-with-flags, test-invariants |
| **Reference** | API docs, syntax guides | library docs, command references |

## Directory Structure

```
skills/
  skill-name/
    SKILL.md              # Main reference (required)
    references/           # Optional: detailed reference files
    scripts/              # Optional: executable code
    assets/               # Optional: templates, resources
```

**Flat namespace** — all skills in one searchable namespace.

**Separate files for:** heavy reference (100+ lines), reusable tools/scripts/templates
**Keep inline:** principles, concepts, code patterns (< 50 lines), everything else

## SKILL.md Structure

Spec reference: [agentskills.io/specification](https://agentskills.io/specification)

**Frontmatter (YAML):**
- Two required fields: `name` and `description`
- Max 1024 characters total
- `name`: lowercase alphanumeric with hyphens only
- `description`: third-person, describes ONLY when to use (NOT what it does)

```markdown
---
name: skill-name-with-hyphens
description: Use when [specific triggering conditions and symptoms]
---

# Skill Name

## Overview
What is this? Core principle in 1-2 sentences.

## When to Use
Bullet list with SYMPTOMS and use cases
When NOT to use

## Core Pattern
Before/after code comparison (for techniques/patterns)

## Quick Reference
Table or bullets for scanning common operations

## Implementation
Inline code for simple patterns, link to file for heavy reference

## Common Mistakes
What goes wrong + fixes

## Real-World Impact (optional)
Concrete results
```

## Skill Discovery Optimization (SDO)

Future agents need to FIND your skill. Optimize for discovery.

### 1. Description Field — the most important part

The agent reads the description to decide which skills to load. Make it answer: "Should I read this skill right now?"

**Start with "Use when..."** to focus on triggering conditions.

**CRITICAL: Description = When to Use, NOT What the Skill Does**

Testing revealed that when a description summarizes the skill's workflow, agents may follow the description instead of reading the full skill. A description saying "code review between tasks" caused an agent to do ONE review, even though the skill clearly showed TWO.

```yaml
# ❌ BAD: Summarizes workflow - agents shortcut the skill body
description: Use when executing plans - dispatches subagent per task with code review between tasks

# ❌ BAD: Too much process detail
description: Use for TDD - write test first, watch it fail, write minimal code, refactor

# ✅ GOOD: Just triggering conditions
description: Use when executing implementation plans with independent tasks in the current session

# ✅ GOOD: Problem-focused
description: Use when implementing any feature or bugfix, before writing implementation code
```

**Content guidelines:**
- Use concrete triggers, symptoms, and situations
- Describe the *problem* (race conditions, inconsistent behavior) not language-specific symptoms
- Keep triggers technology-agnostic unless the skill itself is
- Write in third person
- **NEVER summarize the skill's process or workflow**

### 2. Keyword Coverage

Use words an agent would search for:
- Error messages: "Hook timed out", "ENOTEMPTY", "race condition"
- Symptoms: "flaky", "hanging", "zombie", "pollution"
- Synonyms: "timeout/hang/freeze", "cleanup/teardown/afterEach"
- Tools: Actual commands, library names, file types

### 3. Descriptive Naming

**Use active voice, verb-first:**
- ✅ `creating-skills` not `skill-creation`
- ✅ `condition-based-waiting` not `async-test-helpers`
- ✅ `flatten-with-flags` > `data-structure-refactoring`

**Gerunds (-ing) work well for processes:**
- `creating-skills`, `testing-skills`, `debugging-with-logs`

### 4. Token Efficiency

Every token counts — skills load into context.

**Target word counts:**
- Frequently-loaded skills: <200 words total
- Other skills: <500 words (still be concise)

**Techniques:**
- Move details to tool help (`--help`)
- Use cross-references to other skills instead of repeating
- Compress examples — one excellent example beats many mediocre ones
- Eliminate redundancy

### 5. Cross-Referencing Other Skills

Use skill name only, with explicit requirement markers:
- ✅ `**REQUIRED:** Use skill-name`
- ❌ `See skills/testing/test-driven-development` (unclear if required)

## Match the Form to the Failure

Before writing guidance, classify the baseline failure. The form that bulletproofs one failure type measurably backfires on another.

| Baseline failure | Right form | Wrong form |
|---|---|---|
| Skips/violates a rule under pressure | Prohibition + rationalization table + red flags | Soft guidance ("prefer...", "consider...") |
| Complies, but output has wrong shape | Positive recipe or contract: state what the output IS | Prohibition list ("don't restate", "never narrate") |
| Omits a required element | Structural: REQUIRED field or slot in template | Prose reminders near the template |
| Behavior should depend on a condition | Conditional keyed to observable predicate | Unconditional rule + exemption clauses |

**Rules for whichever form you pick:**
- **No nuance clauses.** "Don't X unless it matters" reopens negotiation.
- **Exemption clauses don't scope.** "This limit doesn't apply to code blocks" still suppresses code blocks.

## Bulletproofing Against Rationalization

Skills that enforce discipline need to resist rationalization. Agents are smart and will find loopholes under pressure.

### Close Every Loophole Explicitly

```markdown
# ❌ BAD
Write code before test? Delete it.

# ✅ GOOD
Write code before test? Delete it. Start over.

**No exceptions:**
- Don't keep it as "reference"
- Don't "adapt" it while writing tests
- Don't look at it
- Delete means delete
```

### Address "Spirit vs Letter" Arguments

```markdown
**Violating the letter of the rules is violating the spirit of the rules.**
```

### Build Rationalization Table

Capture rationalizations from testing. Every excuse goes in the table:

```markdown
| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
```

### Create Red Flags List

```markdown
## Red Flags — STOP and Start Over

- Code before test
- "I already manually tested it"
- "This is different because..."

**All of these mean: Delete code. Start over with TDD.**
```

## RED-GREEN-REFACTOR for Skills

### RED: Write Failing Test (Baseline)

Run a pressure scenario WITHOUT the skill. Document exact behavior:
- What choices did the agent make?
- What rationalizations did it use (verbatim)?
- Which pressures triggered violations?

### GREEN: Write Minimal Skill

Write skill that addresses those specific rationalizations. Don't add extra content for hypothetical cases.

Run same scenarios WITH skill. Agent should now comply.

### REFACTOR: Close Loopholes

Agent found new rationalization? Add explicit counter. Re-test until bulletproof.

### Micro-Test Wording First

Before full scenarios, verify wording with quick tests:
1. One fresh-context sample per call
2. Always include a no-guidance control
3. 5+ reps per variant
4. Manually read every flagged match
5. Variance is a metric — five different interpretations means wording isn't binding

## Common Mistakes

- **Description summarizes workflow.** Agents follow the description instead of reading the skill body. Keep descriptions focused on triggering conditions only.
- **Skill is too broad.** Trying to cover database querying AND administration in one skill. Split into coherent units.
- **Skill is too narrow.** Multiple skills needed for a single task creates overhead and conflicting instructions.
- **Skipping baseline testing.** Writing the skill without first observing the agent fail means you don't know if it teaches the right thing.
- **Ignoring token efficiency.** Every token in your skill competes with conversation history. Cut what the agent already knows.
- **Adding nuance clauses.** "Don't X unless it matters" reopens negotiation. Be explicit and absolute.
- **Using soft guidance for rule violations.** "Prefer..." and "consider..." don't work when agents skip rules under pressure. Use prohibitions + rationalization tables.

## Quality Checklist

Use this checklist before committing a new or updated skill.

### Naming

- [ ] Name uses only letters, numbers, hyphens
- [ ] Name is verb-first / gerund when applicable

### Frontmatter

- [ ] `name` and `description` fields present
- [ ] Description starts with "Use when..."
- [ ] Description describes triggering conditions only, NOT workflow
- [ ] Third person
- [ ] Max 1024 chars

### Content

- [ ] Clear overview with core principle
- [ ] Addresses specific baseline failures
- [ ] Guidance form matches failure type (see Match the Form to the Failure)
- [ ] Quick reference table
- [ ] Common mistakes section
- [ ] One excellent example (not multi-language)
- [ ] No narrative storytelling

### Token efficiency

- [ ] Frequently-loaded skills < 200 words
- [ ] Other skills < 500 words
- [ ] No redundancy with cross-referenced skills

### Deployment

- [ ] Commit skill to git
- [ ] Verify discovery (skill tool lists it)
