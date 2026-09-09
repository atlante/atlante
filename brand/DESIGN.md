# Atlante Design

This file records the approved brand and design decisions applied across Atlante's public surfaces: positioning, naming, voice, and visual identity. `../SPECIFICATION.md` remains the normative implementation contract for the product itself.

## Role and Precedence

When documents disagree, apply this order:

1. Shipped behavior from `README.md`, `SPECIFICATION.md`, tests, and implementation.
2. Approved brand decisions recorded here.

## Product Truth

**Category:** the configuration and build layer for your coding-agent harness.

**Primary audience:** engineering teams and individual engineers who need explicit structure for a shared or personal coding-agent harness. Adjacent audiences are engineering leads defining agent roles and maintainers packaging reusable harness content.

**Tagline:** Give form to your harness.

Approved positioning: for engineering teams and individual engineers who need a coding-agent harness they can share or evolve, Atlante turns agents, skills, and workflows into one versioned system. Unlike maintaining scattered prompts and host configuration separately, Atlante gives you an authoritative source in the repository, then materializes it through a host adapter.

Message order:

1. Category: configuration and build layer for the harness.
2. Authoring outcome: one versioned source you can review and evolve.
3. System contents: agents, skills, values, and eval configuration.
4. Destination: materialized through a host adapter; OpenCode is available today.
5. Supporting proof: composition, validation, deterministic output, artifact verification, and host-setting preservation.
6. Boundary: Atlante defines orchestration but does not execute agents itself.

Never open with schema validation, artifact hashing, mythology, or a future registry.

**Boundary:** Atlante defines prompt-level orchestration; the host and prompted model execute it. In v0.1 Atlante performs no LLM inference, executes no agents, skills, or arbitrary project code, selects no host settings, maintains no runtime workflow state, and provides no other host than OpenCode.

## Naming and Vocabulary

As analogy, Atlante bears the celestial sphere. The celestial sphere represents the broader ecosystem of independently authored harness families. A Family is one complete harness containing related constellations, skills, workflows, values, and supporting configuration. Metaphors explain the product; they never replace its technical vocabulary and never enter schema fields, package names, types, or code identifiers.

| Metaphor | Meaning | Allowed use |
| --- | --- | --- |
| Atlante bearing the sphere | Atlante carries the harness structure | Brand story, identity rationale, major narrative moments |
| Celestial sphere | The broader ecosystem of independently authored harness families | Architecture overview and visual system |
| Star | A named input, instruction, constraint, value, or policy | Explanatory diagrams and occasional editorial copy |
| Constellation | One configured agent | Light explanatory copy and diagrams |
| Family | One complete harness containing related constellations, skills, workflows, values, and supporting configuration | Architecture overview and occasional editorial copy |
| Projection | Materialization through a host adapter | Architecture explanation paired with the literal term `adapter` |
| Bearing | Support, load, responsibility, materialization | Brand narrative and graphic devices |
| Almanac | A possible future registry for independently authored harness families | Reserved; it is not shipped and has no current behavior |

Skills remain literal skills, reusable guidance rather than stars. Generated
outputs remain generated outputs. Never rename Atlante to Atlas or Atlantis.

Technical vocabulary keeps its required meanings: `configuration` is the primary prose term for the authored system and `config` appears only in compact CLI, argument, or code contexts; `document` names the parsed or validated configuration entity in technical documentation; `preset` names a preconfigured root document used directly or through `extends`; `native output` names generated host files under `.opencode/` and the ownership manifest under `.atlante/opencode-native.json`; `host adapter` is the public phrase for host-specific materialization.

`Family` names one complete harness containing related constellations, skills, workflows, values, and supporting configuration. It is explanatory brand vocabulary only and does not name a schema field, package, type, or code identifier. `PackItem` remains a retired early discussion term.

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
- Typography roles: Bodoni Moda for the wordmark; Source Serif 4 for display headings and editorial reading; Source Sans 3 for interface text; JetBrains Mono for code, commands, paths, diagnostics, and the formal tagline. Bodoni is never used for body text, controls, tables, or diagnostics.
- Font licensing: all four families ship under the SIL Open Font License 1.1; see `brand/fonts/README.md`. Redistributed font files retain their matching copyright notice and license text.
- Contrast: Jet on Linen and Linen on Jet carry primary text at roughly 13.9:1; Pine passes normal-text accent use; Golden Bronze on Linen is non-text only — rules, borders, registration marks, and large decorative marks, never normal text on Linen.
- Focus: never rely on color alone. Use a visible `3px` Jet outline on Linen surfaces and a `3px` Linen outline on Jet surfaces, with a `2px` offset.
- Geometry: use a restrained `4px` radius for controls and bounded surfaces, including cards, dialogs, fields, code blocks, and panels. Circles stay reserved for celestial geometry and functionally circular controls; ordinary content remains flat with no shadow.
- Content width: landing editorial sections cap at `1200px` with prose limited to `70ch`; the playground remains wider at `1440px`; docs prose caps at `52rem`.
- Accessibility baseline: semantic HTML before ARIA; every control has a programmatic name; interactive targets are at least `44 x 44px`; focus stays visible and follows reading order; color never carries status alone; every shipped surface rechecks its exact combinations against WCAG 2.2 AA; surfaces are tested at mobile widths, 200% zoom, and reduced motion.
