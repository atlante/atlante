---
title: Introduction
description: A structured, versioned source for your coding agents and skills, with native OpenCode builds and scenario-based evaluation.
---

Atlante is the configuration and build layer for your coding-agent harness.
It gives your agents and skills a structured, versioned source, with
scenario-based evaluation to test the resulting harness.

A coding agent’s results depend on
[more than the model you choose](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/).
The instructions around it shape how it approaches tasks, applies project
rules, and checks its work. Changing those instructions changes the system
you rely on to write code.

Whether you write that guidance yourself or ask an agent to generate it, it
deserves the same discipline as your code. It needs clear structure,
reviewable changes, and tests that help you assess the effect of each
revision. Reading a prompt diff tells you what changed, but not whether the
agent will produce better results.

Atlante brings configuration, builds, and evaluation into one toolchain you
can use from your repository. You compose reusable guidance, build native
OpenCode files, and use [`atlante eval`](/reference/eval) to assess the
harness against defined scenarios. OpenCode runs those scenarios, and
deterministic checks grade the results against expectations you specify.

## One source for your harness

Your `atlante.jsonc` brings together the configuration and resources that
define your project’s agents and skills. You can build on a preset, compose
content through templates, and supply project-specific values.

The configuration and its resources remain the source you review, while
generated host files are derived output. You can inspect changes, compare
revisions, and evolve the harness alongside the code it guides.

## Build and test the harness

Atlante validates your configuration, composes the selected content, and
generates native agent and skill files through a host adapter.
[OpenCode](https://opencode.ai/) is currently the only supported host and
discovers those files when it starts.

Validation checks the configuration before a build writes anything, while
deterministic rendering makes the native output reproducible from its inputs.

You can also test the built harness with [`atlante eval`](/reference/eval),
which launches OpenCode to run scenarios in disposable sandboxes. Atlante
then grades the results with deterministic checks, so you can assess changes
against explicit expectations.

## Where Atlante stops

Atlante defines instructions for agents; the host and model remain
responsible for carrying them out. Model calls, permissions, and tool use
belong to OpenCode, not to Atlante’s configuration and build layer.

Workflows describe a process for the model to follow; Atlante does not track
their progress or schedule their execution.

Follow [Getting started](/getting-started) to create your first configuration
and build its native OpenCode files.
