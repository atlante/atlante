---
title: Use OpenCode
description: Materialize Atlante agents and skills as OpenCode-native files.
---

[OpenCode](https://opencode.ai/) is the supported host in Atlante v0.1. A
build materializes your agents and skills as OpenCode-native files; Atlante
does not use a runtime plugin or an intermediate payload tree. Host-owned
settings stay under OpenCode's control.

## Build the native files
The optional `atlante eval` command reads the verified native outputs produced by
the build; the project needs no `@atlante/opencode` dependency.

Run validation and build from the project directory:

```sh
npx @atlante/cli@latest validate
npx @atlante/cli@latest build
```

The build writes the native files described in
[Materialization](/reference/materialization). It does not read or write host
configuration: the host owns model, mode, permission, and tool settings.

A collision with a file Atlante does not own, a drifted generated file, or any
other materialization failure leaves the previous generated set in place and
fails closed with a recovery action. See [Troubleshooting](/troubleshooting)
for repair steps.

## Keep host settings in OpenCode

OpenCode combines its own settings with the native files when it starts. Keep
model, mode, permission, and tool settings in OpenCode. Restart OpenCode after
a build to pick up changed agents or skills. Unchanged output is not rewritten.
