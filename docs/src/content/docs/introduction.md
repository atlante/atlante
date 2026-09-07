---
title: Introduction
description: Give a coding-agent harness a versioned source, deterministic builds, and tests.
---

Coding-agent harnesses grow from scattered prompts, one-off skills, and host
settings that are hard to review together. Atlante gives that system a home in
your repository: one configuration document that evolves alongside the code it
guides, with a toolchain that treats the harness like any other build
artifact.

Three properties make that possible.

**One versioned source.** An `atlante.jsonc` document selects a preset, binds
agents and skills to static resources, and supplies the values that fit your
project. Packs supply reusable presets, templates, and instances. The source
stays in the repository and is reviewed like any other code.

**Deterministic builds.** A build validates the document, resolves the
selected content, renders Markdown, and materializes host-native files. The
same source and content produce the same bytes on every run, apart from the
supported `{{sys.cwd.basename}}` system value described in [Values](/concepts/values),
and a failed build writes nothing.

**Verification.** `atlante validate` checks the source without writing
anything, and the optional `atlante eval` runs scenarios in a disposable
sandbox and grades them with deterministic checks. Harness changes can be
tested before they ship.

:::note
Atlante prepares the files; your coding agent runs them. Atlante never
executes agents or skills, never runs project code, and never calls a model.
:::

[OpenCode](https://opencode.ai/) is the supported host in v0.1. A build
materializes the agent and skill files OpenCode discovers, plus an ownership
manifest; see [Materialization](/reference/materialization) for the generated
output contract.

Start with the five-minute [Getting started](/getting-started) path to create
that first build. The concepts — [Configuration](/concepts/configuration),
[Resources](/concepts/resources), [Templates](/concepts/templates),
[Values](/concepts/values), and [Resolution](/concepts/resolution) — explain
the model, the guides walk through common work, and the references document
the contracts exactly.
