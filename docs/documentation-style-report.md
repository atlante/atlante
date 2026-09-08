# Documentation style research report

**Status:** internal research

**Checked:** 2026-09-08

## Executive summary

React, ESLint, and Prettier use different personalities, but their strongest
documentation shares one structural pattern:

> define the idea, show the smallest useful example, explain the result, name
> the edge cases, and give the reader a clear next step.

Atlante should reuse that structure without copying any site's brand voice or
interactive implementation. Atlante's existing terminology and voice rules in
[`CONTRIBUTING.md`](../CONTRIBUTING.md) and [`brand/DESIGN.md`](../brand/DESIGN.md)
remain the authority.

The main registry recommendation is to keep one canonical documentation
collection and derive other views from it. The current Starlight `docs`
collection is the right registry to reuse. Do not create a second, manually
maintained page manifest for a future machine-readable index.

## Scope and method

This is a qualitative review of live, official documentation. The samples cover
learning pages, reference pages, configuration or CLI pages, and the available
machine-readable indexes. The findings describe the pages fetched on the date
above; the sites can change independently.

### Source registry

| Site | Learning or overview sample | Reference or operations sample | Machine-readable navigation |
| --- | --- | --- | --- |
| React | [Quick Start](https://react.dev/learn), [Thinking in React](https://react.dev/learn/thinking-in-react) | [`useState`](https://react.dev/reference/react/useState) | [`/llms.txt`](https://react.dev/llms.txt) |
| ESLint | [Getting Started](https://eslint.org/docs/latest/use/getting-started) | [Configuration Files](https://eslint.org/docs/latest/use/configure/configuration-files), [`no-unused-vars`](https://eslint.org/docs/latest/rules/no-unused-vars) | [`sitemap-index.xml`](https://eslint.org/sitemap-index.xml); `/llms.txt` returned 404 during this review |
| Prettier | [What is Prettier?](https://prettier.io/docs/) and [Why Prettier?](https://prettier.io/docs/why-prettier) | [CLI](https://prettier.io/docs/cli) | [`/llms.txt`](https://prettier.io/llms.txt) |

The source registry is intentionally small. It gives future reviews stable
starting points without pretending that one page represents an entire site.

## Observations by site

### React

**Tone**

- Teacherly, encouraging, and direct. The docs address the reader as `you` and
  use verbs such as “start,” “notice,” “try,” and “read.”
- The prose normalizes difficulty without becoming vague: it explains when an
  example is intimidating, when a pattern is rare, and when a simpler option is
  preferable.
- The tone is conversational in learning content but remains precise in the API
  reference.

**Shape of text**

- Learning pages open with a short framing paragraph, then a concrete promise
  such as “You will learn” or a numbered sequence of steps.
- A typical section alternates between a small concept, code, an explanation of
  what changed, and the next change. The code is not left to speak for itself.
- Tutorials use progressive disclosure. `Pitfall`, `DeepDive`, and recipe-style
  blocks keep the main path moving while preserving detail for readers who need
  it.
- Reference pages use a repeatable anatomy: definition, signature, parameters,
  returns, caveats, usage, examples, and troubleshooting.
- A page often ends with a small “where to go next” section and machine-readable
  sitemap link.

**Reusable pattern**

React is the strongest model for teaching a new concept through a sequence of
small, named transformations. Its page-specific MDX components are useful as a
concept, not as a requirement for Atlante.

### ESLint

**Tone**

- Operational, formal, and exhaustive. It tells the reader what a setting does,
  what the default is, and which behavior follows.
- It uses second person and imperative instructions, but with less narrative
  than React.
- `Tip`, `Note`, `Important`, and `Warning` blocks mark the risk or exception
  without burying it in a paragraph.

**Shape of text**

- The information architecture is task-oriented: use, configure, extend,
  integrate, contribute, and maintain. Version switching and search are treated
  as first-class navigation.
- Getting-started pages begin with prerequisites, then a quick path, then
  configuration, alternative setup paths, and next steps.
- Configuration pages start with a short rule or concept statement, show a
  minimal configuration, then enumerate every property and its interaction with
  neighboring properties.
- Rule pages have a particularly strong reference template: summary, status
  badges, rule details, incorrect examples, correct examples, options, related
  rules, version, and source links.
- Package-manager tabs and copy affordances keep repeated commands compact while
  preserving equivalent commands for npm, Yarn, pnpm, and Bun.

**Reusable pattern**

ESLint is the strongest model for implementation-aligned reference pages. The
important lesson is not its volume; it is the consistent contract for defaults,
examples, options, exceptions, and source links.

### Prettier

**Tone**

- Technical pages are direct and practical: “Use the command,” “To format a
  file,” and “Don’t forget.”
- About and rationale pages are more opinionated and conversational. They argue
  for a product choice using stories, quotes, and explicit trade-offs.
- The docs distinguish persuasion from operation instead of mixing both in every
  page.

**Shape of text**

- The overview defines the tool, lists its supported surface, and demonstrates
  the before-and-after result immediately.
- The CLI page puts command grammar first, followed by a minimal invocation,
  notes and warnings, option sections, and exit codes.
- Option sections repeat a compact pattern: what the option controls, the
  default or precedence, a command example, and a caveat.
- Pages provide previous/next navigation, a table of contents, edit links, and
  links to related usage pages.

**Reusable pattern**

Prettier is the strongest model for CLI documentation and for separating a
product rationale page from an operational reference page. Its persuasive tone
should not be copied into Atlante's reference, diagnostic, or troubleshooting
content.

## Cross-site patterns

| Dimension | Shared pattern | Atlante application |
| --- | --- | --- |
| Opening | State what the page is for before explaining internals | Start concepts with a definition and guides with an outcome |
| Paragraph size | One idea per short paragraph, usually followed by an example | Keep the current one-idea sentence rule and place code close to its explanation |
| Page progression | Concept → minimal example → explanation → edge case → next step | Use this as the default guide and concept rhythm |
| Reference pages | Stable section order and explicit defaults | Standardize CLI, schema, materialization, and diagnostic entries around local contracts |
| Caveats | Name unsafe, surprising, or uncommon behavior beside the rule | Keep caveats adjacent to commands, fields, and failure modes |
| Examples | Small, runnable, named examples beat abstract prose | Prefer complete `atlante.jsonc`, CLI, and diagnostic examples over fragments |
| Navigation | Learn/use/reference sections plus local next steps | Keep the current Introduction, Getting started, Concepts, Guides, Reference, and Troubleshooting shape |
| Machine access | A page index or sitemap is useful to tools and readers | Derive a future `llms.txt`-style output from the existing content collection |
| Source trust | Exact links to source, versions, or implementation clarify authority | Preserve links to the schema, repository source, and shipped behavior |

## What Atlante already does well

The current docs already share several successful patterns:

- [`getting-started.md`](src/content/docs/getting-started.md) uses a numbered
  path from installation through validation, build, host discovery, and next
  steps. This is close to the strongest React and ESLint onboarding shape.
- [`reference/cli.md`](src/content/docs/reference/cli.md) begins with the
  package and runtime contract, then gives commands, output, behavior, options,
  configuration, and exit status. This is close to the Prettier and ESLint CLI
  patterns.
- The concepts pages separate configuration, resources, templates, values, and
  resolution instead of forcing one long conceptual essay.
- Diagnostics and troubleshooting are separate from the main happy path, which
  matches the external sites' use of dedicated caveat and failure sections.
- The repository already enforces active voice, sentence-case headings, exact
  commands and fields, and literal language in operational content.

## Gaps worth addressing later

These are design opportunities, not requests to expand this report into a docs
rewrite:

1. Add a short “You will learn” or “By the end” contract to the main onboarding
   and major guides when it clarifies the destination.
2. Give recurring reference pages a visible, shared anatomy: definition,
   minimal example, fields or parameters, defaults, caveats, diagnostics, and
   related pages.
3. Add explicit “Next steps” blocks to reference pages where the reader has a
   natural follow-up action.
4. Consider a generated machine-readable page index. React and Prettier show the
   value of an `llms.txt`-style surface, while ESLint demonstrates that a sitemap
   alone is still useful for navigation and discovery.
5. Use admonitions sparingly for Atlante-specific risks such as generated-output
   ownership, transactional build behavior, host execution boundaries, and
   untrusted custom Pack installation.

## Registry recommendation

### Current repository evidence

Atlante already has one content collection:

- [`docs/src/content.config.ts`](src/content.config.ts) defines the Starlight
  `docs` collection through `docsLoader()` and `docsSchema()`.
- [`docs/src/pages/[...slug].md.ts`](src/pages/[...slug].md.ts) gets entries from
  that collection, filters drafts, and exposes their source Markdown.
- [`docs/astro.config.mjs`](astro.config.mjs) contains the human-facing sidebar
  and section order.
- Starlight supplies search, table of contents, pagination, edit links, and the
  rendered site from the same collection.

There is no second Atlante page registry in the repository today. The sidebar is
a navigation projection, not a reason to duplicate content metadata elsewhere.

### Recommended model: one collection, several projections

Reuse the existing `docs` collection as the canonical registry. Future outputs
should be projections of that collection:

1. **Rendered pages:** Starlight's current output.
2. **Raw Markdown:** the existing catch-all route.
3. **Search and navigation:** Starlight's current integrations and sidebar.
4. **Machine-readable index:** a generated `llms.txt`-style route, excluding
   draft entries and using each entry's title, description, and canonical path.

Do not hand-maintain a separate `llms.txt`, JSON manifest, or source-site list
for the same pages. If future consumers need fields that cannot be derived from
the path and current frontmatter, add those fields to the content entry once and
derive every projection from them.

An illustrative registry record would look like this:

```json
{
  "id": "reference/cli",
  "title": "CLI",
  "description": "Command reference for init, validate, build, and eval.",
  "kind": "reference",
  "canonical": "/reference/cli",
  "source": "docs/src/content/docs/reference/cli.md",
  "draft": false
}
```

`kind` is not required yet. The current path taxonomy already supplies enough
information for a first generated index. Add explicit taxonomy only when a
consumer needs semantics that path-derived grouping cannot provide.

### Registry constraints

- The collection remains the source of truth; generated output remains derived.
- Draft filtering must match the existing raw-Markdown route.
- URLs should use the canonical page path, not a duplicated hand-written slug.
- The machine index should link to stable Markdown endpoints where appropriate,
  while human navigation continues to use rendered pages.
- The registry must not change the public terminology contract or introduce
  external product names into Atlante's schema vocabulary.

## Recommended writing contract for future pages

Use this sequence unless the page is a compact reference entry:

1. **Orient:** define the subject and state who needs the page.
2. **Promise:** name the outcome or list what the reader will learn.
3. **Demonstrate:** show the smallest complete command or configuration.
4. **Explain:** describe what the example does and why each important field is
   present.
5. **Bound:** document defaults, limitations, failure modes, and security or
   ownership implications.
6. **Continue:** link to the next concept, guide, reference entry, or diagnostic.

For reference pages, use:

1. Definition and scope.
2. Syntax, command, or shape.
3. Fields, parameters, or modes.
4. Defaults and precedence.
5. Minimal valid example.
6. Failure cases and diagnostics.
7. Related pages and source links.

The external sites support this structure. Atlante should keep the prose more
restrained and literal than React's teaching voice or Prettier's advocacy voice,
because its approved brand contract requires metaphor to reach zero in
procedures, CLI output, errors, schema references, and troubleshooting.

## Decision

Adopt the shared structural patterns now, preserve Atlante's existing voice,
and defer implementation of the machine-readable index until its consumer is
defined. When that work begins, reuse `getCollection("docs")` rather than adding
a parallel registry.
