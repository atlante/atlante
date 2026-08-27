---
title: Getting started
description: Install Atlante and build your first versioned coding-agent harness.
---

Atlante requires Node.js 22 or later. It runs from the project that contains
your authored configuration and writes generated output under that project.

The shortest path from an empty project to a working configuration is:

```sh
npx @atlante/cli init
npx @atlante/cli validate
npx @atlante/cli build
```

`init` creates `atlante.jsonc`, selects the default `@atlante/pack` preset,
registers the OpenCode adapter in `opencode.jsonc`, and builds the initial
artifact tree. `validate` checks the source without rendering. `build` validates,
renders, and publishes the complete artifact tree.

## What you will have

After initialization, the project contains the authored source and generated
artifacts:

```text
project/
├── atlante.jsonc
├── opencode.jsonc
└── .atlante/
    └── artifacts/
        ├── agents/
        ├── skills/
        └── manifest.json
```

Keep `.atlante/` local. Rendered values can contain project-sensitive content,
and the artifact tree is a build output rather than source configuration.

## Continue

- [Install the CLI](/getting-started/installation/)
- [Complete your first build](/getting-started/first-build/)
- [Understand the configuration document](/concepts/configuration/)
