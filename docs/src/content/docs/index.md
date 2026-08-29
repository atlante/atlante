---
title: Introduction
description: Version and publish a coding-agent harness from static, reviewable source.
---

Coding-agent harnesses tend to grow from scattered prompts, one-off skills, and
host settings that are difficult to review together. Atlante gives that system a
versioned source in the project repository, so a harness can change alongside the
code it guides.

You describe the harness in one configuration document. Atlante validates it,
resolves the static content it selects, renders deterministic Markdown, and
publishes verified artifacts for a host adapter. Packs supply reusable presets,
templates, and instances; your document supplies the values and bindings that
make them fit your project.

After the first build, you have an `atlante.jsonc` source document and a complete
host-neutral tree under `.atlante/artifacts/`. The tree contains a manifest and
the rendered agent and skill payloads. The OpenCode adapter can verify that tree
before materializing it for the host.

Start with the five-minute [Getting started](/getting-started) path to create
that first build. Then explore
[Configuration](/concepts/configuration),
[Resources](/concepts/resources), [Templates](/concepts/templates),
[Values](/concepts/values), [Resolution](/concepts/resolution), and
[Artifacts](/concepts/artifacts).

:::note
Atlante owns configuration, static content selection, validation, interpolation,
rendering, and artifact publication. An adapter materializes verified artifacts
into host configuration; the host executes agents and skills. Atlante does not
execute agents, skills, project code, or LLM inference.
:::

## Source and output

A project normally contains one `atlante.jsonc` file. It selects a preset, binds
agents and skills to static resources, and supplies explicit values for those
bindings. The build output lives under `.atlante/artifacts/` and remains
host-neutral until an adapter consumes it.

```jsonc title="atlante.jsonc"
{
  "$schema": "https://atlante.sh/schema/v0.1/schema.json",
  "extends": "@atlante/pack"
}
```

Read the [Schema](/reference/schema) for the document contract and the
[Artifact](/reference/artifact) for the generated output contract. The shipped
implementation, tests, and
[`SPECIFICATION.md`](https://github.com/atlante/atlante/blob/main/SPECIFICATION.md)
remain authoritative for v0.1 behavior.
