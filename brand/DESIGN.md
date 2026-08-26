# Atlante Design

This file records the approved brand and design decisions applied across Atlante's public surfaces: positioning, naming, voice, and visual identity. `SPECIFICATION.md` remains the normative implementation contract for the product itself. The detailed upstream contract lives outside this repository in the design workspace as `brand_specs.md`; the canonical assets it governs are the files under `brand/`.

## Role and Precedence

When documents disagree, apply this order:

1. Shipped behavior from `README.md`, `SPECIFICATION.md`, tests, and implementation.
2. Approved brand decisions recorded here.
3. Canonical asset masters: `brand/assets/final_logo.svg` for logo artwork and `brand/atlante-design-tokens.css` for the executable token and font-loading source.

Detailed rationale, phase records, and approval history stay in the upstream contract. This file distills its decisions; it does not replace them. Upstream HTML specimens and phase records demonstrate intent and record evidence; they are rationale, not additional implementation requirements, and they never override shipped behavior or the canonical assets named here.

Labels distinguish state:

- **Current:** verified behavior that may be documented as shipped.
- **Target:** approved behavior that requires implementation or migration.
- **Open:** an unresolved decision that must not be silently guessed and authorizes no current claim.

## Product Truth

**Category:** the configuration and build layer for your coding-agent harness.

**Primary audience:** engineering teams that need explicit structure for the agents, skills, and workflows in a shared coding-agent harness. Adjacent audiences are individual engineers adopting or maintaining a harness, engineering leads defining agent roles, and maintainers packaging reusable harness content.

**Tagline:** Give form to your harness.

Approved positioning: for teams that need a coding-agent harness they can share and evolve, Atlante turns agents, skills, and workflows into one versioned system. Unlike maintaining scattered prompts and host configuration separately, Atlante gives the team an authoritative source in the repository, then materializes it through a host adapter.

Message order:

1. Category: configuration and build layer for the harness.
2. Team outcome: one shared source inherited through the repository.
3. System contents: agents, skills, workflows, values, and selected resources.
4. Destination: materialized through a host adapter; OpenCode is available today.
5. Supporting proof: composition, validation, deterministic output, artifact verification, and host-setting preservation.
6. Boundary: Atlante defines orchestration but does not execute agents itself.

Never open with schema validation, artifact hashing, mythology, or a future registry.

**Boundary:** Atlante defines prompt-level orchestration; the host and prompted model execute it. In v0.1 Atlante performs no LLM inference, executes no agents, skills, or arbitrary project code, selects no host settings, maintains no runtime workflow state, and provides no other host than OpenCode.

Claims ledger:

| Status | Claims |
| --- | --- |
| Safe now | Open source under the repository license; declarative JSONC or JSON configuration; versioned source with project code; schema-backed validation; deterministic rendering; local and installed static packs; verified artifacts and atomic publication; OpenCode prompt and skill materialization; preservation of OpenCode-owned execution settings; no agent, skill, or arbitrary code execution by Atlante |
| Requires qualification | Shared means Git inheritance, not hosted collaboration; portable describes architecture while only OpenCode is available; verified means local artifact integrity, not security provenance; orchestrated means Atlante renders while host and model execute; Terraform is a role analogy, not feature parity; pack ecosystem means static packages, not a registry |
| Avoid until shipped | Render anywhere, works everywhere, any host, host-agnostic; secure, trusted, tamper-proof, or provenance-guaranteed artifacts; registry, marketplace, hosted collaboration; executing subagents or holding runtime state; improved model intelligence or outcomes; autonomous, magical, intelligent infrastructure, revolutionary, effortless, seamless, game-changing, next-generation |

## Naming and Vocabulary

Atlante bears the celestial sphere. The sphere represents the complete harness, given form by the developer. Metaphors explain the product; they never replace its technical vocabulary and never enter schema fields, package names, types, or code identifiers.

| Metaphor | Meaning | Allowed use |
| --- | --- | --- |
| Atlante bearing the sphere | Atlante carries the harness structure | Brand story, identity rationale, major narrative moments |
| Celestial sphere | The complete structured harness | Architecture overview and visual system |
| Star | A configured reference point such as identity, instruction, constraint, value, or policy | Explanatory diagrams and occasional editorial copy |
| Constellation | An agent whose reference points form a coherent role and identity | Light explanatory copy and diagrams |
| Projection | Materialization through a host adapter | Architecture explanation paired with the literal term `adapter` |
| Bearing | Support, load, responsibility, materialization | Brand narrative and graphic devices |
| Almanac | A possible future name for a reusable-content registry | Reserved; no current behavior is defined |

Skills remain literal skills, reusable guidance rather than stars. Artifacts remain artifacts. Never rename Atlante to Atlas or Atlantis.

Technical vocabulary keeps its required meanings: `configuration` is the primary prose term for the authored system and `config` appears only in compact CLI, argument, or code contexts; `document` names the parsed or validated configuration entity in technical documentation; `preset` names a preconfigured root document used directly or through `extends`; `artifact` names generated output under `.atlante/artifacts/`; `host adapter` is the public phrase for host-specific materialization.

`family` and `PackItem` are retired early discussion terms (decision D4). They are absent from the current brand vocabulary; do not attribute them to this contract.

Retired implementation names: `atlante/starter`, `atlante/<resource>`, `@atlante/templates`, `@atlante/presets`, and `resolve` terminology. The current implementation uses `@atlante/pack`, `$template`, `$instance`, and `build`.

