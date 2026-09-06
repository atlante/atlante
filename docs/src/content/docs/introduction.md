---
title: Introduction
description: Version and publish a coding-agent harness from static, reviewable source.
---

Coding-agent harnesses tend to grow from scattered prompts, one-off skills, and
host settings that are difficult to review together. Atlante gives that system a
versioned source in the project repository, so a harness can change alongside the
code it guides.

You describe the harness in one configuration document. Atlante validates it,
resolves the static content it selects, renders deterministic Markdown into a
prepared project, and materializes it as host-native files for the hosts the
document declares. Packs supply reusable presets,
templates, and instances; your document supplies the values and bindings that
make them fit your project.

After the first build, you have an `atlante.jsonc` source document and
host-native files for OpenCode. The source remains the place to make changes;
see [Materialization](/reference/materialization) for the generated output
contract.

Start with the five-minute [Getting started](/getting-started) path to create
that first build. Then explore
[Configuration](/concepts/configuration),
[Resources](/concepts/resources), [Templates](/concepts/templates),
[Values](/concepts/values), and [Resolution](/concepts/resolution).

:::note
Atlante owns configuration, static content selection, validation,
interpolation, rendering, and host-native materialization. The host executes
agents and skills. Atlante does not execute agents, skills, project code, or
LLM inference.
:::

## Source and output

A project normally contains one `atlante.jsonc` file. It selects a preset, binds
agents and skills to static resources, and supplies explicit values for those
bindings. The build turns that source into host-native output. See
[Configuration](/concepts/configuration) for the document model and
[Getting started](/getting-started) for a minimal configuration.

Read the [Schema](/reference/schema) for the document contract and the
[Materialization](/reference/materialization) for the generated output contract. The shipped
implementation, tests, and
[`SPECIFICATION.md`](https://github.com/atlante/atlante/blob/main/SPECIFICATION.md)
remain authoritative for v0.1 behavior.
