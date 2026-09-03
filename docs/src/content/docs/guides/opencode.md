---
title: Use OpenCode
description: Materialize Atlante agents and skills as OpenCode-native files.
---

[OpenCode](https://opencode.ai/) is the supported host in Atlante v0.1. A
build materializes your agents and skills as OpenCode-native files; there is
no runtime plugin and no intermediate payload tree. Host-owned settings stay
under OpenCode's control.

## No registration needed

Older Atlante versions registered `@atlante/opencode` as an OpenCode plugin in
`opencode.jsonc` (or an existing `opencode.json`). That plugin no longer
exists. `atlante init` removes the Atlante-written registration; the harmless
`"plugin": []` residue it may leave requires no action. A stale registration
in a project that has not been re-initialized is inert: OpenCode silently
drops packages that expose no plugin target.

## Build the native files
The optional `atlante eval` command reads the verified native outputs the build
materialized; the project needs no `@atlante/opencode` dependency.

Run validation and build from the project directory:

```sh
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

The build writes `.opencode/agents/<id>.md`, `.opencode/skills/<id>/SKILL.md`,
and the ownership manifest `.atlante/opencode-native.json`. It does not read
or write host configuration: the host owns model, mode, permission, and tool
settings, and Atlante never touches them.

A collision with a file Atlante does not own, a drifted generated file, or any
other materialization failure leaves the previous generated set in place and
fails closed with a recovery action. See [Troubleshooting](/troubleshooting)
for repair steps.

## Keep host settings in OpenCode

OpenCode composes its own configuration with the native files when it starts:
an agent's mode and permission rules from `opencode.json` still apply, while
its prompt and description come from the native agent file. Atlante does not
select those settings.

Rebuilds are idempotent: unchanged content is not rewritten. OpenCode reads
native agents and skills at startup, so restart it to pick up new or changed
files.

## Skills are files

Each skill binding is materialized as `.opencode/skills/<skillId>/SKILL.md`
with name and description frontmatter, which OpenCode lists like any native
skill. Skill content is data; Atlante renders it but does not execute it.