## Voice and Language

Use active voice by default. Use sentence case for headings, labels, buttons, and titles. Use the serial comma. Address the developer as `you` and the product as `Atlante`. Preserve exact commands, options, filenames, fields, paths, IDs, lifecycle states, and diagnostic codes, and format them as code. Show the command before its output.

Success-output grammar is lowercase past-tense verb plus object without a period, as in `validated <path>` and `built <artifactsPath>`. This grammar is **Target**: the current validation line remains `ok: <path>` until issue #49 migrates the CLI and plugin with test coverage. Do not document the target as already shipped.

Diagnostic envelope order — severity and stable code, failure statement, location, expected contract, next action, normalized cause last — is likewise **Target**, gated on #49. Diagnostics contain no metaphor, personality, hype, blame, apology, or decorative punctuation, and preserve JSON Pointer paths exactly.

Metaphor density decreases toward operation and reaches zero in procedures, CLI output, errors, schema references, and troubleshooting. Every expressive headline has a nearby literal explanation.

Language mechanics: keep explanatory sentences between 12 and 22 words with one main idea per sentence; use periods for full prose sentences and omit them from buttons, navigation labels, table headers, compact statuses, and CLI success lines; use a colon to separate diagnostic labels from values; avoid exclamation marks, dramatic ellipses, rhetorical questions, and decorative punctuation; write public-surface copy in English and preserve `Atlante`, `OpenCode`, and font family names exactly.

Condensed lexicon:

- Prefer: define, build, structure, compose, inherit, validate, render, materialize, version, review, evolve, configuration, source, harness, agent, skill, workflow, preset, artifact, adapter, explicit, deterministic, project-local, Git-native, versioned, reproducible.
- Use carefully: as code, orchestrate, verified, portable, shared, host-independent, canonical, fail-closed, atomic publication, Terraform, pack, registry, Almanac.
- Avoid: revolutionary, magical, effortless, seamless, game-changing, next-generation, smart, intelligent, autonomous, self-healing, secure, trusted, tamper-proof, any host, works everywhere, render anywhere, host-agnostic, prompt manager, orchestration runtime, marketplace, simply, just, easy, obviously.

## Visual Identity Essentials

This section distills decisions into pointers; the named files are authoritative for exact values.

- Logo master: `brand/assets/final_logo.svg`. Production exports live under `brand/assets/exports/`. Every export traces to the master and preserves the complete approved composition: never redraw, trace, crop, partially recolor, glow, shadow, or gradient the mark.
- Lockups: glyph only; horizontal and stacked glyph plus uppercase `ATLANTE`; each arrangement with optional tagline; and single-color reverse. Lockups are layouts of one identity, not alternate marks.
- Palette primitives and roles: `--atlante-linen` is the primary light surface and reverse ink; `--atlante-jet` is the primary ink and dark surface; `--atlante-bronze` covers rules, structural details, and non-text accents on light surfaces; `--atlante-pine` is the principal accent and light-theme success; `--atlante-brown` carries warning and error emphasis. Components consume semantic tokens through `brand/atlante-design-tokens.css` instead of duplicating raw palette values.
- Typography roles: Bodoni Moda for display and wordmark; Source Serif 4 for editorial reading; Source Sans 3 for interface text; JetBrains Mono for code, commands, paths, diagnostics, and the formal tagline. Bodoni is never used for body text, controls, navigation, tables, or diagnostics.
- Font licensing: all four families ship under the SIL Open Font License 1.1; see `brand/fonts/README.md`. Redistributed font files retain their matching copyright notice and license text.
- Contrast: Jet on Linen and Linen on Jet carry primary text at roughly 13.9:1; Pine passes normal-text accent use; Golden Bronze on Linen is non-text only — rules, borders, registration marks, and large decorative marks, never normal text on Linen.
- Focus: never rely on color alone. Use a visible `3px` Jet outline on Linen surfaces and a `3px` Linen outline on Jet surfaces, with a `2px` offset.
- Geometry: radius is always `0`, including controls, cards, dialogs, and fields. Circles stay reserved for celestial geometry and functionally circular controls; ordinary content is flat with no shadow.
- Accessibility baseline: semantic HTML before ARIA; every control has a programmatic name; interactive targets are at least `44 x 44px`; focus stays visible and follows reading order; color never carries status alone; every shipped surface rechecks its exact combinations against WCAG 2.2 AA; surfaces are tested at mobile widths, 200% zoom, and reduced motion.

## Open Decisions

These decisions remain open and tracked upstream; none is resolved here.

| Decision | Gate |
| --- | --- |
| Logo similarity findings versus Atlas, globe, astronomy, infrastructure, AI, and developer-tool marks | Issue #52, before final export packaging |
| Exact export names, platform dimensions, numeric clear space, and wordmark live text versus outlined export | Issue #50 packaging review |
| Implementation stack for public surfaces: framework, documentation generator, deployment | Issues #4 and #5 kickoff |
| Stable diagnostic code inventory | Issue #49 implementation and test review |
| Trademark and naming availability | Deferred; not a current design gate |
| Historical imagery provenance and reuse rights | Asset-specific rights review |
| Future `Almanac` behavior and naming | Future product decision; no v0.1 claims |

No open decision authorizes a current claim. Future adapters, registries, workflow state, and runtime execution remain uncommitted.
