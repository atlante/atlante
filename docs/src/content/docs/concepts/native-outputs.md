---
title: Native outputs
description: Host-native files and the ownership manifest a build materializes.
---

What does the host actually consume after a successful build? Not your authored
configuration, and no intermediate tree: the build materializes host-native
files that the host discovers directly. For the OpenCode host the native output
set is:

```text
.opencode/
├── agents/<id>.md
└── skills/<id>/SKILL.md
.atlante/opencode-native.json
```

The flow is `atlante.jsonc` or `atlante.json` -> validation and resolution ->
build -> this native output set. The source remains the place to make changes;
a rebuild updates the generated files and the manifest together.

## Native files

An agent file contains a YAML frontmatter `description` followed by the
rendered prompt. A skill file contains a `name` and `description` frontmatter
followed by the rendered skill content. IDs come straight from the document's
`agents` and `skills` maps: lowercase kebab-case ASCII of at most 64
characters, never renamed. An ID that violates the grammar fails the build
instead of being rewritten.

## The ownership manifest

`.atlante/opencode-native.json` is UTF-8 JSON with only `format`
(`atlante-opencode-native`), `version` (1), and `files`. Each entry records a
generated file's `kind` (`agent` or `skill`), `id`, `path`, and lowercase
SHA-256 `sha256` of its exact bytes. The manifest is bookkeeping state, not a
trust boundary: it never stores prompt or skill payload content. It lets a
later build tell Atlante-owned files from yours.

The [Materialization](/reference/materialization) reference contains the
complete field and publication contract rather than duplicating it here.

## What Atlante owns

The manifest defines ownership. A file at a native path that the manifest does
not account for is never overwritten — the build fails with a repair action
instead. A generated file whose bytes no longer match the manifest is never
silently replaced; drift is reported so repair stays intentional. Generated
files the source no longer declares are removed on the next successful build.

Generated outputs stay local. `atlante init` enforces the ignore-by-default
git policy by adding `.opencode/agents/`, `.opencode/skills/`, and `.atlante/`
to `.gitignore`, because rendered values can contain project-sensitive
content.

## Host discovery

OpenCode discovers native agents and skills from these paths when it starts.
Host-owned settings in `opencode.jsonc` or `opencode.json` (model, mode,
permission, tools) keep composing with the native files: Atlante never writes
them. Restart OpenCode to pick up new or changed native files. Atlante does
not execute the resulting agents or skills. See [Use OpenCode](/guides/opencode)
for the integration.
