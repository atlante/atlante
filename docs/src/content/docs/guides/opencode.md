---
title: Use OpenCode
description: Connect verified Atlante artifacts to OpenCode through the host adapter.
---

OpenCode is the supported host adapter in Atlante v0.1. The adapter consumes
only the generated artifact tree and leaves host-owned settings under OpenCode's
control.

## Register the adapter

`atlante init` creates or updates `opencode.jsonc` while preserving existing
settings. The registration has this shape:

```jsonc title="opencode.jsonc"
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@atlante/opencode"]
}
```

If you register it manually, install `@atlante/opencode` in the environment that
runs OpenCode.

## Build before materialization

```sh
npx @atlante/cli validate
npx @atlante/cli build
```

The adapter reads `.atlante/artifacts/manifest.json`, verifies every declared
path and SHA-256 digest, and then stages the rendered agent descriptions and
prompts. It does not read `atlante.jsonc`, local resources, or installed packs.

A missing, malformed, unsupported, or changed artifact tree leaves the host
configuration unchanged. Verification and injection fail closed, so the adapter
does not partially materialize a build.

## Host-owned settings

Atlante writes the rendered prompt and resolved description for configured agent
IDs. OpenCode continues to own model, effort, permission, tool, and mode
settings. Atlante does not select those settings.

If materialization replaces a non-empty host prompt, the adapter reports a
warning. Repeating materialization for the same valid artifacts does not duplicate
agents.

## Resolve a skill

After verification and materialization, the adapter can expose `atlante_skill`.
Its input is exactly:

```json
{ "name": "skill-id" }
```

A successful lookup returns the resolved Markdown content only. Unknown names,
invalid input, unavailable artifacts, and failed lifecycle states return explicit
errors. Skill content is data; the adapter does not execute it.
