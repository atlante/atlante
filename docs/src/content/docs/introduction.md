---
title: Introduction
description: A structured, versioned source for coding agents and skills, with native host builds and scenario-based evaluation.
---

Atlante is the configuration and build layer for a coding-agent harness. It
keeps agents and skills in a structured, versioned source and tests the
resulting harness through repeatable scenarios.
A coding agent’s results depend on
[more than the selected model](https://blog.langchain.com/improving-deep-agents-with-harness-engineering/).
The context supplied to the model shapes how it interprets tasks, follows
project rules, and checks its work. Whether written by a person or generated
by an agent, that context deserves the same care as code. It should be clear,
easy to review, and tested against the work it is meant to guide. Reading the
instructions explains their intent, but their effect becomes clear only when
an agent uses them. Even a small change to that context can alter how the
agent writes code.

Atlante keeps configuration, builds, and evaluation together in the
repository. The host adapters materialize
reusable context as native files for [OpenCode](https://opencode.ai/) and
[Claude Code](https://code.claude.com/docs), while evaluation checks the resulting
harness against explicit expectations.

## How Atlante works

A project’s `atlante.jsonc` brings together the
[configuration](/concepts/configuration) and [resources](/concepts/resources)
that define its agents and skills. It can extend a
[preset](/concepts/configuration#presets-as-a-starting-point), compose content
through [templates](/concepts/templates), and supply project-specific
[values](/concepts/values). Together, the configuration and selected resources
are the source of the harness, which can evolve alongside the code it guides.
Atlante validates that source before writing any files, then a successful
build produces reproducible [native output](/reference/materialization) for
the selected hosts. Each host discovers the generated
agents and skills when it starts, and [`atlante eval`](/reference/eval) uses
them to run defined scenarios in disposable sandboxes.

<figure class="atlante-flow" data-atlante-flow aria-labelledby="atlante-flow-caption">
  <figcaption id="atlante-flow-caption">From source to use and evaluation</figcaption>
  <div class="atlante-flow-diagram">
    <div class="atlante-flow-node">
      <span>Source</span>
      <strong>Configuration and resources</strong>
    </div>
    <span class="atlante-flow-arrow" aria-hidden="true"></span>
    <div class="atlante-flow-node">
      <span>Build</span>
      <strong>Validate and materialize</strong>
    </div>
    <span class="atlante-flow-arrow" aria-hidden="true"></span>
    <div class="atlante-flow-node">
      <span>Native output</span>
      <strong>Generated agents and skills</strong>
    </div>
    <span class="atlante-flow-arrow" aria-hidden="true"></span>
    <div class="atlante-flow-node">
      <span>Use / evaluate</span>
      <strong>Host / <code>atlante eval</code></strong>
    </div>
  </div>
</figure>

Atlante prepares this structure but does not run it: model calls, permissions,
tools, modes, and project execution remain with the host and configured model.
Workflows describe a process for the model to follow, but Atlante does not
schedule them, track their progress, or manage runtime checkpoints. Packs
published as npm packages are listed in the
[pack explorer](https://packs.atlante.sh/), a curated directory for
inspecting a pack before installing it.

Follow [Getting started](/getting-started) to create your first configuration.
